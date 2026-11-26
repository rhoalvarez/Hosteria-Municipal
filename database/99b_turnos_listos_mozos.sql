-- ============================================================
-- HOSTERÍA MUNICIPAL – Sistema del restaurante
-- Archivo: 99b_turnos_listos_mozos.sql
-- Rama: turnos-listos-mozos (para revisión de Rosario)
-- ============================================================
-- Qué hace este script (tres cosas chicas):
--  1. TURNOS DE CAJA mañana / tarde / noche (RF-CAJ-10, a confirmar
--     con la hostería): al abrir la caja se elige el turno. Sigue
--     habiendo UNA sola caja abierta a la vez: cada turno abre y
--     cierra la suya, con su arqueo y su responsable (como el Excel).
--     - Columna nueva rest_turno_caja.turno ('MANANA', 'TARDE', 'NOCHE';
--       sin Ñ a propósito, la pantalla muestra "Mañana").
--     - v_caja_resumen ahora incluye el turno (mismo cálculo que 90_caja).
--     - sp_caja_abrir_turno: abre la caja con el turno. El
--       sp_caja_abrir de 10_procedures no se toca.
--  2. AVISO AL MOZO DE PEDIDOS LISTOS (RF-PED-05):
--     sp_pedidos_listos: pedidos en estado LISTO de mesas que siguen
--     abiertas. Cuando se cobra la mesa, dejan de aparecer solos.
--  3. VENTAS POR MOZO Y COMENSALES (RF-EST-05):
--     sp_est_mozos: mismas reglas que 95_estadisticas (solo mesas
--     COBRADAS, por la fecha del cobro; el sin cargo aparte).
--
-- No borra tablas ni datos. Se puede correr varias veces.
-- Orden: ... → 97 → 98 → 99 → 99b
-- Correrlo desde la terminal:
--   cmd /c "C:\xampp\mysql\bin\mysql -u root --default-character-set=utf8mb4 hosteria < database\99b_turnos_listos_mozos.sql"
-- Compatible con MariaDB 10.4. Mensajes de error sin tildes.
-- ============================================================

USE hosteria;

-- ------------------------------------------------------------
-- 1. TURNOS DE CAJA
-- ------------------------------------------------------------
-- Los turnos que ya existen quedan sin turno (NULL): la pantalla
-- muestra solo el número, como antes.
ALTER TABLE rest_turno_caja
  ADD COLUMN IF NOT EXISTS turno VARCHAR(10) NULL AFTER fecha;

-- La misma vista de 90_caja + la columna turno
CREATE OR REPLACE VIEW v_caja_resumen AS
SELECT
  t.id_turno_caja,
  t.fecha,
  t.turno,
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

-- Abrir la caja con el turno elegido
DROP PROCEDURE IF EXISTS sp_caja_abrir_turno$$
CREATE PROCEDURE sp_caja_abrir_turno(
  IN p_usuario INT UNSIGNED,
  IN p_saldo DECIMAL(10,2),
  IN p_turno VARCHAR(10)
)
BEGIN
  DECLARE v_turno VARCHAR(10);
  DECLARE v_id INT UNSIGNED;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  SET v_turno = UPPER(TRIM(p_turno));

  IF v_turno IS NULL OR v_turno NOT IN ('MANANA', 'TARDE', 'NOCHE') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Elegi el turno: manana, tarde o noche';
  END IF;

  IF p_saldo IS NULL OR p_saldo < 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El saldo inicial es invalido';
  END IF;

  START TRANSACTION;

  -- Una sola caja abierta a la vez (además está el UNIQUE uq_un_turno_caja_abierto)
  IF EXISTS (SELECT 1 FROM rest_turno_caja WHERE estado = 'ABIERTO' FOR UPDATE) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Ya hay una caja abierta: el turno anterior tiene que cerrarla primero';
  END IF;

  INSERT INTO rest_turno_caja(fecha, turno, id_usuario_apertura, saldo_inicial)
  VALUES (CURDATE(), v_turno, p_usuario, p_saldo);
  SET v_id = LAST_INSERT_ID();

  COMMIT;

  SELECT v_id AS id_turno_caja, v_turno AS turno;
END$$

-- ------------------------------------------------------------
-- 2. PEDIDOS LISTOS PARA LLEVAR (aviso al mozo)
-- ------------------------------------------------------------
-- Pedidos que cocina marcó LISTO, de mesas que siguen ABIERTAS.
-- "Ya lo llevé" se guarda en el celular de cada mozo (no en la base:
-- la ERS no tiene un estado "entregado").
DROP PROCEDURE IF EXISTS sp_pedidos_listos$$
CREATE PROCEDURE sp_pedidos_listos()
BEGIN
  SELECT
    p.id_pedido,
    p.listo,
    m.id_mesa,
    m.numero AS mesa_numero,
    u.nombre AS mozo
  FROM rest_pedido p
  JOIN rest_comanda c ON c.id_comanda = p.id_comanda AND c.estado = 'ABIERTA'
  JOIN rest_mesa m    ON m.id_mesa = c.id_mesa
  JOIN usuario u      ON u.id_usuario = c.id_mozo
  WHERE p.estado = 'LISTO'
  ORDER BY p.listo, p.id_pedido;
END$$

-- ------------------------------------------------------------
-- 3. VENTAS POR MOZO Y COMENSALES (RF-EST-05)
-- ------------------------------------------------------------
-- El mozo es el de la comanda (el que abrió la mesa).
-- Los promedios los calcula la pantalla (evita dividir por cero acá).
DROP PROCEDURE IF EXISTS sp_est_mozos$$
CREATE PROCEDURE sp_est_mozos(
  IN p_desde DATE,
  IN p_hasta DATE
)
BEGIN
  IF p_desde IS NULL OR p_hasta IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Indica la fecha desde y la fecha hasta';
  END IF;

  IF p_desde > p_hasta THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La fecha desde no puede ser posterior a la fecha hasta';
  END IF;

  IF DATEDIFF(p_hasta, p_desde) > 400 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El periodo no puede ser mayor a un año';
  END IF;

  SELECT
    u.id_usuario,
    u.nombre                                   AS mozo,
    SUM(IF(c.sin_cargo = 0, 1, 0))             AS mesas_cobradas,
    SUM(IF(c.sin_cargo = 0, co.personas, 0))   AS comensales,
    SUM(IF(c.sin_cargo = 0, c.total, 0))       AS total_vendido,
    SUM(IF(c.sin_cargo = 1, 1, 0))             AS cantidad_sin_cargo,
    SUM(IF(c.sin_cargo = 1, c.total, 0))       AS valor_sin_cargo
  FROM rest_cobro c
  JOIN rest_comanda co ON co.id_comanda = c.id_comanda
  JOIN usuario u       ON u.id_usuario = co.id_mozo
  WHERE c.fecha >= p_desde
    AND c.fecha <  DATE_ADD(p_hasta, INTERVAL 1 DAY)
  GROUP BY u.id_usuario, u.nombre
  ORDER BY total_vendido DESC, u.nombre;
END$$

DELIMITER ;

-- ============================================================
-- FIN 99b_turnos_listos_mozos.sql
-- ============================================================