-- ============================================================
-- 20_seed.sql – Datos BASE del sistema del restaurante
-- ------------------------------------------------------------
-- Son datos reales que el sistema necesita para arrancar en la
-- hostería (no son de prueba). Los platos del menú NO van acá:
-- los carga el encargado desde la pantalla de Menú.
-- Para probar con platos de ejemplo: 60_datos_prueba.sql
--
-- Se usa INSERT IGNORE: si el dato ya existe (misma clave única)
-- no da error ni lo duplica, así el script se puede correr más
-- de una vez sin problemas.
-- ============================================================
USE hosteria;

-- Códigos de caja del restaurante
-- (a confirmar con la hostería: en su Excel usan I01, I02... E01, E02...)
INSERT IGNORE INTO rest_codigo_caja(codigo,concepto,tipo,activo) VALUES
('COBRO','Cobro de comanda','INGRESO',1),
('AJUSTE_ING','Ajuste de caja / ingreso','INGRESO',1),
('GASTO','Gasto operativo','EGRESO',1),
('PROVEEDOR','Pago a proveedor','EGRESO',1);

-- Categorías del menú, con la misma letra que usa la hostería en
-- sus códigos (A01 = comida, B01 = bebida, D01 = desayuno/cafetería).
-- El código de cada plato empieza con la letra de su categoría.
INSERT IGNORE INTO rest_categoria(letra,nombre,activa) VALUES
('A','Comidas',1),
('B','Bebidas',1),
('D','Desayunos y cafetería',1);

-- La versión anterior de este seed cargaba la categoría C "Postres",
-- que la hostería no usa. En las bases que ya la tienen, se borra,
-- PERO solo si no tiene ningún plato (ni activo ni dado de baja),
-- para no perder datos si alguien llegó a cargar alguno.
DELETE FROM rest_categoria
WHERE letra = 'C'
  AND NOT EXISTS (
        SELECT 1 FROM rest_item_menu i
        WHERE i.id_categoria = rest_categoria.id_categoria
      );

-- Mesas del salón: 12, igual que las hojas del Excel de la hostería.
-- capacidad 4 (propuesta, a confirmar con la hostería).
-- codigo_qr queda NULL: se completa en el Incremento 2 (pedido por QR).
INSERT IGNORE INTO rest_mesa(numero,capacidad) VALUES
(1,4),(2,4),(3,4),(4,4),(5,4),(6,4),
(7,4),(8,4),(9,4),(10,4),(11,4),(12,4);

-- Configuración general
INSERT IGNORE INTO rest_configuracion(clave,valor) VALUES
('nombre_sistema','Sistema de Gestión Hostería Municipal'),
('moneda','ARS');