USE hosteria;
DELIMITER $$

DROP PROCEDURE IF EXISTS sp_usuario_contar$$
CREATE PROCEDURE sp_usuario_contar() BEGIN SELECT COUNT(*) AS total FROM usuario; END$$
DROP PROCEDURE IF EXISTS sp_usuario_crear$$
CREATE PROCEDURE sp_usuario_crear(IN p_nombre VARCHAR(100), IN p_usuario VARCHAR(50), IN p_clave VARCHAR(255), IN p_rol VARCHAR(30))
BEGIN
 DECLARE v_id INT UNSIGNED;
 INSERT INTO usuario(nombre, usuario, clave) VALUES(p_nombre, p_usuario, p_clave);
 SET v_id = LAST_INSERT_ID();
 INSERT INTO usuario_rol(id_usuario, sistema, rol) VALUES(v_id, 'HOSTERIA', p_rol);
 SELECT v_id AS id_usuario, p_nombre AS nombre, p_usuario AS usuario, p_rol AS rol;
END$$
DROP PROCEDURE IF EXISTS sp_usuario_por_login$$
CREATE PROCEDURE sp_usuario_por_login(IN p_usuario VARCHAR(50))
BEGIN SELECT u.id_usuario,u.nombre,u.usuario,u.clave,u.activo,r.rol FROM usuario u LEFT JOIN usuario_rol r ON r.id_usuario=u.id_usuario AND r.sistema='HOSTERIA' WHERE u.usuario=p_usuario LIMIT 1; END$$
DROP PROCEDURE IF EXISTS sp_usuario_por_id$$
CREATE PROCEDURE sp_usuario_por_id(IN p_id INT UNSIGNED)
BEGIN SELECT id_usuario,nombre,usuario,activo,creado FROM usuario WHERE id_usuario=p_id; END$$

DROP PROCEDURE IF EXISTS sp_categoria_listar$$
CREATE PROCEDURE sp_categoria_listar() BEGIN SELECT id_categoria,letra,nombre,activa FROM rest_categoria ORDER BY nombre; END$$
DROP PROCEDURE IF EXISTS sp_categoria_crear$$
CREATE PROCEDURE sp_categoria_crear(IN p_letra VARCHAR(5),IN p_nombre VARCHAR(50)) BEGIN INSERT INTO rest_categoria(letra,nombre) VALUES(p_letra,p_nombre); SELECT LAST_INSERT_ID() AS id_categoria; END$$
DROP PROCEDURE IF EXISTS sp_menu_listar$$
CREATE PROCEDURE sp_menu_listar(IN p_solo_activos BOOLEAN) BEGIN SELECT i.id_item,i.codigo,i.id_categoria,c.nombre AS categoria,i.nombre,i.descripcion,i.precio,i.agotado,i.activo,i.actualizado FROM rest_item_menu i JOIN rest_categoria c ON c.id_categoria=i.id_categoria WHERE p_solo_activos=0 OR i.activo=1 ORDER BY c.nombre,i.nombre; END$$
DROP PROCEDURE IF EXISTS sp_menu_crear$$
CREATE PROCEDURE sp_menu_crear(IN p_codigo VARCHAR(20),IN p_categoria INT UNSIGNED,IN p_nombre VARCHAR(100),IN p_descripcion VARCHAR(255),IN p_precio DECIMAL(10,2)) BEGIN INSERT INTO rest_item_menu(codigo,id_categoria,nombre,descripcion,precio) VALUES(p_codigo,p_categoria,p_nombre,p_descripcion,p_precio); SELECT LAST_INSERT_ID() AS id_item; END$$
DROP PROCEDURE IF EXISTS sp_mesa_listar$$
CREATE PROCEDURE sp_mesa_listar() BEGIN SELECT m.id_mesa,m.numero,m.capacidad,m.codigo_qr,m.activa,EXISTS(SELECT 1 FROM rest_comanda c WHERE c.id_mesa=m.id_mesa AND c.estado='ABIERTA') AS ocupada FROM rest_mesa m ORDER BY m.numero; END$$
DROP PROCEDURE IF EXISTS sp_mesa_crear$$
CREATE PROCEDURE sp_mesa_crear(IN p_numero INT UNSIGNED,IN p_capacidad TINYINT UNSIGNED,IN p_qr VARCHAR(255)) BEGIN INSERT INTO rest_mesa(numero,capacidad,codigo_qr) VALUES(p_numero,p_capacidad,p_qr); SELECT LAST_INSERT_ID() AS id_mesa; END$$

