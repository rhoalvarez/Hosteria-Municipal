-- ============================================================
-- HOSTERÍA MUNICIPAL – Sistema del restaurante
-- Archivo: 90_caja.sql   (Incremento 3 – Caja)
-- Rama: caja-backend (para revisión de Rosario)
-- ============================================================
-- Qué hace este script:
--  1. Agrega la FORMA DE PAGO a los movimientos de caja, para que el
--     arqueo cuente solo el efectivo (antes sumaba las transferencias).
--  2. Guarda en el turno el efectivo esperado y las transferencias
--     al momento del cierre (para poder mostrar el arqueo después).
--  3. Crea la vista v_caja_resumen: el cálculo de la caja está en
--     UN SOLO LUGAR y lo usan todos los procedimientos.
--  4. Reemplaza sp_caja_cerrar y sp_cobro_registrar (pago dividido,
--     medio de transferencia, sin cargo auditado, turno automático).
--  5. Crea procedimientos nuevos: turno actual, resumen, historial,
--     códigos, movimientos manuales, listado y reapertura con motivo.
--
-- Se puede correr varias veces y en la base compartida:
-- NO borra tablas ni datos.
-- Orden en una base nueva: 00 → 10 → 20 → 30 → 40 → 50 → 60 → 70 → 80 → 90
-- Compatible con MariaDB 10.4 (no usa JSON_TABLE ni JSON_ARRAYAGG).
-- Los mensajes de error van sin tildes, igual que en 10_procedures.
-- ============================================================

USE hosteria;

-- ------------------------------------------------------------
-- 1. COLUMNAS NUEVAS
-- ------------------------------------------------------------
-- Forma de pago de cada movimiento. Los movimientos que ya existan
-- quedan como EFECTIVO (lo que eran en la práctica).
ALTER TABLE rest_movimiento_caja
  ADD COLUMN IF NOT EXISTS forma VARCHAR(30) NOT NULL DEFAULT 'EFECTIVO' AFTER concepto,
  ADD COLUMN IF NOT EXISTS medio_transferencia VARCHAR(50) NULL AFTER forma;

-- Foto del arqueo al cerrar: contra qué se comparó el efectivo contado.
ALTER TABLE rest_turno_caja
  ADD COLUMN IF NOT EXISTS efectivo_esperado DECIMAL(10,2) NULL AFTER efectivo_contado,
  ADD COLUMN IF NOT EXISTS total_transferencias DECIMAL(10,2) NULL AFTER efectivo_esperado;

-- ------------------------------------------------------------
-- 2. VISTA DE RESUMEN DE CAJA
-- ------------------------------------------------------------
-- Una fila por turno con todos los totales calculados.
-- efectivo_en_caja = lo que TIENE que haber en el cajón (solo efectivo).
-- saldo_total      = efectivo + transferencias (como el saldo del Excel).
CREATE OR REPLACE VIEW v_caja_resumen AS
SELECT
  t.id_turno_caja,
  t.fecha,
  t.apertura,
  t.cierre,
  t.estado,
  t.id_usuario_apertura,
  ua.nombre AS usuario_apertura,
  t.id_usuario_cierre,
  uc.nombre AS usuario_cierre,
  t.saldo_inicial,

  -- Efectivo
  COALESCE((SELECT SUM(m.ingreso) FROM rest_movimiento_caja m
            WHERE m.id_turno_caja = t.id_turno_caja AND m.forma = 'EFECTIVO'), 0) AS ingresos_efectivo,
  COALESCE((SELECT SUM(m.egreso) FROM rest_movimiento_caja m
            WHERE m.id_turno_caja = t.id_turno_caja AND m.forma = 'EFECTIVO'), 0) AS egresos_efectivo,
  t.saldo_inicial
    + COALESCE((SELECT SUM(m.ingreso - m.egreso) FROM rest_movimiento_caja m
                WHERE m.id_turno_caja = t.id_turno_caja AND m.forma = 'EFECTIVO'), 0) AS efectivo_en_caja,

  -- Transferencias
  COALESCE((SELECT SUM(m.ingreso) FROM rest_movimiento_caja m
            WHERE m.id_turno_caja = t.id_turno_caja AND m.forma = 'TRANSFERENCIA'), 0) AS ingresos_transferencia,
  COALESCE((SELECT SUM(m.egreso) FROM rest_movimiento_caja m
            WHERE m.id_turno_caja = t.id_turno_caja AND m.forma = 'TRANSFERENCIA'), 0) AS egresos_transferencia,

  -- Todo junto
  t.saldo_inicial
    + COALESCE((SELECT SUM(m.ingreso - m.egreso) FROM rest_movimiento_caja m
                WHERE m.id_turno_caja = t.id_turno_caja), 0) AS saldo_total,

  -- Cobros del turno
  (SELECT COUNT(*) FROM rest_cobro c WHERE c.id_turno_caja = t.id_turno_caja) AS cantidad_cobros,
  (SELECT COUNT(*) FROM rest_cobro c WHERE c.id_turno_caja = t.id_turno_caja AND c.sin_cargo = 1) AS cantidad_sin_cargo,

  -- Datos del cierre (NULL mientras el turno está abierto)
  t.efectivo_contado,
  t.efectivo_esperado,
  t.total_transferencias,
  t.diferencia,
  t.observaciones
