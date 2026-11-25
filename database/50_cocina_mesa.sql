-- =====================================================
-- 50_cocina_mesa.sql
-- Cocina: agregar el número de mesa a los pedidos pendientes
-- -----------------------------------------------------
-- Propuesta de Luján (frontend) para Rosario (backend).
-- Probado en la base local de Luján.
--
-- Problema: sp_cocina_pedidos no devolvía la mesa, y la tarjeta
-- de cocina mostraba "Mesa ?": la cocina no sabía a qué mesa
-- iba cada plato.
--
-- Cambios respecto de la versión de 30_correcciones.sql:
--  1. JOIN con rest_comanda y rest_mesa → m.numero AS mesa_numero
--     (y c.id_mesa, por si algún día hace falta el id).
--  2. rest_mesa con LEFT JOIN: un pedido de MOSTRADOR podría no
--     tener mesa; con INNER JOIN desaparecería de la cocina.
--     En ese caso mesa_numero llega NULL y el frontend muestra "?".
--  3. usuario con LEFT JOIN: en el Inc. 2 el cliente pide por QR
--     SIN usuario; con INNER JOIN ese pedido nunca llegaría a la
--     cocina. (A revisar cuando se haga el Inc. 2.)
-- El resto (filtro, orden, minutos_espera) queda igual.
--
-- No toca tablas ni datos: solo reemplaza el procedimiento.
-- Se puede correr las veces que haga falta.
-- =====================================================

USE hosteria;

DELIMITER $$

DROP PROCEDURE IF EXISTS sp_cocina_pedidos$$

CREATE PROCEDURE sp_cocina_pedidos()
BEGIN
    SELECT
        p.id_pedido,
        p.id_comanda,
        c.id_mesa,
        m.numero AS mesa_numero,          -- NUEVO: lo que muestra la tarjeta
        p.estado,
        p.creado,
        TIMESTAMPDIFF(MINUTE, p.creado, NOW()) AS minutos_espera,
        u.nombre AS mozo,
        pi.id_item,
        i.nombre AS articulo,
        pi.cantidad,
        pi.observaciones
    FROM rest_pedido p
    INNER JOIN rest_comanda c              -- todo pedido pertenece a una comanda
        ON c.id_comanda = p.id_comanda
    LEFT JOIN rest_mesa m                  -- LEFT: por si la comanda no tiene mesa
        ON m.id_mesa = c.id_mesa
    LEFT JOIN usuario u                    -- LEFT: pedido por QR sin usuario (Inc. 2)
        ON u.id_usuario = p.id_usuario
    INNER JOIN rest_pedido_item pi
        ON pi.id_pedido = p.id_pedido
    INNER JOIN rest_item_menu i
        ON i.id_item = pi.id_item
    WHERE p.estado = 'PENDIENTE'
      AND pi.anulado = 0
    ORDER BY p.creado, p.id_pedido;
END$$

DELIMITER ;
