-- ============================================================
-- HOSTERÍA MUNICIPAL – Sistema del restaurante
-- Archivo: 65_huespedes_prueba.sql   (DATOS DE PRUEBA)
-- ============================================================
-- Tres huéspedes ficticios alojados AHORA, para probar y mostrar
-- el cargo a habitación mientras no esté conectado el sistema de
-- reservas.
--
-- ⚠ NUNCA correr en la instalación de la hostería (igual que 60 y 70):
--   ahí los huéspedes los carga el sistema de reservas.
--
-- Se puede correr varias veces: no repite huéspedes (DNI único) ni
-- les abre una segunda estadía si ya tienen una activa.
-- Correr DESPUÉS de 98_cargo_comprobante.sql:
--   cmd /c "C:\xampp\mysql\bin\mysql -u root --default-character-set=utf8mb4 hosteria < database\65_huespedes_prueba.sql"
-- ============================================================

USE hosteria;

INSERT IGNORE INTO huesped (nombre, apellido, dni) VALUES
  ('Juan',   'Pérez', '90000001'),
  ('María',  'Gómez', '90000002'),
  ('Carlos', 'Díaz',  '90000003');

INSERT INTO estadia (id_huesped, nro_habitacion, ingreso, estado)
SELECT h.id_huesped, x.habitacion, NOW() - INTERVAL 1 DAY, 'ACTIVA'
FROM (
  SELECT '90000001' AS dni, '3' AS habitacion
  UNION ALL SELECT '90000002', '5'
  UNION ALL SELECT '90000003', '8'
) x
JOIN huesped h ON h.dni = x.dni
WHERE NOT EXISTS (
  SELECT 1 FROM estadia e
  WHERE e.id_huesped = h.id_huesped AND e.estado = 'ACTIVA'
);

-- Para ver cómo quedó:
SELECT * FROM v_rest_estadias_activas ORDER BY nro_habitacion + 0;