DROP PROCEDURE IF EXISTS sp_comanda_abrir$$
CREATE PROCEDURE sp_comanda_abrir(IN p_numero INT UNSIGNED,IN p_mesa INT UNSIGNED,IN p_mozo INT UNSIGNED,IN p_personas TINYINT UNSIGNED)
BEGIN
 IF EXISTS(SELECT 1 FROM rest_comanda WHERE id_mesa=p_mesa AND estado='ABIERTA') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='La mesa ya tiene una comanda abierta'; END IF;
 INSERT INTO rest_comanda(numero,id_mesa,id_mozo,personas) VALUES(p_numero,p_mesa,p_mozo,p_personas);
 SELECT LAST_INSERT_ID() AS id_comanda;
END$$
DROP PROCEDURE IF EXISTS sp_comandas_abiertas$$
CREATE PROCEDURE sp_comandas_abiertas() BEGIN SELECT c.*,m.numero AS mesa, u.nombre AS mozo FROM rest_comanda c JOIN rest_mesa m ON m.id_mesa=c.id_mesa JOIN usuario u ON u.id_usuario=c.id_mozo WHERE c.estado='ABIERTA' ORDER BY c.apertura; END$$
DROP PROCEDURE IF EXISTS sp_pedido_crear$$
CREATE PROCEDURE sp_pedido_crear(IN p_comanda INT UNSIGNED,IN p_uid VARCHAR(50),IN p_origen VARCHAR(20),IN p_usuario INT UNSIGNED,IN p_items JSON)
BEGIN
 DECLARE v_pedido INT UNSIGNED;
 DECLARE v_i INT DEFAULT 0;
 DECLARE v_n INT DEFAULT 0;
 DECLARE v_item INT UNSIGNED;
 DECLARE v_cantidad INT UNSIGNED;
 DECLARE v_obs VARCHAR(255);
 DECLARE v_precio DECIMAL(10,2);
 DECLARE v_activo BOOLEAN;
 DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
 START TRANSACTION;
 IF NOT EXISTS(SELECT 1 FROM rest_comanda WHERE id_comanda=p_comanda AND estado='ABIERTA') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='La comanda no existe o no esta abierta'; END IF;
 SET v_n=JSON_LENGTH(p_items);
 IF v_n IS NULL OR v_n=0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='El pedido debe contener al menos un articulo'; END IF;
 INSERT INTO rest_pedido(id_comanda,uid,origen,id_usuario) VALUES(p_comanda,p_uid,p_origen,p_usuario);
 SET v_pedido=LAST_INSERT_ID();
 WHILE v_i < v_n DO
   SET v_item=CAST(JSON_UNQUOTE(JSON_EXTRACT(p_items,CONCAT('$[',v_i,'].id_item'))) AS UNSIGNED);
   SET v_cantidad=CAST(JSON_UNQUOTE(JSON_EXTRACT(p_items,CONCAT('$[',v_i,'].cantidad'))) AS UNSIGNED);
   SET v_obs=JSON_UNQUOTE(JSON_EXTRACT(p_items,CONCAT('$[',v_i,'].observaciones')));
   SELECT precio,activo INTO v_precio,v_activo FROM rest_item_menu WHERE id_item=v_item AND agotado=0;
   IF v_activo IS NULL OR v_activo=0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Articulo inexistente, inactivo o agotado'; END IF;
   IF v_cantidad IS NULL OR v_cantidad=0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='La cantidad debe ser mayor que cero'; END IF;
   INSERT INTO rest_pedido_item(id_pedido,id_item,cantidad,precio_unitario,importe,observaciones) VALUES(v_pedido,v_item,v_cantidad,v_precio,v_precio*v_cantidad,v_obs);
   SET v_i=v_i+1;
 END WHILE;
 UPDATE rest_comanda SET total=(SELECT COALESCE(SUM(pi.importe),0) FROM rest_pedido p JOIN rest_pedido_item pi ON pi.id_pedido=p.id_pedido WHERE p.id_comanda=p_comanda AND pi.anulado=0) WHERE id_comanda=p_comanda;
 COMMIT;
 SELECT v_pedido AS id_pedido;
END$$
DROP PROCEDURE IF EXISTS sp_pedido_estado$$
CREATE PROCEDURE sp_pedido_estado(IN p_id INT UNSIGNED,IN p_estado VARCHAR(20))
BEGIN
 IF p_estado NOT IN ('ENVIADO','LISTO','CANCELADO') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Estado de pedido no permitido'; END IF;
 UPDATE rest_pedido SET estado=p_estado, enviado=IF(p_estado='ENVIADO',COALESCE(enviado,NOW()),enviado), listo=IF(p_estado='LISTO',NOW(),listo) WHERE id_pedido=p_id;
 SELECT ROW_COUNT() AS afectados;
