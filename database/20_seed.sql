USE hosteria;
INSERT IGNORE INTO rest_codigo_caja(codigo,concepto,tipo,activo) VALUES
('COBRO','Cobro de comanda','INGRESO',1),
('AJUSTE_ING','Ajuste de caja / ingreso','INGRESO',1),
('GASTO','Gasto operativo','EGRESO',1),
('PROVEEDOR','Pago a proveedor','EGRESO',1);
INSERT IGNORE INTO rest_categoria(letra,nombre,activa) VALUES
('A','Comidas',1),('B','Bebidas',1),('C','Postres',1);
INSERT IGNORE INTO rest_configuracion(clave,valor) VALUES
('nombre_sistema','Sistema de Gestión Hostería Municipal'),
('moneda','ARS');