FROM rest_turno_caja t
JOIN usuario ua ON ua.id_usuario = t.id_usuario_apertura
LEFT JOIN usuario uc ON uc.id_usuario = t.id_usuario_cierre;

DELIMITER $$

-- ------------------------------------------------------------
-- 3. CONSULTAS
-- ------------------------------------------------------------

-- Turno abierto con sus totales. Devuelve 0 filas si la caja está cerrada.
DROP PROCEDURE IF EXISTS sp_caja_turno_actual$$
CREATE PROCEDURE sp_caja_turno_actual()
BEGIN
  SELECT * FROM v_caja_resumen WHERE estado = 'ABIERTO';
END$$

-- Resumen de un turno (abierto o cerrado).
DROP PROCEDURE IF EXISTS sp_caja_resumen$$
CREATE PROCEDURE sp_caja_resumen(IN p_turno INT UNSIGNED)
BEGIN
  SELECT * FROM v_caja_resumen WHERE id_turno_caja = p_turno;
END$$

-- Últimos turnos, del más nuevo al más viejo (historial de caja).
DROP PROCEDURE IF EXISTS sp_caja_turnos_listar$$
CREATE PROCEDURE sp_caja_turnos_listar(IN p_cantidad INT UNSIGNED)
BEGIN
  SELECT * FROM v_caja_resumen
  ORDER BY id_turno_caja DESC
  LIMIT p_cantidad;
END$$

-- Códigos para movimientos MANUALES (COBRO queda afuera: lo genera
-- solo el sistema al cobrar una mesa, RF-CAJ-06).
DROP PROCEDURE IF EXISTS sp_caja_codigos$$
CREATE PROCEDURE sp_caja_codigos()
BEGIN
  SELECT id_codigo, codigo, concepto, tipo
  FROM rest_codigo_caja
  WHERE activo = 1 AND codigo <> 'COBRO'
  ORDER BY tipo DESC, codigo;   -- primero INGRESO, después EGRESO
END$$

-- Movimientos de un turno, con las mismas columnas que la planilla
-- de caja de la hostería (sirve para la pantalla y para el CSV).
DROP PROCEDURE IF EXISTS sp_caja_movimientos$$
CREATE PROCEDURE sp_caja_movimientos(IN p_turno INT UNSIGNED)
BEGIN
  SELECT
    m.id_movimiento,
    m.fecha,
    c.codigo,
    c.tipo,
    m.concepto,
    m.forma,
    m.medio_transferencia,
    m.tipo_comprobante,
    m.nro_comprobante,
    m.dni_cuit,
    m.huesped_proveedor,
    m.detalle,
    m.ingreso,
    m.egreso,
    m.saldo,
    m.id_cobro,
    u.nombre AS usuario
  FROM rest_movimiento_caja m
  JOIN rest_codigo_caja c ON c.id_codigo = m.id_codigo
  JOIN usuario u ON u.id_usuario = m.id_usuario
  WHERE m.id_turno_caja = p_turno
  ORDER BY m.fecha, m.id_movimiento;
END$$

