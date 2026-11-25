USE hosteria;

DELIMITER $$

-- =====================================================
-- 1. PREPARAR NUMERO DE COMANDA
-- =====================================================

ALTER TABLE rest_comanda
MODIFY numero INT UNSIGNED NULL$$


-- =====================================================
-- 2. FECHA DE SOLICITUD DE CUENTA
-- =====================================================

ALTER TABLE rest_comanda
ADD COLUMN IF NOT EXISTS cuenta_pedida DATETIME NULL$$


-- =====================================================
-- 3. ABRIR COMANDA Y ASIGNAR NUMERO
-- =====================================================

DROP PROCEDURE IF EXISTS sp_comanda_abrir$$

CREATE PROCEDURE sp_comanda_abrir(
    IN p_mesa INT UNSIGNED,
    IN p_mozo INT UNSIGNED,
    IN p_personas TINYINT UNSIGNED
)
BEGIN
    DECLARE v_comanda INT UNSIGNED;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF p_mesa IS NULL OR p_mesa = 0 THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Mesa invalida';
    END IF;

    IF p_personas IS NULL OR p_personas < 1 OR p_personas > 20 THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'La cantidad de personas debe ser de 1 a 20';
    END IF;

    START TRANSACTION;

    INSERT INTO rest_comanda (
        numero,
        id_mesa,
        id_mozo,
        personas
    )
    VALUES (
        NULL,
        p_mesa,
        p_mozo,
        p_personas
    );

    SET v_comanda = LAST_INSERT_ID();

    UPDATE rest_comanda
    SET numero = v_comanda
    WHERE id_comanda = v_comanda;

    COMMIT;

    SELECT
        id_comanda,
        numero,
        id_mesa,
        personas
    FROM rest_comanda
    WHERE id_comanda = v_comanda;
END$$


-- =====================================================
-- 4. LISTAR MESAS CON SU ESTADO
-- =====================================================

DROP PROCEDURE IF EXISTS sp_mesa_listar$$

CREATE PROCEDURE sp_mesa_listar()
BEGIN
    SELECT
        m.id_mesa,
        m.numero,
        m.capacidad,
        m.codigo_qr,
        m.activa,
        CASE
            WHEN c.cuenta_pedida IS NOT NULL THEN 'CUENTA_PEDIDA'
            WHEN c.id_comanda IS NOT NULL THEN 'OCUPADA'
            ELSE 'LIBRE'
        END AS estado,
        (
            SELECT COUNT(*)
            FROM rest_pedido_qr qr
            WHERE qr.id_mesa = m.id_mesa
              AND qr.estado = 'POR_CONFIRMAR'
        ) AS pedidos_qr
    FROM rest_mesa m
    LEFT JOIN rest_comanda c
        ON c.id_mesa = m.id_mesa
       AND c.estado = 'ABIERTA'
    ORDER BY m.numero;
END$$


-- =====================================================
-- 5. CREAR PEDIDO CON VALIDACIONES Y TRANSACCION
-- =====================================================

DROP PROCEDURE IF EXISTS sp_pedido_crear$$

