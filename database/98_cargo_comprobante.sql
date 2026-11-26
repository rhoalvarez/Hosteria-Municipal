-- ============================================================
-- HOSTERÍA MUNICIPAL – Sistema del restaurante
-- Archivo: 98_cargo_comprobante.sql   (Incremento 3 – Caja)
-- Rama: cargo-y-comprobante (para revisión de Rosario)
-- ============================================================
-- Qué hace este script:
--  1. CARGO A HABITACIÓN (RF-HAB): el huésped no paga en el
--     restaurante; el consumo se anota en rest_cargo_habitacion y
--     lo cobra recepción cuando el huésped se va.
--     - NO entra en la caja: no es plata en el cajón. Por eso no
--       genera movimiento de caja ni cuenta en el arqueo.
--     - Sí cuenta como venta en las estadísticas (95_estadisticas
--       ya suma la forma CARGO_HABITACION).
--  2. FOTO DEL COMPROBANTE DE TRANSFERENCIA (RF-CAJ-13/14): cada
--     pago por transferencia puede guardar el nombre del archivo de
--     la foto (columna rest_cobro_pago.foto_comprobante, que ya
--     existía en 00_schema). La foto se guarda en una carpeta del
--     servidor; la base guarda solo el nombre.
--  3. Para ver la foto desde la caja, cada movimiento guarda de qué
--     pago salió (columna nueva id_cobro_pago).
--
-- INTEGRACIÓN CON RESERVAS (pendiente, antes de la instalación):
--   Los huéspedes alojados se leen de UN SOLO lugar: la vista
--   v_rest_estadias_activas. Hoy lee las tablas huesped y estadia de
--   00_schema (provisorias). Cuando se acuerde con el grupo de
--   reservas, se cambia SOLO esa vista para que lea sus tablas
--   (y la FK de rest_cargo_habitacion.id_estadia). El cobro, la
--   pantalla y las estadísticas no cambian.
--
-- Reemplaza sp_cobro_registrar y sp_caja_movimientos (de 90_caja).
-- No borra tablas ni datos. Se puede correr varias veces.
-- Orden: ... → 90 → 95 → 96 → 97 → 98
-- Compatible con MariaDB 10.4. Mensajes de error sin tildes.
-- Correrlo desde la terminal (HeidiSQL se cuelga con DELIMITER):
--   cmd /c "C:\xampp\mysql\bin\mysql -u root --default-character-set=utf8mb4 hosteria < database\98_cargo_comprobante.sql"
-- ============================================================

USE hosteria;

-- ------------------------------------------------------------
-- 1. COLUMNA NUEVA: de qué pago salió cada movimiento de caja
-- ------------------------------------------------------------
-- Los movimientos viejos quedan en NULL (no tienen foto).
ALTER TABLE rest_movimiento_caja
  ADD COLUMN IF NOT EXISTS id_cobro_pago INT UNSIGNED NULL AFTER id_cobro;

-- ------------------------------------------------------------
-- 2. HUÉSPEDES ALOJADOS: el ÚNICO punto de conexión con reservas
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW v_rest_estadias_activas AS
SELECT
  e.id_estadia,
  e.nro_habitacion,
  h.nombre,
  h.apellido
FROM estadia e
JOIN huesped h ON h.id_huesped = e.id_huesped
WHERE e.estado = 'ACTIVA';

DELIMITER $$

-- Lista para el combo "Cargo a habitación" de la pantalla de cobro
DROP PROCEDURE IF EXISTS sp_estadias_activas$$
CREATE PROCEDURE sp_estadias_activas()
BEGIN
  SELECT id_estadia, nro_habitacion, nombre, apellido
  FROM v_rest_estadias_activas
  ORDER BY nro_habitacion + 0, nro_habitacion;   -- 2, 3, 10 (no 10, 2, 3)
END$$

-- ------------------------------------------------------------
-- 3. MOVIMIENTOS DE UN TURNO (reemplaza el de 90_caja)
-- ------------------------------------------------------------
-- Igual que antes + "comprobante": el nombre del archivo de la foto
-- si el movimiento salió de un pago por transferencia con foto.
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
    pg.foto_comprobante AS comprobante,
    u.nombre AS usuario
  FROM rest_movimiento_caja m
  JOIN rest_codigo_caja c ON c.id_codigo = m.id_codigo
  JOIN usuario u ON u.id_usuario = m.id_usuario
  LEFT JOIN rest_cobro_pago pg ON pg.id_cobro_pago = m.id_cobro_pago
  WHERE m.id_turno_caja = p_turno
  ORDER BY m.fecha, m.id_movimiento;
END$$