-- ------------------------------------------------------------
-- 4. CIERRE DE CAJA (reemplaza el de 10_procedures)
-- ------------------------------------------------------------
-- Cambios:
--  - El efectivo esperado cuenta SOLO movimientos en efectivo.
--  - Guarda esperado y transferencias para mostrar el arqueo después.
--  - Ahora sí usa transacción (antes el FOR UPDATE no bloqueaba nada).
--  - (propuesta) Si hay diferencia, las observaciones son obligatorias.
DROP PROCEDURE IF EXISTS sp_caja_cerrar$$
CREATE PROCEDURE sp_caja_cerrar(
  IN p_turno INT UNSIGNED,
  IN p_usuario INT UNSIGNED,
  IN p_efectivo DECIMAL(10,2),
  IN p_obs TEXT
)
BEGIN
  DECLARE v_estado VARCHAR(20);
  DECLARE v_esperado DECIMAL(10,2);
  DECLARE v_transf DECIMAL(10,2);
  DECLARE v_obs TEXT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  SET v_obs = NULLIF(TRIM(p_obs), '');

  IF p_efectivo IS NULL OR p_efectivo < 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El efectivo contado es invalido';
  END IF;

  START TRANSACTION;

  SELECT estado INTO v_estado
  FROM rest_turno_caja
  WHERE id_turno_caja = p_turno
  FOR UPDATE;

  IF v_estado IS NULL OR v_estado <> 'ABIERTO' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El turno no existe o ya esta cerrado';
  END IF;

  SELECT efectivo_en_caja, ingresos_transferencia - egresos_transferencia
    INTO v_esperado, v_transf
  FROM v_caja_resumen
  WHERE id_turno_caja = p_turno;

  IF p_efectivo <> v_esperado AND v_obs IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Hay diferencia entre lo contado y lo esperado: escribi el motivo en observaciones';
  END IF;

  UPDATE rest_turno_caja
  SET id_usuario_cierre    = p_usuario,
      cierre               = NOW(),
      efectivo_contado     = p_efectivo,
      efectivo_esperado    = v_esperado,
      total_transferencias = v_transf,
      diferencia           = p_efectivo - v_esperado,
      observaciones        = v_obs,
      estado               = 'CERRADO'
  WHERE id_turno_caja = p_turno;

  COMMIT;

  SELECT * FROM v_caja_resumen WHERE id_turno_caja = p_turno;
END$$