CREATE PROCEDURE sp_pedido_crear(
    IN p_comanda INT UNSIGNED,
    IN p_uid VARCHAR(50),
    IN p_origen VARCHAR(20),
    IN p_usuario INT UNSIGNED,
    IN p_items JSON
)
BEGIN
    DECLARE v_pedido INT UNSIGNED;
    DECLARE v_i INT DEFAULT 0;
    DECLARE v_n INT DEFAULT 0;
    DECLARE v_item INT UNSIGNED;
    DECLARE v_cantidad INT UNSIGNED;
    DECLARE v_obs VARCHAR(100);
    DECLARE v_precio DECIMAL(10,2);
    DECLARE v_activo BOOLEAN;
    DECLARE v_cuenta DATETIME;
    DECLARE v_existe INT DEFAULT 0;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    SELECT COUNT(*)
    INTO v_existe
    FROM rest_comanda
    WHERE id_comanda = p_comanda
      AND estado = 'ABIERTA';

    IF v_existe = 0 THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'La comanda no existe o no esta abierta';
    END IF;

    SELECT cuenta_pedida
    INTO v_cuenta
    FROM rest_comanda
    WHERE id_comanda = p_comanda
      AND estado = 'ABIERTA'
    FOR UPDATE;

    IF v_cuenta IS NOT NULL THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'La cuenta ya fue solicitada';
    END IF;

    IF p_origen IS NULL OR p_origen NOT IN ('SALON', 'MOSTRADOR', 'QR') THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Origen de pedido invalido';
    END IF;

    IF p_uid IS NULL OR TRIM(p_uid) = '' THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'El UID del pedido es obligatorio';
    END IF;

    IF p_items IS NULL OR JSON_VALID(p_items) = 0 THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Los articulos deben tener formato JSON valido';
    END IF;

    SET v_n = JSON_LENGTH(p_items);

    IF v_n IS NULL OR v_n = 0 THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'El pedido debe contener articulos';
    END IF;

    INSERT INTO rest_pedido (
        id_comanda,
        uid,
        origen,
        id_usuario
    )
    VALUES (
        p_comanda,
        p_uid,
        p_origen,
        p_usuario
    );

    SET v_pedido = LAST_INSERT_ID();

    WHILE v_i < v_n DO

        SET v_precio = NULL;
        SET v_activo = NULL;
        SET v_item = NULL;
        SET v_cantidad = NULL;
        SET v_obs = NULL;

        SET v_item = CAST(
            JSON_UNQUOTE(
                JSON_EXTRACT(
                    p_items,
                    CONCAT('$[', v_i, '].id_item')
                )
            ) AS UNSIGNED
        );

        SET v_cantidad = CAST(
            JSON_UNQUOTE(
                JSON_EXTRACT(
                    p_items,
                    CONCAT('$[', v_i, '].cantidad')
                )
            ) AS UNSIGNED
        );

        SET v_obs = JSON_UNQUOTE(
            JSON_EXTRACT(
                p_items,
                CONCAT('$[', v_i, '].observaciones')
            )
        );

        IF v_item IS NULL OR v_item = 0 THEN
            SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Articulo invalido';
        END IF;

        IF v_cantidad IS NULL OR v_cantidad < 1 OR v_cantidad > 50 THEN
            SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'La cantidad debe estar entre 1 y 50';
        END IF;

        IF v_obs IS NOT NULL AND CHAR_LENGTH(v_obs) > 100 THEN
            SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Las observaciones superan los 100 caracteres';
        END IF;

        SELECT precio, activo
        INTO v_precio, v_activo
        FROM rest_item_menu
        WHERE id_item = v_item
          AND agotado = 0
        LIMIT 1;

        IF v_activo IS NULL OR v_activo = 0 OR v_precio IS NULL THEN
            SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Articulo inexistente, inactivo o agotado';
        END IF;

        INSERT INTO rest_pedido_item (
            id_pedido,
            id_item,
            cantidad,
            precio_unitario,
            importe,
            observaciones
        )
        VALUES (
            v_pedido,
            v_item,
            v_cantidad,
            v_precio,
            v_precio * v_cantidad,
            v_obs
        );

        SET v_i = v_i + 1;

    END WHILE;

    UPDATE rest_comanda
    SET total = (
        SELECT COALESCE(SUM(pi.importe), 0)
        FROM rest_pedido p
        INNER JOIN rest_pedido_item pi
            ON pi.id_pedido = p.id_pedido
        WHERE p.id_comanda = p_comanda
          AND pi.anulado = 0
    )
    WHERE id_comanda = p_comanda;

    COMMIT;

    SELECT v_pedido AS id_pedido;
END$$


-- =====================================================
-- 6. SOLICITAR CUENTA
-- =====================================================

DROP PROCEDURE IF EXISTS sp_comanda_pedir_cuenta$$

CREATE PROCEDURE sp_comanda_pedir_cuenta(
    IN p_comanda INT UNSIGNED
)
BEGIN
    UPDATE rest_comanda
    SET cuenta_pedida = NOW()
    WHERE id_comanda = p_comanda
      AND estado = 'ABIERTA'
      AND cuenta_pedida IS NULL;

    SELECT ROW_COUNT() AS afectados;
END$$


-- =====================================================
-- 7. PEDIDOS PENDIENTES PARA COCINA
-- =====================================================

DROP PROCEDURE IF EXISTS sp_cocina_pedidos$$