END$$
DROP PROCEDURE IF EXISTS sp_pedido_detalle$$
CREATE PROCEDURE sp_pedido_detalle(IN p_id INT UNSIGNED)
BEGIN SELECT p.id_pedido,p.id_comanda,p.uid,p.origen,p.estado,p.creado,p.enviado,p.listo,pi.id_pedido_item,pi.id_item,i.nombre AS articulo,pi.cantidad,pi.precio_unitario,pi.importe,pi.observaciones,pi.anulado FROM rest_pedido p JOIN rest_pedido_item pi ON pi.id_pedido=p.id_pedido JOIN rest_item_menu i ON i.id_item=pi.id_item WHERE p.id_pedido=p_id; END$$

DROP PROCEDURE IF EXISTS sp_caja_abrir$$
CREATE PROCEDURE sp_caja_abrir(IN p_usuario INT UNSIGNED,IN p_saldo DECIMAL(10,2))
BEGIN
 IF EXISTS(SELECT 1 FROM rest_turno_caja WHERE estado='ABIERTO') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Ya existe un turno de caja abierto'; END IF;
 INSERT INTO rest_turno_caja(fecha,id_usuario_apertura,saldo_inicial) VALUES(CURDATE(),p_usuario,p_saldo);
 SELECT LAST_INSERT_ID() AS id_turno_caja;
END$$
DROP PROCEDURE IF EXISTS sp_caja_cerrar$$
CREATE PROCEDURE sp_caja_cerrar(IN p_turno INT UNSIGNED,IN p_usuario INT UNSIGNED,IN p_efectivo DECIMAL(10,2),IN p_obs TEXT)
BEGIN
 DECLARE v_estado VARCHAR(20); DECLARE v_esperado DECIMAL(10,2);
 SELECT estado INTO v_estado FROM rest_turno_caja WHERE id_turno_caja=p_turno FOR UPDATE;
 IF v_estado IS NULL OR v_estado<>'ABIERTO' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='El turno no existe o ya esta cerrado'; END IF;
 SELECT saldo_inicial+COALESCE(SUM(ingreso-egreso),0) INTO v_esperado FROM rest_turno_caja t LEFT JOIN rest_movimiento_caja m ON m.id_turno_caja=t.id_turno_caja WHERE t.id_turno_caja=p_turno GROUP BY t.id_turno_caja;
 UPDATE rest_turno_caja SET id_usuario_cierre=p_usuario,cierre=NOW(),efectivo_contado=p_efectivo,diferencia=p_efectivo-COALESCE(v_esperado,saldo_inicial),observaciones=p_obs,estado='CERRADO' WHERE id_turno_caja=p_turno;
 SELECT id_turno_caja,estado,diferencia FROM rest_turno_caja WHERE id_turno_caja=p_turno;
