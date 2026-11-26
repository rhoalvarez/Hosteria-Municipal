-- ============================================================
-- HOSTERÍA MUNICIPAL – Sistema del restaurante
-- Archivo: 99_aumento_precios.sql   (Menú – aumento de precios)
-- Rama: aumento-precios (para revisión de Rosario)
-- ============================================================
-- Para qué: en el relevamiento, la hostería dijo que los precios
-- cambian cada 6 meses aprox. En vez de editar plato por plato, el
-- encargado sube un % a todos los platos (o a una categoría).
--
-- Cómo funciona:
--  1. fn_precio_aumentado: LA fórmula, en un solo lugar.
--     nuevo = precio × (1 + % / 100), redondeado HACIA ARRIBA al
--     múltiplo elegido (1, 10, 50 o 100 pesos).
--     Ej.: 9.500 + 15 % = 10.925 → redondeo 100 → 11.000
--  2. sp_menu_aumento_vista: vista previa (precio actual y nuevo),
--     NO cambia nada. Usa la misma fórmula: lo que se ve es lo que
--     se aplica.
--  3. sp_menu_aumento_aplicar: aplica el aumento a TODOS los platos
--     elegidos en UNA transacción (si algo falla, no cambia ninguno:
--     nunca quedan la mitad con precio viejo y la mitad con nuevo) y
--     lo deja en la auditoría.
--
-- Solo platos ACTIVOS (propuesta). Los dados de baja conservan su
-- precio: al reactivarlos, la pantalla ya avisa que lo revisen.
-- Los pedidos ya hechos NO cambian: cada uno guardó su precio.
--
-- No borra nada. Se puede correr varias veces.
-- Correrlo desde la terminal:
--   cmd /c "C:\xampp\mysql\bin\mysql -u root --default-character-set=utf8mb4 hosteria < database\99_aumento_precios.sql"
-- Compatible con MariaDB 10.4. Mensajes de error sin tildes.
-- ============================================================

USE hosteria;

DELIMITER $$

-- ------------------------------------------------------------
-- 1. LA FÓRMULA (en un solo lugar)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS fn_precio_aumentado$$
CREATE FUNCTION fn_precio_aumentado(
  p_precio DECIMAL(10,2),
  p_porcentaje DECIMAL(5,2),
  p_redondeo INT UNSIGNED
) RETURNS DECIMAL(10,2)
DETERMINISTIC
BEGIN
  -- ROUND(..., 2) antes del CEIL: evita que un 10.925,0000001 suba
  -- un escalón de más por los decimales de la cuenta
  RETURN CEIL(ROUND(p_precio * (1 + p_porcentaje / 100), 2) / p_redondeo) * p_redondeo;
END$$

-- ------------------------------------------------------------
-- 2. Validación común (la usan la vista previa y el aplicar)
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_menu_aumento_validar$$
CREATE PROCEDURE sp_menu_aumento_validar(
  IN p_porcentaje DECIMAL(5,2),
  IN p_categoria INT UNSIGNED,
  IN p_redondeo INT UNSIGNED
)
BEGIN
  IF p_porcentaje IS NULL OR p_porcentaje <= 0 OR p_porcentaje > 100 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El porcentaje tiene que ser mayor que 0 y como maximo 100';
  END IF;

  IF p_redondeo IS NULL OR p_redondeo NOT IN (1, 10, 50, 100) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El redondeo tiene que ser 1, 10, 50 o 100';
  END IF;

  IF p_categoria IS NOT NULL AND p_categoria <> 0
     AND NOT EXISTS (SELECT 1 FROM rest_categoria WHERE id_categoria = p_categoria) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La categoria no existe';
  END IF;
END$$

-- ------------------------------------------------------------
-- 3. VISTA PREVIA (no cambia nada)
-- ------------------------------------------------------------
-- p_categoria: id de la categoría, o 0 para todas.
DROP PROCEDURE IF EXISTS sp_menu_aumento_vista$$
CREATE PROCEDURE sp_menu_aumento_vista(
  IN p_porcentaje DECIMAL(5,2),
  IN p_categoria INT UNSIGNED,
  IN p_redondeo INT UNSIGNED
)
BEGIN
  CALL sp_menu_aumento_validar(p_porcentaje, p_categoria, p_redondeo);

  SELECT
    i.id_item,
    i.codigo,
    i.nombre,
    c.letra,
    i.precio AS precio_actual,
    fn_precio_aumentado(i.precio, p_porcentaje, p_redondeo) AS precio_nuevo
  FROM rest_item_menu i
  JOIN rest_categoria c ON c.id_categoria = i.id_categoria
  WHERE i.activo = 1
    AND (p_categoria IS NULL OR p_categoria = 0 OR i.id_categoria = p_categoria)
  ORDER BY i.codigo;
END$$

-- ------------------------------------------------------------
-- 4. APLICAR (una transacción + auditoría)
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_menu_aumento_aplicar$$
CREATE PROCEDURE sp_menu_aumento_aplicar(
  IN p_porcentaje DECIMAL(5,2),
  IN p_categoria INT UNSIGNED,
  IN p_redondeo INT UNSIGNED,
  IN p_usuario INT UNSIGNED
)
BEGIN
  DECLARE v_cantidad INT DEFAULT 0;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  CALL sp_menu_aumento_validar(p_porcentaje, p_categoria, p_redondeo);

  START TRANSACTION;

  UPDATE rest_item_menu
  SET precio = fn_precio_aumentado(precio, p_porcentaje, p_redondeo)
  WHERE activo = 1
    AND (p_categoria IS NULL OR p_categoria = 0 OR id_categoria = p_categoria);

  SET v_cantidad = ROW_COUNT();

  -- Auditoría en la misma transacción: quién, cuándo, cuánto y a qué
  INSERT INTO rest_auditoria(id_usuario, accion, tabla, id_registro, motivo, detalle)
  VALUES (p_usuario, 'AUMENTO_PRECIOS', 'rest_item_menu', NULLIF(p_categoria, 0), NULL,
          CONCAT('Aumento ', p_porcentaje, '% - redondeo $ ', p_redondeo,
                 ' - categoria ', IF(p_categoria IS NULL OR p_categoria = 0, 'TODAS', p_categoria),
                 ' - platos ', v_cantidad));

  COMMIT;

  SELECT v_cantidad AS platos_actualizados;
END$$

DELIMITER ;

-- ============================================================
-- FIN 99_aumento_precios.sql
-- ============================================================