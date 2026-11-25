-- ============================================================
-- HOSTERÍA MUNICIPAL
-- Base de datos: MariaDB / MySQL
-- Archivo: 00_schema.sql
-- ============================================================
-- ADVERTENCIA:
-- Este script recrea las tablas y elimina los datos previos.
-- Ejecutar únicamente cuando corresponda reiniciar la base.
-- ============================================================

CREATE DATABASE IF NOT EXISTS hosteria
CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;

USE hosteria;

SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- ELIMINACIÓN DE TABLAS
-- Se eliminan primero las tablas dependientes.
-- ============================================================

DROP TABLE IF EXISTS rest_pedido_qr_item;
DROP TABLE IF EXISTS rest_pedido_qr;

DROP TABLE IF EXISTS
    rest_cargo_habitacion,
    rest_movimiento_caja,
    rest_cobro_pago,
    rest_cobro,
    rest_codigo_caja,
    rest_turno_caja,
    rest_pedido_item,
    rest_pedido,
    rest_comanda,
    rest_mesa,
    rest_item_menu,
    rest_categoria,
    rest_auditoria,
    rest_configuracion,
    estadia,
    huesped,
    usuario_rol,
    usuario;

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- USUARIOS
-- ============================================================

CREATE TABLE usuario (
    id_usuario INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    usuario VARCHAR(50) NOT NULL UNIQUE,
    clave VARCHAR(255) NOT NULL COMMENT 'Hash bcrypt; nunca texto plano',
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado DATETIME NULL ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE usuario_rol (
    id_usuario INT UNSIGNED NOT NULL,
    sistema VARCHAR(50) NOT NULL,
    rol VARCHAR(30) NOT NULL,

    PRIMARY KEY (id_usuario, sistema),

    CONSTRAINT fk_usuario_rol_usuario
        FOREIGN KEY (id_usuario)
        REFERENCES usuario(id_usuario)
) ENGINE=InnoDB;

-- ============================================================
-- RESTAURANTE: CATEGORÍAS Y MENÚ
-- ============================================================

CREATE TABLE rest_categoria (
    id_categoria INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    letra VARCHAR(5) NOT NULL,
    nombre VARCHAR(50) NOT NULL,
    activa BOOLEAN NOT NULL DEFAULT TRUE,

    UNIQUE KEY uq_categoria_letra (letra),
    UNIQUE KEY uq_categoria_nombre (nombre)
) ENGINE=InnoDB;

CREATE TABLE rest_item_menu (
    id_item INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    codigo VARCHAR(20) NOT NULL UNIQUE,
    id_categoria INT UNSIGNED NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    descripcion VARCHAR(255) NULL,
    precio DECIMAL(10,2) NOT NULL,
    agotado BOOLEAN NOT NULL DEFAULT FALSE,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    actualizado DATETIME NOT NULL
        DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT chk_item_precio
        CHECK (precio >= 0),

    CONSTRAINT fk_item_categoria
        FOREIGN KEY (id_categoria)
        REFERENCES rest_categoria(id_categoria),

    INDEX idx_item_categoria_activo (id_categoria, activo)
) ENGINE=InnoDB;

-- ============================================================
-- RESTAURANTE: MESAS
-- ============================================================

CREATE TABLE rest_mesa (
    id_mesa INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    numero INT UNSIGNED NOT NULL UNIQUE,
    capacidad TINYINT UNSIGNED NOT NULL,
    codigo_qr VARCHAR(255) NULL UNIQUE,
    activa BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT chk_mesa_capacidad
        CHECK (capacidad > 0)
) ENGINE=InnoDB;

-- ============================================================
-- RESTAURANTE: COMANDAS
-- ============================================================

CREATE TABLE rest_comanda (
    id_comanda INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    numero INT UNSIGNED NOT NULL UNIQUE,
    id_mesa INT UNSIGNED NOT NULL,
    id_mozo INT UNSIGNED NOT NULL,
    personas TINYINT UNSIGNED NOT NULL,
    apertura DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    cierre DATETIME NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'ABIERTA',

    mesa_abierta INT UNSIGNED
        AS (IF(estado = 'ABIERTA', id_mesa, NULL))
        PERSISTENT,

    total DECIMAL(10,2) NOT NULL DEFAULT 0.00,

    CONSTRAINT chk_comanda_personas
        CHECK (personas > 0),

    CONSTRAINT chk_comanda_total
        CHECK (total >= 0),

    CONSTRAINT fk_comanda_mesa
        FOREIGN KEY (id_mesa)
        REFERENCES rest_mesa(id_mesa),

    CONSTRAINT fk_comanda_mozo
        FOREIGN KEY (id_mozo)
        REFERENCES usuario(id_usuario),

    UNIQUE KEY uq_una_comanda_abierta_por_mesa (mesa_abierta),

    INDEX idx_comanda_mesa_estado (id_mesa, estado),
    INDEX idx_comanda_apertura (apertura)
) ENGINE=InnoDB;

-- ============================================================
-- RESTAURANTE: PEDIDOS
-- ============================================================

CREATE TABLE rest_pedido (
    id_pedido INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    id_comanda INT UNSIGNED NOT NULL,
    uid VARCHAR(50) NOT NULL,
    origen VARCHAR(20) NOT NULL DEFAULT 'SALON',
    estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    id_usuario INT UNSIGNED NOT NULL,
    creado DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    enviado DATETIME NULL,
    listo DATETIME NULL,

    UNIQUE KEY uq_pedido_uid_origen (uid, origen),

    CONSTRAINT fk_pedido_comanda
        FOREIGN KEY (id_comanda)
        REFERENCES rest_comanda(id_comanda),

    CONSTRAINT fk_pedido_usuario
        FOREIGN KEY (id_usuario)
        REFERENCES usuario(id_usuario),

    INDEX idx_pedido_comanda_estado (id_comanda, estado)
) ENGINE=InnoDB;

CREATE TABLE rest_pedido_item (
    id_pedido_item INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    id_pedido INT UNSIGNED NOT NULL,
    id_item INT UNSIGNED NOT NULL,
    cantidad INT UNSIGNED NOT NULL,
    precio_unitario DECIMAL(10,2) NOT NULL,
    importe DECIMAL(10,2) NOT NULL,
    observaciones VARCHAR(255) NULL,
    anulado BOOLEAN NOT NULL DEFAULT FALSE,
    motivo_anulacion VARCHAR(255) NULL,
    id_usuario_anula INT UNSIGNED NULL,

    CONSTRAINT chk_pedido_item_cantidad
        CHECK (cantidad > 0),

    CONSTRAINT chk_pedido_item_importes
        CHECK (precio_unitario >= 0 AND importe >= 0),

    CONSTRAINT fk_pedido_item_pedido
        FOREIGN KEY (id_pedido)
        REFERENCES rest_pedido(id_pedido),

    CONSTRAINT fk_pedido_item_menu
        FOREIGN KEY (id_item)
        REFERENCES rest_item_menu(id_item),

    CONSTRAINT fk_pedido_item_anula
        FOREIGN KEY (id_usuario_anula)
        REFERENCES usuario(id_usuario),

    INDEX idx_pedido_item_pedido (id_pedido)
) ENGINE=InnoDB;

-- ============================================================
-- RESTAURANTE: PEDIDOS TEMPORALES POR QR
-- ============================================================
-- El cliente puede armar un pedido desde el QR.
-- El pedido queda pendiente hasta que lo confirme un mozo.
-- No se crea una comanda ni se envía a cocina automáticamente.
-- ============================================================

CREATE TABLE rest_pedido_qr (
    id_pedido_qr INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    id_mesa INT UNSIGNED NOT NULL,

    uid VARCHAR(50) NOT NULL,

    estado VARCHAR(20) NOT NULL DEFAULT 'POR_CONFIRMAR',

    -- Mientras está pendiente, identifica la mesa que espera.
    -- Al confirmar o descartar, se establece en NULL.
    mesa_esperando INT UNSIGNED NULL,

    creado DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    resuelto DATETIME NULL,

    id_usuario_resuelve INT UNSIGNED NULL,

    id_pedido INT UNSIGNED NULL,

    UNIQUE KEY uq_pedido_qr_uid (uid),

    -- Evita que una mesa tenga más de un QR pendiente.
    -- MariaDB permite múltiples NULL en un índice UNIQUE.
    UNIQUE KEY uq_pedido_qr_mesa_esperando (mesa_esperando),

    INDEX idx_pedido_qr_estado (estado),
    INDEX idx_pedido_qr_mesa_estado (id_mesa, estado),

    CONSTRAINT fk_pedido_qr_mesa
        FOREIGN KEY (id_mesa)
        REFERENCES rest_mesa(id_mesa),

    CONSTRAINT fk_pedido_qr_usuario_resuelve
        FOREIGN KEY (id_usuario_resuelve)
        REFERENCES usuario(id_usuario),

    CONSTRAINT fk_pedido_qr_pedido
        FOREIGN KEY (id_pedido)
        REFERENCES rest_pedido(id_pedido),

    CONSTRAINT chk_pedido_qr_estado
        CHECK (
            estado IN (
                'POR_CONFIRMAR',
                'PROCESANDO',
                'CONFIRMADO',
                'DESCARTADO'
            )
        )
) ENGINE=InnoDB;

CREATE TABLE rest_pedido_qr_item (
    id_pedido_qr_item INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    id_pedido_qr INT UNSIGNED NOT NULL,

    id_item INT UNSIGNED NOT NULL,

    cantidad INT UNSIGNED NOT NULL,

    observaciones VARCHAR(100) NULL,

    INDEX idx_pedido_qr_item_pedido (id_pedido_qr),

    CONSTRAINT fk_pedido_qr_item_pedido
        FOREIGN KEY (id_pedido_qr)
        REFERENCES rest_pedido_qr(id_pedido_qr)
        ON DELETE CASCADE,

    CONSTRAINT fk_pedido_qr_item_menu
        FOREIGN KEY (id_item)
        REFERENCES rest_item_menu(id_item),

    CONSTRAINT chk_pedido_qr_item_cantidad
        CHECK (cantidad BETWEEN 1 AND 50)
) ENGINE=InnoDB;

-- ============================================================
-- RESTAURANTE: CAJA
-- ============================================================

CREATE TABLE rest_turno_caja (
    id_turno_caja INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    fecha DATE NOT NULL,
    id_usuario_apertura INT UNSIGNED NOT NULL,
    apertura DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    saldo_inicial DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    id_usuario_cierre INT UNSIGNED NULL,
    cierre DATETIME NULL,
    efectivo_contado DECIMAL(10,2) NULL,
    diferencia DECIMAL(10,2) NULL,
    observaciones TEXT NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'ABIERTO',

    turno_abierto TINYINT
        AS (IF(estado = 'ABIERTO', 1, NULL))
        PERSISTENT,

    CONSTRAINT chk_caja_saldo
        CHECK (saldo_inicial >= 0),

    CONSTRAINT fk_turno_apertura
        FOREIGN KEY (id_usuario_apertura)
        REFERENCES usuario(id_usuario),

    CONSTRAINT fk_turno_cierre
        FOREIGN KEY (id_usuario_cierre)
        REFERENCES usuario(id_usuario),

    UNIQUE KEY uq_un_turno_caja_abierto (turno_abierto),

    INDEX idx_turno_estado_fecha (estado, fecha)
) ENGINE=InnoDB;

CREATE TABLE rest_codigo_caja (
    id_codigo INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    codigo VARCHAR(20) NOT NULL UNIQUE,
    concepto VARCHAR(100) NOT NULL,
    tipo VARCHAR(20) NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

CREATE TABLE rest_cobro (
    id_cobro INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    id_comanda INT UNSIGNED NOT NULL,
    id_turno_caja INT UNSIGNED NOT NULL,
    id_usuario INT UNSIGNED NOT NULL,
    fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    total DECIMAL(10,2) NOT NULL,
    sin_cargo BOOLEAN NOT NULL DEFAULT FALSE,
    id_autoriza INT UNSIGNED NULL,
    motivo_sin_cargo VARCHAR(255) NULL,

    CONSTRAINT chk_cobro_total
        CHECK (total >= 0),

    CONSTRAINT fk_cobro_comanda
        FOREIGN KEY (id_comanda)
        REFERENCES rest_comanda(id_comanda),

    CONSTRAINT fk_cobro_turno
        FOREIGN KEY (id_turno_caja)
        REFERENCES rest_turno_caja(id_turno_caja),

    CONSTRAINT fk_cobro_usuario
        FOREIGN KEY (id_usuario)
        REFERENCES usuario(id_usuario),

    CONSTRAINT fk_cobro_autoriza
        FOREIGN KEY (id_autoriza)
        REFERENCES usuario(id_usuario),

    INDEX idx_cobro_comanda (id_comanda),
    INDEX idx_cobro_turno (id_turno_caja)
) ENGINE=InnoDB;

CREATE TABLE rest_cobro_pago (
    id_cobro_pago INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    id_cobro INT UNSIGNED NOT NULL,
    forma VARCHAR(30) NOT NULL,
    importe DECIMAL(10,2) NOT NULL,
    medio_transferencia VARCHAR(50) NULL,
    foto_comprobante VARCHAR(255) NULL,

    CONSTRAINT chk_cobro_pago_importe
        CHECK (importe >= 0),

    CONSTRAINT fk_cobro_pago_cobro
        FOREIGN KEY (id_cobro)
        REFERENCES rest_cobro(id_cobro),

    INDEX idx_pago_cobro (id_cobro)
) ENGINE=InnoDB;

CREATE TABLE rest_movimiento_caja (
    id_movimiento INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    id_turno_caja INT UNSIGNED NOT NULL,
    id_codigo INT UNSIGNED NOT NULL,
    id_cobro INT UNSIGNED NULL,
    id_usuario INT UNSIGNED NOT NULL,
    fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    turno VARCHAR(20) NULL,
    concepto VARCHAR(100) NOT NULL,
    tipo_comprobante VARCHAR(30) NULL,
    nro_comprobante VARCHAR(50) NULL,
    dni_cuit VARCHAR(20) NULL,
    huesped_proveedor VARCHAR(150) NULL,
    detalle TEXT NULL,
    ingreso DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    egreso DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    saldo DECIMAL(10,2) NOT NULL DEFAULT 0.00,

    CONSTRAINT chk_movimiento_importes
        CHECK (ingreso >= 0 AND egreso >= 0),

    CONSTRAINT chk_movimiento_un_solo_sentido
        CHECK (NOT (ingreso > 0 AND egreso > 0)),

    CONSTRAINT fk_mov_turno
        FOREIGN KEY (id_turno_caja)
        REFERENCES rest_turno_caja(id_turno_caja),

    CONSTRAINT fk_mov_codigo
        FOREIGN KEY (id_codigo)
        REFERENCES rest_codigo_caja(id_codigo),

    CONSTRAINT fk_mov_cobro
        FOREIGN KEY (id_cobro)
        REFERENCES rest_cobro(id_cobro),

    CONSTRAINT fk_mov_usuario
        FOREIGN KEY (id_usuario)
        REFERENCES usuario(id_usuario),

    INDEX idx_movimiento_turno_fecha (id_turno_caja, fecha)
) ENGINE=InnoDB;

-- ============================================================
-- HOSPEDAJE
-- ============================================================

CREATE TABLE huesped (
    id_huesped INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    apellido VARCHAR(100) NOT NULL,
    dni VARCHAR(20) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE estadia (
    id_estadia INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    id_huesped INT UNSIGNED NOT NULL,
    nro_habitacion VARCHAR(10) NOT NULL,
    ingreso DATETIME NOT NULL,
    egreso DATETIME NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVA',

    CONSTRAINT chk_estadia_fechas
        CHECK (egreso IS NULL OR egreso >= ingreso),

    CONSTRAINT fk_estadia_huesped
        FOREIGN KEY (id_huesped)
        REFERENCES huesped(id_huesped),

    INDEX idx_estadia_habitacion_estado (nro_habitacion, estado),
    INDEX idx_estadia_huesped (id_huesped)
) ENGINE=InnoDB;

-- Se conserva la relación indicada en el diagrama recibido:
-- id_cobro_pago.
CREATE TABLE rest_cargo_habitacion (
    id_cargo INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    id_cobro_pago INT UNSIGNED NOT NULL,
    id_estadia INT UNSIGNED NOT NULL,
    importe DECIMAL(10,2) NOT NULL,
    fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',

    CONSTRAINT chk_cargo_importe
        CHECK (importe >= 0),

    CONSTRAINT fk_cargo_pago
        FOREIGN KEY (id_cobro_pago)
        REFERENCES rest_cobro_pago(id_cobro_pago),

    CONSTRAINT fk_cargo_estadia
        FOREIGN KEY (id_estadia)
        REFERENCES estadia(id_estadia),

    INDEX idx_cargo_estadia_estado (id_estadia, estado)
) ENGINE=InnoDB;

-- ============================================================
-- AUDITORÍA Y CONFIGURACIÓN
-- ============================================================

CREATE TABLE rest_auditoria (
    id_auditoria BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    id_usuario INT UNSIGNED NULL,
    accion VARCHAR(50) NOT NULL,
    tabla VARCHAR(64) NOT NULL,
    id_registro BIGINT UNSIGNED NULL,
    motivo VARCHAR(255) NULL,
    detalle TEXT NULL,

    CONSTRAINT fk_auditoria_usuario
        FOREIGN KEY (id_usuario)
        REFERENCES usuario(id_usuario),

    INDEX idx_auditoria_fecha (fecha),
    INDEX idx_auditoria_tabla_registro (tabla, id_registro)
) ENGINE=InnoDB;

CREATE TABLE rest_configuracion (
    clave VARCHAR(100) PRIMARY KEY,
    valor TEXT NOT NULL
) ENGINE=InnoDB;

-- ============================================================
-- FIN DEL ESQUEMA
-- ============================================================