CREATE PROCEDURE sp_cocina_pedidos()
BEGIN
    SELECT
        p.id_pedido,
        p.id_comanda,
        p.estado,
        p.creado,
        TIMESTAMPDIFF(MINUTE, p.creado, NOW()) AS minutos_espera,
        u.nombre AS mozo,
        pi.id_item,
        i.nombre AS articulo,
        pi.cantidad,
        pi.observaciones
    FROM rest_pedido p
    INNER JOIN usuario u
        ON u.id_usuario = p.id_usuario
    INNER JOIN rest_pedido_item pi
        ON pi.id_pedido = p.id_pedido
    INNER JOIN rest_item_menu i
        ON i.id_item = pi.id_item
    WHERE p.estado = 'PENDIENTE'
      AND pi.anulado = 0
    ORDER BY p.creado, p.id_pedido;
END$$


-- =====================================================
-- 8. MARCAR PEDIDO COMO LISTO
-- =====================================================

DROP PROCEDURE IF EXISTS sp_pedido_marcar_listo$$

CREATE PROCEDURE sp_pedido_marcar_listo(
    IN p_id INT UNSIGNED
)
BEGIN
    UPDATE rest_pedido
    SET
        estado = 'LISTO',
        listo = NOW()
    WHERE id_pedido = p_id
      AND estado = 'PENDIENTE';

    SELECT ROW_COUNT() AS afectados;
END$$


-- =====================================================
-- 9. EDITAR PRODUCTO DEL MENU
-- =====================================================

DROP PROCEDURE IF EXISTS sp_menu_editar$$

CREATE PROCEDURE sp_menu_editar(
    IN p_id INT UNSIGNED,
    IN p_codigo VARCHAR(20),
    IN p_categoria INT UNSIGNED,
    IN p_nombre VARCHAR(100),
    IN p_descripcion VARCHAR(255),
    IN p_precio DECIMAL(10,2)
)
BEGIN
    UPDATE rest_item_menu
    SET
        codigo = p_codigo,
        id_categoria = p_categoria,
        nombre = p_nombre,
        descripcion = p_descripcion,
        precio = p_precio
    WHERE id_item = p_id
      AND activo = 1;

    SELECT ROW_COUNT() AS afectados;
END$$


-- =====================================================
-- 10. BAJA LOGICA DEL MENU
-- =====================================================

DROP PROCEDURE IF EXISTS sp_menu_baja$$

CREATE PROCEDURE sp_menu_baja(
    IN p_id INT UNSIGNED
)
BEGIN
    UPDATE rest_item_menu
    SET activo = 0
    WHERE id_item = p_id
      AND activo = 1;

    SELECT ROW_COUNT() AS afectados;
END$$


-- =====================================================
-- 11. CAMBIAR DISPONIBILIDAD
-- =====================================================

DROP PROCEDURE IF EXISTS sp_menu_disponibilidad$$

CREATE PROCEDURE sp_menu_disponibilidad(
    IN p_id INT UNSIGNED,
    IN p_disponible BOOLEAN
)
BEGIN
    UPDATE rest_item_menu
    SET agotado = NOT p_disponible
    WHERE id_item = p_id
      AND activo = 1;

    SELECT ROW_COUNT() AS afectados;
END$$


-- =====================================================
-- 12. LISTAR PRODUCTOS DADOS DE BAJA
-- =====================================================

DROP PROCEDURE IF EXISTS sp_menu_listar_bajas$$

CREATE PROCEDURE sp_menu_listar_bajas()
BEGIN
    SELECT *
    FROM rest_item_menu
    WHERE activo = 0
    ORDER BY nombre;
END$$


-- =====================================================
-- 13. REACTIVAR PRODUCTO
-- =====================================================

DROP PROCEDURE IF EXISTS sp_menu_reactivar$$

CREATE PROCEDURE sp_menu_reactivar(
    IN p_id INT UNSIGNED
)
BEGIN
    UPDATE rest_item_menu
    SET
        activo = 1,
        agotado = 0
    WHERE id_item = p_id
      AND activo = 0;

    SELECT ROW_COUNT() AS afectados;
END$$


-- =====================================================
-- 14. CONSULTAR PEDIDOS DE UNA MESA
-- =====================================================

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