-- ------------------------------------------------------------
-- 5. COBRO DE UNA COMANDA (reemplaza el de 10_procedures)
-- ------------------------------------------------------------
-- p_pagos es una lista JSON, por ejemplo:
--   [{"forma":"EFECTIVO","importe":5000,"medio_transferencia":""},
--    {"forma":"TRANSFERENCIA","importe":15000,"medio_transferencia":"Mercado Pago"}]
-- Cambios:
--  - El turno lo busca la base (no lo manda el navegador).
--  - Pago dividido: la suma de los pagos tiene que dar el total.
--  - Un movimiento de caja POR CADA PAGO, con su forma.
--  - Transferencia: medio obligatorio (BNA+, Mercado Pago, Naranja X...).
--  - CARGO_HABITACION rechazado hasta acordar tablas con reservas.
--  - Sin cargo: autoriza el encargado que cobra (a confirmar con la
--    hostería) y queda en rest_auditoria DENTRO de la transacción.
DROP PROCEDURE IF EXISTS sp_cobro_registrar$$
CREATE PROCEDURE sp_cobro_registrar(
  IN p_comanda INT UNSIGNED,
  IN p_usuario INT UNSIGNED,
  IN p_total DECIMAL(10,2),
  IN p_pagos JSON,
  IN p_sin_cargo BOOLEAN,
  IN p_motivo VARCHAR(255)
)
BEGIN
  DECLARE v_turno INT UNSIGNED;
  DECLARE v_cobro INT UNSIGNED;
  DECLARE v_numero INT UNSIGNED;
  DECLARE v_total_comanda DECIMAL(10,2);
  DECLARE v_codigo INT UNSIGNED;
  DECLARE v_saldo DECIMAL(10,2);
  DECLARE v_n INT DEFAULT 0;
  DECLARE v_i INT DEFAULT 0;
  DECLARE v_forma VARCHAR(30);
  DECLARE v_importe DECIMAL(10,2);
  DECLARE v_medio VARCHAR(50);
  DECLARE v_suma DECIMAL(10,2) DEFAULT 0;
  DECLARE v_motivo VARCHAR(255);
  DECLARE v_msg VARCHAR(255);
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  SET v_motivo = NULLIF(TRIM(p_motivo), '');

  START TRANSACTION;

  -- 1) Turno abierto. El FOR UPDATE hace que dos cobros al mismo
  --    tiempo esperen su turno y el saldo no se mezcle.
  SELECT id_turno_caja INTO v_turno
  FROM rest_turno_caja
  WHERE estado = 'ABIERTO'
  LIMIT 1
  FOR UPDATE;

  IF v_turno IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'No hay caja abierta. Abri la caja antes de cobrar';
  END IF;

  -- 2) Comanda abierta y total actualizado
  SELECT numero, total INTO v_numero, v_total_comanda
  FROM rest_comanda
  WHERE id_comanda = p_comanda AND estado = 'ABIERTA'
  FOR UPDATE;

  IF v_numero IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La comanda no existe o ya fue cerrada';
  END IF;

  -- Si mientras se cobraba el mozo agregó un plato, el total cambió:
  -- se rechaza para no cobrar de menos.
  IF p_total IS NULL OR p_total <> v_total_comanda THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El total de la cuenta cambio. Actualiza la cuenta y volve a cobrar';
  END IF;

  IF p_sin_cargo = 1 THEN
    -- 3a) SIN CARGO: no entra plata, no hay movimiento de caja
    IF v_motivo IS NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Un cobro sin cargo requiere motivo';
    END IF;

    INSERT INTO rest_cobro(id_comanda, id_turno_caja, id_usuario, total, sin_cargo, id_autoriza, motivo_sin_cargo)
    VALUES (p_comanda, v_turno, p_usuario, p_total, 1, p_usuario, v_motivo);
    SET v_cobro = LAST_INSERT_ID();

    -- Auditoría en la misma transacción (RNF-SEG-04)
    INSERT INTO rest_auditoria(id_usuario, accion, tabla, id_registro, motivo, detalle)
    VALUES (p_usuario, 'SIN_CARGO', 'rest_cobro', v_cobro, v_motivo,
            CONCAT('Comanda ', v_numero, ' - total $ ', p_total));

  ELSE
    -- 3b) COBRO NORMAL (una o varias formas de pago)
    SET v_n = COALESCE(JSON_LENGTH(p_pagos), 0);

    IF p_total > 0 AND v_n = 0 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Falta indicar la forma de pago';
    END IF;

    SELECT id_codigo INTO v_codigo
    FROM rest_codigo_caja
    WHERE codigo = 'COBRO' AND activo = 1
    LIMIT 1;

    IF v_codigo IS NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Falta configurar el codigo de caja COBRO';
    END IF;

    INSERT INTO rest_cobro(id_comanda, id_turno_caja, id_usuario, total, sin_cargo, id_autoriza, motivo_sin_cargo)
    VALUES (p_comanda, v_turno, p_usuario, p_total, 0, NULL, NULL);
    SET v_cobro = LAST_INSERT_ID();

    -- Saldo actual del turno (efectivo + transferencias, como el Excel)
    SELECT saldo_total INTO v_saldo
    FROM v_caja_resumen
    WHERE id_turno_caja = v_turno;

    WHILE v_i < v_n DO
      SET v_forma   = UPPER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(p_pagos, CONCAT('$[', v_i, '].forma')))));
      SET v_importe = CAST(JSON_UNQUOTE(JSON_EXTRACT(p_pagos, CONCAT('$[', v_i, '].importe'))) AS DECIMAL(10,2));
      -- Lo de "observaciones": un null de JSON llega como el texto 'null'.
      -- Por eso se limpian tanto '' como 'null'.
      SET v_medio   = NULLIF(NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(p_pagos, CONCAT('$[', v_i, '].medio_transferencia')))), 'null'), '');

      IF v_forma = 'CARGO_HABITACION' THEN
        SIGNAL SQLSTATE '45000'
          SET MESSAGE_TEXT = 'El cargo a habitacion todavia no esta habilitado';
      END IF;

      IF v_forma IS NULL OR v_forma NOT IN ('EFECTIVO', 'TRANSFERENCIA') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Forma de pago no permitida';
      END IF;

      IF v_importe IS NULL OR v_importe <= 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Cada pago debe tener un importe mayor que cero';
      END IF;

      IF v_forma = 'TRANSFERENCIA' AND v_medio IS NULL THEN
        SIGNAL SQLSTATE '45000'
          SET MESSAGE_TEXT = 'Indica el medio de la transferencia (BNA+, Mercado Pago, Naranja X...)';
      END IF;

      IF v_forma = 'EFECTIVO' THEN
        SET v_medio = NULL;
      END IF;

      INSERT INTO rest_cobro_pago(id_cobro, forma, importe, medio_transferencia)
      VALUES (v_cobro, v_forma, v_importe, v_medio);

      SET v_saldo = v_saldo + v_importe;

      INSERT INTO rest_movimiento_caja(id_turno_caja, id_codigo, id_cobro, id_usuario,
                                       concepto, forma, medio_transferencia, ingreso, saldo)
      VALUES (v_turno, v_codigo, v_cobro, p_usuario,
              CONCAT('Cobro comanda ', v_numero), v_forma, v_medio, v_importe, v_saldo);

      SET v_suma = v_suma + v_importe;
      SET v_i = v_i + 1;
    END WHILE;

    -- La suma de los pagos tiene que dar justo el total
    IF v_suma <> p_total THEN
      SET v_msg = CONCAT('La suma de los pagos ($ ', v_suma, ') no coincide con el total ($ ', p_total, ')');
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
    END IF;
  END IF;

  -- 4) Se cierra la comanda: la mesa queda libre
  UPDATE rest_comanda
  SET estado = 'CERRADA', cierre = NOW()
  WHERE id_comanda = p_comanda;

  COMMIT;

  SELECT v_cobro AS id_cobro, v_turno AS id_turno_caja, v_numero AS numero_comanda, p_total AS total;