END$$
DROP PROCEDURE IF EXISTS sp_cobro_registrar$$
CREATE PROCEDURE sp_cobro_registrar(IN p_comanda INT UNSIGNED,IN p_turno INT UNSIGNED,IN p_usuario INT UNSIGNED,IN p_total DECIMAL(10,2),IN p_forma VARCHAR(30),IN p_importe DECIMAL(10,2),IN p_sin_cargo BOOLEAN,IN p_autoriza INT UNSIGNED,IN p_motivo VARCHAR(255))
BEGIN
 DECLARE v_cobro INT UNSIGNED; DECLARE v_numero INT UNSIGNED; DECLARE v_estado_turno VARCHAR(20);
 DECLARE v_total_comanda DECIMAL(10,2); DECLARE v_saldo_actual DECIMAL(10,2);
 DECLARE v_codigo INT UNSIGNED;
 DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
 START TRANSACTION;
 SELECT estado INTO v_estado_turno FROM rest_turno_caja WHERE id_turno_caja=p_turno FOR UPDATE;
 IF v_estado_turno IS NULL OR v_estado_turno<>'ABIERTO' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='No hay turno de caja abierto'; END IF;
 SELECT numero,total INTO v_numero,v_total_comanda FROM rest_comanda WHERE id_comanda=p_comanda AND estado='ABIERTA' FOR UPDATE;
 IF v_numero IS NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='La comanda no existe o ya fue cerrada'; END IF;
 IF p_total<>v_total_comanda THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='El total enviado no coincide con el total calculado de la comanda'; END IF;
 IF p_sin_cargo=0 AND p_importe<>p_total THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='El importe del pago debe coincidir con el total'; END IF;
 IF p_sin_cargo=1 AND (p_autoriza IS NULL OR p_motivo IS NULL OR p_motivo='') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Un cobro sin cargo requiere autorizacion y motivo'; END IF;
 INSERT INTO rest_cobro(id_comanda,id_turno_caja,id_usuario,total,sin_cargo,id_autoriza,motivo_sin_cargo) VALUES(p_comanda,p_turno,p_usuario,p_total,p_sin_cargo,p_autoriza,p_motivo);
 SET v_cobro=LAST_INSERT_ID();
 IF p_sin_cargo=0 THEN
  SELECT id_codigo INTO v_codigo FROM rest_codigo_caja WHERE codigo='COBRO' AND activo=1 LIMIT 1;
  IF v_codigo IS NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Falta configurar el codigo de caja COBRO'; END IF;
  INSERT INTO rest_cobro_pago(id_cobro,forma,importe) VALUES(v_cobro,p_forma,p_importe);
  SELECT saldo_inicial+COALESCE((SELECT SUM(ingreso-egreso) FROM rest_movimiento_caja WHERE id_turno_caja=p_turno),0)
    INTO v_saldo_actual FROM rest_turno_caja WHERE id_turno_caja=p_turno;
  INSERT INTO rest_movimiento_caja(id_turno_caja,id_codigo,id_cobro,id_usuario,concepto,ingreso,saldo)
    VALUES(p_turno,v_codigo,v_cobro,p_usuario,CONCAT('Cobro comanda ',v_numero),p_total,v_saldo_actual+p_total);
 END IF;
 UPDATE rest_comanda SET estado='CERRADA',cierre=NOW() WHERE id_comanda=p_comanda;
 COMMIT;
 SELECT v_cobro AS id_cobro;
END$$

DROP PROCEDURE IF EXISTS sp_huesped_listar$$
CREATE PROCEDURE sp_huesped_listar() BEGIN SELECT id_huesped,nombre,apellido,dni FROM huesped ORDER BY apellido,nombre; END$$
DROP PROCEDURE IF EXISTS sp_huesped_crear$$
CREATE PROCEDURE sp_huesped_crear(IN p_nombre VARCHAR(100),IN p_apellido VARCHAR(100),IN p_dni VARCHAR(20)) BEGIN INSERT INTO huesped(nombre,apellido,dni) VALUES(p_nombre,p_apellido,p_dni); SELECT LAST_INSERT_ID() AS id_huesped; END$$
DROP PROCEDURE IF EXISTS sp_estadia_crear$$
CREATE PROCEDURE sp_estadia_crear(IN p_huesped INT UNSIGNED,IN p_habitacion VARCHAR(10),IN p_ingreso DATETIME,IN p_egreso DATETIME)
BEGIN
 IF EXISTS(SELECT 1 FROM estadia WHERE nro_habitacion=p_habitacion AND estado='ACTIVA' AND (egreso IS NULL OR egreso>p_ingreso)) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='La habitacion ya tiene una estadia activa'; END IF;
 INSERT INTO estadia(id_huesped,nro_habitacion,ingreso,egreso) VALUES(p_huesped,p_habitacion,p_ingreso,p_egreso); SELECT LAST_INSERT_ID() AS id_estadia;
END$$
DROP PROCEDURE IF EXISTS sp_estadias_listar$$
CREATE PROCEDURE sp_estadias_listar() BEGIN SELECT e.*,h.nombre,h.apellido,h.dni FROM estadia e JOIN huesped h ON h.id_huesped=e.id_huesped ORDER BY e.ingreso DESC; END$$
DROP PROCEDURE IF EXISTS sp_auditoria_registrar$$
CREATE PROCEDURE sp_auditoria_registrar(IN p_usuario INT UNSIGNED,IN p_accion VARCHAR(50),IN p_tabla VARCHAR(64),IN p_id BIGINT UNSIGNED,IN p_motivo VARCHAR(255),IN p_detalle TEXT)
BEGIN INSERT INTO rest_auditoria(id_usuario,accion,tabla,id_registro,motivo,detalle) VALUES(p_usuario,p_accion,p_tabla,p_id,p_motivo,p_detalle); END$$
DROP PROCEDURE IF EXISTS sp_configuracion_listar$$
CREATE PROCEDURE sp_configuracion_listar() BEGIN SELECT clave,valor FROM rest_configuracion ORDER BY clave; END$$

DELIMITER ;