-- ------------------------------------------------------------
-- 4. COBRO DE UNA COMANDA (reemplaza el de 90_caja)
-- ------------------------------------------------------------
-- p_pagos es una lista JSON, por ejemplo:
--   [{"forma":"EFECTIVO","importe":5000,"medio_transferencia":"","id_estadia":0,"comprobante":""},
--    {"forma":"TRANSFERENCIA","importe":8000,"medio_transferencia":"Mercado Pago","id_estadia":0,"comprobante":"1764190000000-ab12cd34ef56ab12.jpg"},
--    {"forma":"CARGO_HABITACION","importe":6000,"medio_transferencia":"","id_estadia":3,"comprobante":""}]
-- Cambios respecto de 90_caja:
--  - Acepta CARGO_HABITACION con id_estadia (huésped alojado).
--    No genera movimiento de caja (no es plata en el cajón).
--  - Guarda la foto del comprobante de las transferencias.
--  - Cada movimiento guarda de qué pago salió (id_cobro_pago).
-- Todo lo demás igual: turno abierto, total sin cambios, suma justa,
-- sin cargo con motivo y auditado, todo en UNA transacción.
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
  DECLARE v_pago INT UNSIGNED;
  DECLARE v_numero INT UNSIGNED;
  DECLARE v_total_comanda DECIMAL(10,2);
  DECLARE v_codigo INT UNSIGNED;
  DECLARE v_saldo DECIMAL(10,2);
  DECLARE v_n INT DEFAULT 0;
  DECLARE v_i INT DEFAULT 0;
  DECLARE v_forma VARCHAR(30);
  DECLARE v_importe DECIMAL(10,2);
  DECLARE v_medio VARCHAR(50);
  DECLARE v_estadia INT UNSIGNED;
  DECLARE v_habitacion VARCHAR(10);
  DECLARE v_foto VARCHAR(255);
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
      -- Un null de JSON llega como el texto 'null': se limpian '' y 'null'
      SET v_medio   = NULLIF(NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(p_pagos, CONCAT('$[', v_i, '].medio_transferencia')))), 'null'), '');
      SET v_foto    = NULLIF(NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(p_pagos, CONCAT('$[', v_i, '].comprobante')))), 'null'), '');
      SET v_estadia = NULLIF(CAST(COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(p_pagos, CONCAT('$[', v_i, '].id_estadia'))), 'null'), '0') AS UNSIGNED), 0);

      IF v_forma IS NULL OR v_forma NOT IN ('EFECTIVO', 'TRANSFERENCIA', 'CARGO_HABITACION') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Forma de pago no permitida';
      END IF;

      IF v_importe IS NULL OR v_importe <= 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Cada pago debe tener un importe mayor que cero';
      END IF;

      IF v_forma = 'TRANSFERENCIA' AND v_medio IS NULL THEN
        SIGNAL SQLSTATE '45000'
          SET MESSAGE_TEXT = 'Indica el medio de la transferencia (BNA+, Mercado Pago, Naranja X...)';
      END IF;

      -- Cargo a habitación: el huésped tiene que estar alojado AHORA
      SET v_habitacion = NULL;
      IF v_forma = 'CARGO_HABITACION' THEN
        IF v_estadia IS NULL THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Indica la habitacion del huesped';
        END IF;

        SELECT nro_habitacion INTO v_habitacion
        FROM v_rest_estadias_activas
        WHERE id_estadia = v_estadia;

        IF v_habitacion IS NULL THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'El huesped ya no esta alojado. Actualiza la lista de habitaciones';
        END IF;
      END IF;

      -- Lo que no corresponde a cada forma se guarda vacío
      IF v_forma <> 'TRANSFERENCIA' THEN
        SET v_medio = NULL;
        SET v_foto = NULL;
      END IF;

      INSERT INTO rest_cobro_pago(id_cobro, forma, importe, medio_transferencia, foto_comprobante)
      VALUES (v_cobro, v_forma, v_importe, v_medio, v_foto);
      SET v_pago = LAST_INSERT_ID();

      IF v_forma = 'CARGO_HABITACION' THEN
        -- No entra al cajón: queda PENDIENTE hasta que lo cobre recepción
        INSERT INTO rest_cargo_habitacion(id_cobro_pago, id_estadia, importe)
        VALUES (v_pago, v_estadia, v_importe);
      ELSE
        -- Efectivo o transferencia: movimiento de caja, como antes
        SET v_saldo = v_saldo + v_importe;

        INSERT INTO rest_movimiento_caja(id_turno_caja, id_codigo, id_cobro, id_cobro_pago, id_usuario,
                                         concepto, forma, medio_transferencia, ingreso, saldo)
        VALUES (v_turno, v_codigo, v_cobro, v_pago, p_usuario,
                CONCAT('Cobro comanda ', v_numero), v_forma, v_medio, v_importe, v_saldo);
      END IF;

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

DELIMITER ;

-- ============================================================
-- FIN 98_cargo_comprobante.sql
-- ============================================================