END$$

-- ------------------------------------------------------------
-- 6. MOVIMIENTO MANUAL (RF-CAJ-07)
-- ------------------------------------------------------------
-- Gastos, pagos a proveedores, ajustes. Si suma o resta lo decide
-- el TIPO del código (INGRESO / EGRESO), no el usuario.
-- (propuesta) No deja sacar más efectivo del que hay en el cajón.
DROP PROCEDURE IF EXISTS sp_movimiento_registrar$$
CREATE PROCEDURE sp_movimiento_registrar(
  IN p_usuario INT UNSIGNED,
  IN p_codigo VARCHAR(20),
  IN p_forma VARCHAR(30),
  IN p_medio VARCHAR(50),
  IN p_importe DECIMAL(10,2),
  IN p_concepto VARCHAR(100),
  IN p_tipo_comprobante VARCHAR(30),
  IN p_nro_comprobante VARCHAR(50),
  IN p_dni_cuit VARCHAR(20),
  IN p_huesped_proveedor VARCHAR(150),
  IN p_detalle TEXT
)
BEGIN
  DECLARE v_turno INT UNSIGNED;
  DECLARE v_codigo INT UNSIGNED;
  DECLARE v_tipo VARCHAR(20);
  DECLARE v_concepto_codigo VARCHAR(100);
  DECLARE v_forma VARCHAR(30);
  DECLARE v_medio VARCHAR(50);
  DECLARE v_efectivo DECIMAL(10,2);
  DECLARE v_saldo DECIMAL(10,2);
  DECLARE v_id INT UNSIGNED;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  SET v_forma = UPPER(TRIM(p_forma));
  SET v_medio = NULLIF(TRIM(p_medio), '');

  START TRANSACTION;

  SELECT id_turno_caja INTO v_turno
  FROM rest_turno_caja
  WHERE estado = 'ABIERTO'
  LIMIT 1
  FOR UPDATE;

  IF v_turno IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'No hay caja abierta';
  END IF;

  IF p_codigo = 'COBRO' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Los cobros se registran desde la mesa, no como movimiento manual';
  END IF;

  SELECT id_codigo, tipo, concepto INTO v_codigo, v_tipo, v_concepto_codigo
  FROM rest_codigo_caja
  WHERE codigo = p_codigo AND activo = 1;

  IF v_codigo IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Codigo de caja inexistente o inactivo';
  END IF;

  IF v_tipo NOT IN ('INGRESO', 'EGRESO') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El codigo de caja tiene un tipo invalido';
  END IF;

  IF v_forma IS NULL OR v_forma NOT IN ('EFECTIVO', 'TRANSFERENCIA') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Forma de pago no permitida';
  END IF;

  IF p_importe IS NULL OR p_importe <= 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El importe debe ser mayor que cero';
  END IF;

  IF v_forma = 'TRANSFERENCIA' AND v_medio IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Indica el medio de la transferencia';
  END IF;

  IF v_forma = 'EFECTIVO' THEN
    SET v_medio = NULL;
  END IF;

  -- No se puede sacar del cajón más efectivo del que hay
  IF v_tipo = 'EGRESO' AND v_forma = 'EFECTIVO' THEN
    SELECT efectivo_en_caja INTO v_efectivo
    FROM v_caja_resumen
    WHERE id_turno_caja = v_turno;

    IF p_importe > v_efectivo THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'No hay suficiente efectivo en caja';
    END IF;
  END IF;

  SELECT saldo_total INTO v_saldo
  FROM v_caja_resumen
  WHERE id_turno_caja = v_turno;

  IF v_tipo = 'INGRESO' THEN
    SET v_saldo = v_saldo + p_importe;
  ELSE
    SET v_saldo = v_saldo - p_importe;
  END IF;

  INSERT INTO rest_movimiento_caja(
    id_turno_caja, id_codigo, id_usuario, concepto, forma, medio_transferencia,
    tipo_comprobante, nro_comprobante, dni_cuit, huesped_proveedor, detalle,
    ingreso, egreso, saldo
  ) VALUES (
    v_turno, v_codigo, p_usuario,
    COALESCE(NULLIF(TRIM(p_concepto), ''), v_concepto_codigo),  -- si no escriben concepto, va el del código
    v_forma, v_medio,
    NULLIF(TRIM(p_tipo_comprobante), ''),
    NULLIF(TRIM(p_nro_comprobante), ''),
    NULLIF(TRIM(p_dni_cuit), ''),
    NULLIF(TRIM(p_huesped_proveedor), ''),
    NULLIF(TRIM(p_detalle), ''),
    IF(v_tipo = 'INGRESO', p_importe, 0),
    IF(v_tipo = 'EGRESO', p_importe, 0),
    v_saldo
  );
  SET v_id = LAST_INSERT_ID();

  COMMIT;

  SELECT v_id AS id_movimiento, v_turno AS id_turno_caja, v_saldo AS saldo;
