USE hosteria;

DELIMITER $$

DROP PROCEDURE IF EXISTS sp_comanda_pedido_inicial$$

CREATE PROCEDURE sp_comanda_pedido_inicial(
    IN p_mesa INT UNSIGNED,
    IN p_mozo INT UNSIGNED,
    IN p_personas TINYINT UNSIGNED,
    IN p_uid VARCHAR(50),
    IN p_origen VARCHAR(20),
    IN p_usuario INT UNSIGNED,
    IN p_items JSON
)
BEGIN
    DECLARE v_comanda INT UNSIGNED;
    DECLARE v_pedido INT UNSIGNED;
    DECLARE v_i INT DEFAULT 0;
    DECLARE v_n INT DEFAULT 0;
    DECLARE v_item INT UNSIGNED;
    DECLARE v_cantidad INT UNSIGNED;
    DECLARE v_obs VARCHAR(100);
    DECLARE v_precio DECIMAL(10,2);
    DECLARE v_activo BOOLEAN;
    DECLARE v_existe INT DEFAULT 0;

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
        SET MESSAGE_TEXT = 'Personas debe ser entre 1 y 20';
    END IF;

    IF p_uid IS NULL OR TRIM(p_uid) = '' THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'UID obligatorio';
    END IF;

    IF p_origen IS NULL OR p_origen NOT IN ('SALON', 'MOSTRADOR') THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Origen invalido';
    END IF;

    SET v_n = JSON_LENGTH(p_items);

    IF v_n IS NULL OR v_n = 0 THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'El pedido debe contener articulos';
    END IF;

    START TRANSACTION;

    SELECT COUNT(*)
    INTO v_existe
    FROM rest_comanda
    WHERE id_mesa = p_mesa
      AND estado = 'ABIERTA'
    FOR UPDATE;

    IF v_existe > 0 THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'La mesa ya tiene una comanda abierta';
    END IF;

    INSERT INTO rest_comanda (
        numero, id_mesa, id_mozo, personas
    )
    VALUES (
        NULL, p_mesa, p_mozo, p_personas
    );

    SET v_comanda = LAST_INSERT_ID();

    UPDATE rest_comanda
    SET numero = v_comanda
    WHERE id_comanda = v_comanda;

    INSERT INTO rest_pedido (
        id_comanda, uid, origen, id_usuario
    )
    VALUES (
        v_comanda, p_uid, p_origen, p_usuario
    );

    SET v_pedido = LAST_INSERT_ID();

    WHILE v_i < v_n DO

        SET v_precio = NULL;
        SET v_activo = NULL;
        SET v_item = NULL;
        SET v_cantidad = NULL;
        SET v_obs = NULL;

        SET v_item = CAST(JSON_UNQUOTE(JSON_EXTRACT(
            p_items, CONCAT('$[', v_i, '].id_item')
        )) AS UNSIGNED);

        SET v_cantidad = CAST(JSON_UNQUOTE(JSON_EXTRACT(
            p_items, CONCAT('$[', v_i, '].cantidad')
        )) AS UNSIGNED);

        SET v_obs = JSON_UNQUOTE(JSON_EXTRACT(
            p_items, CONCAT('$[', v_i, '].observaciones')
        ));

        IF v_item IS NULL OR v_item = 0 THEN
            SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Articulo invalido';
        END IF;

        IF v_cantidad IS NULL OR v_cantidad < 1 OR v_cantidad > 50 THEN
            SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Cantidad debe ser entre 1 y 50';
        END IF;

        IF v_obs IS NOT NULL AND CHAR_LENGTH(v_obs) > 100 THEN
            SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Observacion demasiado larga';
        END IF;

        SELECT precio, activo
        INTO v_precio, v_activo
        FROM rest_item_menu
        WHERE id_item = v_item
          AND activo = 1
          AND agotado = 0
        LIMIT 1;

        IF v_activo IS NULL OR v_activo = 0 THEN
            SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Articulo inactivo o agotado';
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
        WHERE p.id_comanda = v_comanda
          AND pi.anulado = 0
    )
    WHERE id_comanda = v_comanda;

    COMMIT;

    SELECT
        v_comanda AS id_comanda,
        v_pedido AS id_pedido;

END$$

DELIMITER ;