-- ============================================================
-- 60_datos_prueba.sql – Platos DE PRUEBA para el desarrollo
-- ------------------------------------------------------------
-- ⚠ NO CORRER EN LA INSTALACIÓN DE LA HOSTERÍA.
-- Los nombres y precios son inventados. El menú real lo carga
-- el encargado desde la pantalla de Menú.
--
-- Sirve para que cualquiera del equipo que clone el repositorio
-- pueda probar mesas, pedidos y cocina sin cargar platos a mano.
--
-- ORDEN: correr DESPUÉS de 20_seed.sql (necesita las categorías).
--
-- Cada plato busca el id de su categoría por la LETRA, porque el
-- id_categoria puede ser distinto en cada base (depende del orden
-- en que se cargaron los datos).
--
-- INSERT IGNORE: si el código ya existe no lo duplica, así el
-- script se puede correr más de una vez.
-- ============================================================
USE hosteria;

INSERT IGNORE INTO rest_item_menu (codigo, id_categoria, nombre, precio, agotado) VALUES
-- A: Comidas
('A01', (SELECT id_categoria FROM rest_categoria WHERE letra = 'A'), 'Milanesa con papas fritas',     9500, 0),
('A02', (SELECT id_categoria FROM rest_categoria WHERE letra = 'A'), 'Empanadas de carne (docena)', 12000, 0),
-- A03 queda AGOTADO a propósito, para probar que el mozo no lo pueda pedir
('A03', (SELECT id_categoria FROM rest_categoria WHERE letra = 'A'), 'Locro',                          8000, 1),
-- B: Bebidas
('B01', (SELECT id_categoria FROM rest_categoria WHERE letra = 'B'), 'Agua sin gas 500 ml',            1500, 0),
('B02', (SELECT id_categoria FROM rest_categoria WHERE letra = 'B'), 'Gaseosa 500 ml',                 2000, 0),
('B03', (SELECT id_categoria FROM rest_categoria WHERE letra = 'B'), 'Vino tinto (copa)',              3000, 0),
-- D: Desayunos y cafetería
('D01', (SELECT id_categoria FROM rest_categoria WHERE letra = 'D'), 'Café con leche',                 1800, 0),
('D02', (SELECT id_categoria FROM rest_categoria WHERE letra = 'D'), 'Tostado de jamón y queso',       4500, 0);