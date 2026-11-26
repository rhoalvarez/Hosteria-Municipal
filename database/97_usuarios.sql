-- ============================================================
-- HOSTERÍA MUNICIPAL - RESTAURANTE
-- Archivo: 97_usuarios.sql  (ABM de usuarios, RF-USU-03)
-- ============================================================
-- Qué hace:
--   Procedimientos para listar, ver, editar, cambiar la
--   contraseña y activar/desactivar usuarios DEL RESTAURANTE.
--   El alta ya existe (sp_usuario_crear, de Rosario).
--
-- Reglas importantes:
--   * La tabla "usuario" la COMPARTEN los tres sistemas
--     (restaurante, reservas, stock). Por eso acá SOLO se ven
--     y se tocan usuarios que tienen rol en sistema = 'HOSTERIA'.
--   * Nunca se borra un usuario: las comandas, pedidos y cobros
--     apuntan a usuario.id_usuario. Se DESACTIVA (activo = 0) y
--     el login ya rechaza a los inactivos.
--   * Las reglas de negocio (último encargado, no desactivarse a
--     uno mismo, usuarios de otros sistemas) están en el
--     controller (usuarios.controller.js), no acá.
--
-- No borra nada. Se puede correr varias veces.
-- Compatible con MariaDB 10.4 (sin JSON_ARRAYAGG ni nada nuevo).
-- ============================================================

USE hosteria;

DELIMITER $$

-- ------------------------------------------------------------
-- Listar usuarios del restaurante
-- otros_sistemas: cuántos roles tiene en OTROS sistemas.
-- Si es mayor que 0, el usuario también se usa en reservas o
-- stock y no lo dejamos desactivar desde acá.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_usuario_listar$$
CREATE PROCEDURE sp_usuario_listar()
BEGIN
    SELECT
        u.id_usuario,
        u.nombre,
        u.usuario,
        ur.rol,
        u.activo,
        u.creado,
        (SELECT COUNT(*)
           FROM usuario_rol o
          WHERE o.id_usuario = u.id_usuario
            AND o.sistema <> 'HOSTERIA') AS otros_sistemas
    FROM usuario u
    JOIN usuario_rol ur
      ON ur.id_usuario = u.id_usuario
     AND ur.sistema = 'HOSTERIA'
    ORDER BY u.activo DESC, u.nombre;
END$$

-- ------------------------------------------------------------
-- Ver UN usuario del restaurante (para validar antes de editar)
-- Si no tiene rol en HOSTERIA, no devuelve filas (= 404).
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_usuario_obtener$$
CREATE PROCEDURE sp_usuario_obtener(IN p_id INT UNSIGNED)
BEGIN
    SELECT
        u.id_usuario,
        u.nombre,
        u.usuario,
        ur.rol,
        u.activo,
        (SELECT COUNT(*)
           FROM usuario_rol o
          WHERE o.id_usuario = u.id_usuario
            AND o.sistema <> 'HOSTERIA') AS otros_sistemas
    FROM usuario u
    JOIN usuario_rol ur
      ON ur.id_usuario = u.id_usuario
     AND ur.sistema = 'HOSTERIA'
    WHERE u.id_usuario = p_id;
END$$

-- ------------------------------------------------------------
-- Cuántos encargados ACTIVOS tiene el restaurante.
-- Sirve para no dejar el sistema sin nadie que lo administre.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_usuario_encargados_activos$$
CREATE PROCEDURE sp_usuario_encargados_activos()
BEGIN
    SELECT COUNT(*) AS total
    FROM usuario u
    JOIN usuario_rol ur
      ON ur.id_usuario = u.id_usuario
     AND ur.sistema = 'HOSTERIA'
    WHERE ur.rol = 'ENCARGADO'
      AND u.activo = 1;
END$$

-- ------------------------------------------------------------
-- Editar nombre y rol.
-- El rol se cambia SOLO en sistema = 'HOSTERIA': si el usuario
-- tiene rol en otro sistema, ese no se toca.
-- El nombre de usuario (el del login) no se cambia (propuesta).
-- Las dos actualizaciones van juntas en una transacción:
-- o se hacen las dos o ninguna.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_usuario_editar$$
CREATE PROCEDURE sp_usuario_editar(
    IN p_id     INT UNSIGNED,
    IN p_nombre VARCHAR(100),
    IN p_rol    VARCHAR(30)
)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    UPDATE usuario
       SET nombre = p_nombre
     WHERE id_usuario = p_id;

    UPDATE usuario_rol
       SET rol = p_rol
     WHERE id_usuario = p_id
       AND sistema = 'HOSTERIA';

    COMMIT;

    SELECT p_id AS id_usuario;
END$$

-- ------------------------------------------------------------
-- Cambiar la contraseña.
-- p_clave llega YA como hash bcrypt (lo hace el controller).
-- OJO: la clave está en la tabla compartida, así que también
-- cambia para reservas/stock si el usuario se usa allá.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_usuario_cambiar_clave$$
CREATE PROCEDURE sp_usuario_cambiar_clave(
    IN p_id    INT UNSIGNED,
    IN p_clave VARCHAR(255)
)
BEGIN
    UPDATE usuario
       SET clave = p_clave
     WHERE id_usuario = p_id;

    SELECT p_id AS id_usuario;
END$$

-- ------------------------------------------------------------
-- Activar (1) o desactivar (0) un usuario.
-- Desactivado = no puede iniciar sesión, pero su historial
-- (comandas, cobros) queda intacto.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_usuario_activar$$
CREATE PROCEDURE sp_usuario_activar(
    IN p_id     INT UNSIGNED,
    IN p_activo TINYINT
)
BEGIN
    UPDATE usuario
       SET activo = p_activo
     WHERE id_usuario = p_id;

    SELECT p_id AS id_usuario, p_activo AS activo;
END$$

DELIMITER ;

-- ============================================================
-- FIN 97_usuarios.sql
-- ============================================================