END$$

-- ------------------------------------------------------------
-- 7. REAPERTURA DE CAJA CON MOTIVO (RF-CAJ-11, RNF-SEG-04)
-- ------------------------------------------------------------
-- Una caja cerrada no se puede tocar (los cobros y movimientos exigen
-- turno ABIERTO). Si hubo un error, el encargado la reabre con motivo
-- y queda registrado qué decía el cierre anterior.
-- (propuesta) Solo se puede reabrir el ÚLTIMO turno.
DROP PROCEDURE IF EXISTS sp_caja_reabrir$$
CREATE PROCEDURE sp_caja_reabrir(
  IN p_turno INT UNSIGNED,
  IN p_usuario INT UNSIGNED,
  IN p_motivo VARCHAR(255)
)
BEGIN
  DECLARE v_estado VARCHAR(20);
  DECLARE v_ultimo INT UNSIGNED;
  DECLARE v_contado DECIMAL(10,2);
  DECLARE v_diferencia DECIMAL(10,2);
  DECLARE v_obs TEXT;
  DECLARE v_motivo VARCHAR(255);
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  SET v_motivo = NULLIF(TRIM(p_motivo), '');

  IF v_motivo IS NULL OR CHAR_LENGTH(v_motivo) < 5 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Para reabrir la caja hay que escribir el motivo';
  END IF;

  START TRANSACTION;

  IF EXISTS (SELECT 1 FROM rest_turno_caja WHERE estado = 'ABIERTO') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Ya hay una caja abierta: cerrala antes de reabrir otra';
  END IF;

  SELECT estado, efectivo_contado, diferencia, observaciones
    INTO v_estado, v_contado, v_diferencia, v_obs
  FROM rest_turno_caja
  WHERE id_turno_caja = p_turno
  FOR UPDATE;

  IF v_estado IS NULL OR v_estado <> 'CERRADO' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El turno no existe o no esta cerrado';
  END IF;

  SELECT MAX(id_turno_caja) INTO v_ultimo FROM rest_turno_caja;

  IF p_turno <> v_ultimo THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Solo se puede reabrir el ultimo turno de caja';
  END IF;

  -- Se guarda cómo estaba el cierre antes de borrarlo
  INSERT INTO rest_auditoria(id_usuario, accion, tabla, id_registro, motivo, detalle)
  VALUES (p_usuario, 'REABRIR', 'rest_turno_caja', p_turno, v_motivo,
          CONCAT('Cierre anterior: contado $ ', COALESCE(v_contado, 0),
                 ' - diferencia $ ', COALESCE(v_diferencia, 0),
                 ' - obs: ', COALESCE(v_obs, '')));

  UPDATE rest_turno_caja
  SET estado               = 'ABIERTO',
      cierre               = NULL,
      id_usuario_cierre    = NULL,
      efectivo_contado     = NULL,
      efectivo_esperado    = NULL,
      total_transferencias = NULL,
      diferencia           = NULL
  WHERE id_turno_caja = p_turno;

  COMMIT;

  SELECT * FROM v_caja_resumen WHERE id_turno_caja = p_turno;
END$$

DELIMITER ;

-- ============================================================
-- FIN 90_caja.sql
-- ============================================================