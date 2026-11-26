-- ============================================================
-- HOSTERÍA MUNICIPAL – Sistema del restaurante
-- Archivo: 95_estadisticas.sql   (Incremento 3 – Estadísticas)
-- Rama: estadisticas (para revisión de Rosario)
-- ============================================================
-- Qué hace este script:
--  1. Agrega un índice por fecha en rest_cobro (las estadísticas
--     siempre filtran por fecha de cobro).
--  2. sp_est_platos: ranking de platos vendidos en un período,
--     con filtro opcional por categoría (RF-EST-01).
--  3. sp_est_ingresos: ingresos por semana o por mes, separados por
--     forma de pago, con el "sin cargo" aparte (RF-EST-02).
--
-- Reglas (para la defensa):
--  - Una VENTA es una comanda COBRADA (tiene fila en rest_cobro).
--    Las mesas abiertas no cuentan: todavía pueden cambiar.
--  - Se usa la FECHA DEL COBRO para todo, así el ranking y los
--    ingresos de un período coinciden.
--  - Los ítems anulados (anulado = 1) no cuentan.
--  - Los ingresos salen de rest_cobro_pago (no de la caja): la caja
--    también tiene gastos y ajustes que no son ventas.
--  - El "sin cargo" no suma a los ingresos (no entró plata), pero
--    se muestra cuántos hubo y cuánto se dejó de cobrar.
--  - Los períodos los arma la base como TEXTO ('2026-11-23' = lunes
--    de esa semana, '2026-11' = mes). Así no se corren de día por
--    la conversión a UTC que hace mysql2 con las fechas.
--
-- Solo LEE datos: no borra ni modifica nada. Se puede correr varias
-- veces y en la base compartida.
-- Orden en una base nueva: 00 → 10 → ... → 90 → 95
-- Compatible con MariaDB 10.4 (no usa JSON_ARRAYAGG ni funciones nuevas).
-- Los mensajes de error van sin tildes, igual que en 10_procedures.
-- ============================================================

USE hosteria;

-- ------------------------------------------------------------
-- 1. ÍNDICE POR FECHA DE COBRO
-- ------------------------------------------------------------
-- Sin índice, la base tendría que leer TODOS los cobros para
-- encontrar los de una semana. Con el índice va directo.
CREATE INDEX IF NOT EXISTS idx_cobro_fecha ON rest_cobro (fecha);

DELIMITER $$

-- ------------------------------------------------------------
-- 2. RANKING DE PLATOS (RF-EST-01)
-- ------------------------------------------------------------
-- p_desde, p_hasta: días INCLUIDOS (por ejemplo, lunes a domingo).
-- p_categoria: id de la categoría, o NULL / 0 para todas.
-- Devuelve una fila por plato, del más vendido al menos vendido.
-- Incluye los platos dados de baja (son ventas que existieron).
DROP PROCEDURE IF EXISTS sp_est_platos$$
CREATE PROCEDURE sp_est_platos(
  IN p_desde DATE,
  IN p_hasta DATE,
  IN p_categoria INT UNSIGNED
)
BEGIN
  IF p_desde IS NULL OR p_hasta IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Indica la fecha desde y la fecha hasta';
  END IF;

  IF p_desde > p_hasta THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La fecha desde no puede ser posterior a la fecha hasta';
  END IF;

  -- (propuesta) Como máximo un poco más de un año por consulta
  IF DATEDIFF(p_hasta, p_desde) > 400 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El periodo no puede ser mayor a un año';
  END IF;

  SELECT
    i.id_item,
    i.codigo,
    i.nombre,
    cat.id_categoria,
    cat.letra,
    cat.nombre                                  AS categoria,
    SUM(pi.cantidad)                            AS cantidad,
    SUM(pi.importe)                             AS importe,
    -- Cuántas de esas unidades fueron en cobros "sin cargo"
    SUM(IF(c.sin_cargo = 1, pi.cantidad, 0))    AS cantidad_sin_cargo
  FROM rest_cobro c
  JOIN rest_pedido p        ON p.id_comanda   = c.id_comanda
  JOIN rest_pedido_item pi  ON pi.id_pedido   = p.id_pedido
                           AND pi.anulado     = 0
  JOIN rest_item_menu i     ON i.id_item      = pi.id_item
  JOIN rest_categoria cat   ON cat.id_categoria = i.id_categoria
  -- "Menor que el día siguiente" en vez de DATE(c.fecha) BETWEEN...:
  -- así la base puede usar el índice por fecha.
  WHERE c.fecha >= p_desde
    AND c.fecha <  DATE_ADD(p_hasta, INTERVAL 1 DAY)
    AND (p_categoria IS NULL OR p_categoria = 0 OR i.id_categoria = p_categoria)
  GROUP BY i.id_item, i.codigo, i.nombre, cat.id_categoria, cat.letra, cat.nombre
  ORDER BY cantidad DESC, importe DESC, i.codigo;
