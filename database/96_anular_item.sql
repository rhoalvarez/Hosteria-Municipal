-- =====================================================================
--  96_anular_item.sql  –  RF-PED-06: anular un ítem ya enviado a cocina
-- ---------------------------------------------------------------------
--  Se corre DESPUÉS de 95_estadisticas.sql.
--  No borra datos ni cambia tablas: solo crea (o reemplaza)
--  procedimientos. Se puede correr varias veces.
--
--  Usa columnas que ya existen en rest_pedido_item (00_schema):
--  anulado, motivo_anulacion, id_usuario_anula.
--
--  Reglas:
--  - Solo el encargado anula (lo controla la ruta del backend).
--  - El motivo es obligatorio (mínimo 5 letras, igual que la reapertura
--    de caja).
--  - Se anula el renglón entero (propuesta): no se anula "1 de 3".
--  - Solo en comandas ABIERTAS (también con la cuenta pedida).
--    En una comanda cobrada no se puede, porque la plata ya entró.
--  - No se puede anular dos veces el mismo ítem.
--  - El ítem NO se borra: queda marcado con anulado = 1, quién lo anuló
--    y por qué. Así se puede controlar después (RNF-SEG-04).
--  - En la MISMA transacción: marca el ítem, recalcula
--    rest_comanda.total (si no, el cobro falla porque el total no
--    coincide) y deja el registro en rest_auditoria.
--    O se hacen las tres cosas o no se hace ninguna.
--  - Compatible con MariaDB 10.4 (sin funciones nuevas).
--
--  Además reemplaza sp_mesa_pedidos (de Rosario) con UNA columna más:
--  pi.id_pedido_item. La pantalla de la mesa la necesita para saber
--  qué renglón anular. El resto del procedimiento queda igual.
-- =====================================================================

DELIMITER $$

-- ---------------------------------------------------------------------
-- 1) Anular un ítem
-- ---------------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_item_anular$$

CREATE PROCEDURE sp_item_anular(
    IN p_pedido_item INT UNSIGNED,   -- id_pedido_item que se anula
    IN p_usuario     INT UNSIGNED,   -- encargado que anula (sale del token)
    IN p_motivo      VARCHAR(255)    -- por qué se anula
)
BEGIN
    DECLARE v_comanda INT UNSIGNED  DEFAULT NULL;
    DECLARE v_estado  VARCHAR(20)   DEFAULT NULL;
    DECLARE v_anulado TINYINT       DEFAULT NULL;
    DECLARE v_detalle TEXT          DEFAULT NULL;

    -- Si algo falla en el medio, se deshace todo y el error sube al backend
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    -- Validar el motivo antes de tocar nada
    SET p_motivo = TRIM(COALESCE(p_motivo, ''));
    IF CHAR_LENGTH(p_motivo) < 5 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'El motivo es obligatorio (mínimo 5 letras)';
    END IF;

    START TRANSACTION;

    -- Buscar el ítem, su comanda y armar el detalle para la auditoría.
    -- FOR UPDATE bloquea estas filas hasta el COMMIT: si al mismo tiempo
    -- alguien está cobrando la mesa, uno espera al otro (no se pisan).
    SELECT p.id_comanda,
           c.estado,
           pi.anulado,
           CONCAT(pi.cantidad, ' x ', i.codigo, ' ', i.nombre,
                  ' - $', pi.importe,
                  ' - comanda N° ', COALESCE(c.numero, c.id_comanda))
      INTO v_comanda, v_estado, v_anulado, v_detalle
      FROM rest_pedido_item pi
      JOIN rest_pedido      p ON p.id_pedido   = pi.id_pedido
      JOIN rest_comanda     c ON c.id_comanda  = p.id_comanda
      JOIN rest_item_menu   i ON i.id_item     = pi.id_item
     WHERE pi.id_pedido_item = p_pedido_item
       FOR UPDATE;

    -- Controles (cada uno con un mensaje claro para la pantalla)
    IF v_comanda IS NULL THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'El ítem no existe';
    END IF;

    IF v_anulado = 1 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'El ítem ya estaba anulado';
    END IF;

    IF v_estado <> 'ABIERTA' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'No se puede anular: la comanda ya está cerrada o cobrada';
    END IF;

    -- Marcar el ítem como anulado (no se borra)
    UPDATE rest_pedido_item
       SET anulado          = 1,
           motivo_anulacion = p_motivo,
           id_usuario_anula = p_usuario
     WHERE id_pedido_item = p_pedido_item
       AND anulado = 0;

    -- Recalcular el total de la comanda.
    -- Es la MISMA fórmula que usa 10_procedures.sql (línea 97),
    -- así el total se calcula igual en todo el sistema.
    UPDATE rest_comanda
       SET total = (SELECT COALESCE(SUM(pi.importe), 0)
                      FROM rest_pedido p
                      JOIN rest_pedido_item pi ON pi.id_pedido = p.id_pedido
                     WHERE p.id_comanda = v_comanda
                       AND pi.anulado = 0)
     WHERE id_comanda = v_comanda;

    -- Dejar constancia en la auditoría (reemplaza la firma en papel)
    INSERT INTO rest_auditoria (id_usuario, accion, tabla, id_registro, motivo, detalle)
    VALUES (p_usuario, 'ANULAR_ITEM', 'rest_pedido_item', p_pedido_item, p_motivo, v_detalle);

    COMMIT;

    -- Devolver el resultado para que la pantalla muestre el total nuevo
    SELECT p_pedido_item AS id_pedido_item,
           id_comanda,
           total
      FROM rest_comanda
     WHERE id_comanda = v_comanda;
END$$

-- ---------------------------------------------------------------------
-- 2) Pedidos de una mesa (versión de Rosario + id_pedido_item)
--    ÚNICO cambio: la línea marcada con "<-- NUEVO".
--    Una columna de más no rompe a quien ya lo usa: api.js lee
--    las columnas por nombre.
-- ---------------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_mesa_pedidos$$

CREATE PROCEDURE sp_mesa_pedidos(
    IN p_mesa INT UNSIGNED
)
BEGIN
    SELECT
        c.id_comanda,
        c.numero AS numero_comanda,
        c.personas,
        c.cuenta_pedida,
        p.id_pedido,
        p.estado AS estado_pedido,
        p.creado,
        u.nombre AS mozo,
        pi.id_pedido_item,          -- <-- NUEVO (RF-PED-06)
        pi.id_item,
        i.nombre AS articulo,
        pi.cantidad,
        pi.precio_unitario,
        pi.importe,
        pi.observaciones
    FROM rest_comanda c
    LEFT JOIN rest_pedido p
        ON p.id_comanda = c.id_comanda
    LEFT JOIN usuario u
        ON u.id_usuario = c.id_mozo
    LEFT JOIN rest_pedido_item pi
        ON pi.id_pedido = p.id_pedido
       AND pi.anulado = 0
    LEFT JOIN rest_item_menu i
        ON i.id_item = pi.id_item
    WHERE c.id_mesa = p_mesa
      AND c.estado = 'ABIERTA'
    ORDER BY p.creado, p.id_pedido;
END$$

DELIMITER ;