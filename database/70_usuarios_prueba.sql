-- ============================================================
-- 70_usuarios_prueba.sql – Usuarios DE PRUEBA del restaurante
-- ------------------------------------------------------------
-- ⚠ NO CORRER EN LA INSTALACIÓN DE LA HOSTERÍA.
-- Las contraseñas de estos usuarios están publicadas en GitHub,
-- así que cualquiera podría entrar. En la hostería se crean
-- usuarios reales con contraseñas nuevas.
--
-- Usuarios (usuario / contraseña):
--   encargado / encargado123   → rol ENCARGADO
--   mozo1     / mozo12345      → rol MOZO
--   cocina    / cocina123      → rol COCINA
--
-- Las contraseñas NO se guardan tal cual: se guarda su hash
-- bcrypt (el texto que empieza con $2a$12$). El backend compara
-- la contraseña escrita en el login contra ese hash. Un mismo
-- hash sirve en cualquier base, por eso se puede copiar.
--
-- "usuario" es una tabla COMPARTIDA con los otros grupos:
--   - INSERT IGNORE: solo agrega; si el nombre de usuario ya
--     existe, no lo pisa ni da error.
--   - El rol se asigna SOLO si el usuario tiene nuestro hash.
--     Así, si otro grupo ya tenía un "encargado" con otra clave,
--     NO le damos permisos en el restaurante por error.
--
-- ORDEN: después de 00_schema y 10_procedures. Se puede correr
-- más de una vez sin duplicar nada.
-- ============================================================
USE hosteria;

-- 1. Usuarios (activo = 1)
INSERT IGNORE INTO usuario (usuario, nombre, clave, activo) VALUES
('encargado', 'Encargado', '$2a$12$wte9VMkw82czgFi7NGra0uZFbTnMg4AoOXTNFzBDzySRV.bqTne5q', 1),
('mozo1',     'Mozo 1',    '$2a$12$KmXbZxoNNvGAOqLxcOzrQOxTZa6PIQi7kXqmNBoUhZR/ptHtdI5cu', 1),
('cocina',    'Cocina',    '$2a$12$igpsxLMKcQUUu5SvI9m3EewbUA1oFhZsPJ9umLJkZdyqdAAuDw6vy', 1);

-- 2. Roles en el sistema de la hostería.
-- Se busca el id_usuario por nombre de usuario (puede ser distinto
-- en cada base) y se exige que la clave sea la nuestra.
INSERT IGNORE INTO usuario_rol (id_usuario, sistema, rol)
SELECT id_usuario, 'HOSTERIA', 'ENCARGADO' FROM usuario
WHERE usuario = 'encargado'
  AND clave = '$2a$12$wte9VMkw82czgFi7NGra0uZFbTnMg4AoOXTNFzBDzySRV.bqTne5q';

INSERT IGNORE INTO usuario_rol (id_usuario, sistema, rol)
SELECT id_usuario, 'HOSTERIA', 'MOZO' FROM usuario
WHERE usuario = 'mozo1'
  AND clave = '$2a$12$KmXbZxoNNvGAOqLxcOzrQOxTZa6PIQi7kXqmNBoUhZR/ptHtdI5cu';

INSERT IGNORE INTO usuario_rol (id_usuario, sistema, rol)
SELECT id_usuario, 'HOSTERIA', 'COCINA' FROM usuario
WHERE usuario = 'cocina'
  AND clave = '$2a$12$igpsxLMKcQUUu5SvI9m3EewbUA1oFhZsPJ9umLJkZdyqdAAuDw6vy';