END$$

-- ------------------------------------------------------------
-- 3. INGRESOS POR SEMANA O POR MES (RF-EST-02)
-- ------------------------------------------------------------
-- p_agrupar: 'SEMANA' (de lunes a domingo, propuesta) o 'MES'.
-- Devuelve UNA FILA POR PERÍODO con columnas por forma de pago.
-- cargo_habitacion queda en 0 hasta que se habilite (Inc. 3, RF-HAB).
DROP PROCEDURE IF EXISTS sp_est_ingresos$$
CREATE PROCEDURE sp_est_ingresos(
  IN p_desde DATE,
  IN p_hasta DATE,
  IN p_agrupar VARCHAR(10)
)
BEGIN
  DECLARE v_agrupar VARCHAR(10);

  SET v_agrupar = UPPER(TRIM(p_agrupar));

  IF p_desde IS NULL OR p_hasta IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Indica la fecha desde y la fecha hasta';
  END IF;

  IF p_desde > p_hasta THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La fecha desde no puede ser posterior a la fecha hasta';
  END IF;

  IF DATEDIFF(p_hasta, p_desde) > 400 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El periodo no puede ser mayor a un año';
  END IF;

  IF v_agrupar IS NULL OR v_agrupar NOT IN ('SEMANA', 'MES') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Agrupar debe ser SEMANA o MES';
  END IF;

  -- Paso A (subconsulta x): UNA fila por cobro, con lo que se pagó
  --   en cada forma. LEFT JOIN porque un cobro sin cargo no tiene pagos.
  -- Paso B (consulta de afuera): se suman los cobros de cada período.
  SELECT
    x.periodo,
    SUM(x.efectivo)                                     AS efectivo,
    SUM(x.transferencia)                                AS transferencia,
    SUM(x.cargo_habitacion)                             AS cargo_habitacion,
    SUM(x.efectivo + x.transferencia + x.cargo_habitacion) AS total,
    SUM(IF(x.sin_cargo = 0, 1, 0))                      AS cantidad_cobros,
    SUM(IF(x.sin_cargo = 1, 1, 0))                      AS cantidad_sin_cargo,
    SUM(IF(x.sin_cargo = 1, x.total_comanda, 0))        AS valor_sin_cargo
  FROM (
    SELECT
      c.id_cobro,
      c.sin_cargo,
      c.total AS total_comanda,
      CASE
        WHEN v_agrupar = 'MES'
          THEN DATE_FORMAT(c.fecha, '%Y-%m')
        -- WEEKDAY: lunes = 0 ... domingo = 6. Restando eso se llega
        -- al lunes de la semana del cobro.
        ELSE DATE_FORMAT(DATE_SUB(DATE(c.fecha), INTERVAL WEEKDAY(c.fecha) DAY), '%Y-%m-%d')
      END AS periodo,
      COALESCE(SUM(IF(pg.forma = 'EFECTIVO',         pg.importe, 0)), 0) AS efectivo,
      COALESCE(SUM(IF(pg.forma = 'TRANSFERENCIA',    pg.importe, 0)), 0) AS transferencia,
      COALESCE(SUM(IF(pg.forma = 'CARGO_HABITACION', pg.importe, 0)), 0) AS cargo_habitacion
    FROM rest_cobro c
    LEFT JOIN rest_cobro_pago pg ON pg.id_cobro = c.id_cobro
    WHERE c.fecha >= p_desde
      AND c.fecha <  DATE_ADD(p_hasta, INTERVAL 1 DAY)
    GROUP BY c.id_cobro, c.sin_cargo, c.total, periodo
  ) x
  GROUP BY x.periodo
  ORDER BY x.periodo;
END$$

DELIMITER ;

-- ============================================================
-- FIN 95_estadisticas.sql
-- ============================================================