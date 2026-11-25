USE hosteria;

-- =====================================================
-- PEDIDOS QR - HOSTERÍA
-- Compatible con la base existente y nuevas instalaciones
-- =====================================================


-- =====================================================
-- 1. BANDEJA DE PEDIDOS QR
-- =====================================================

CREATE TABLE IF NOT EXISTS rest_pedido_qr (
    id_pedido_qr INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    id_mesa INT UNSIGNED NOT NULL,

    uid VARCHAR(50) NOT NULL UNIQUE,

    estado VARCHAR(20) NOT NULL DEFAULT 'POR_CONFIRMAR',

    mesa_esperando INT UNSIGNED NULL UNIQUE,

    creado DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    resuelto DATETIME NULL,

    id_usuario_resuelve INT UNSIGNED NULL,

    id_pedido INT UNSIGNED NULL,

    CONSTRAINT fk_qr_mesa
        FOREIGN KEY (id_mesa)
        REFERENCES rest_mesa(id_mesa),

    CONSTRAINT fk_qr_usuario
        FOREIGN KEY (id_usuario_resuelve)
        REFERENCES usuario(id_usuario),

    CONSTRAINT fk_qr_pedido
        FOREIGN KEY (id_pedido)
        REFERENCES rest_pedido(id_pedido),

    INDEX idx_qr_estado (estado),

    INDEX idx_qr_mesa (id_mesa)

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_general_ci;


-- =====================================================
-- 2. ITEMS DEL PEDIDO QR
-- =====================================================

CREATE TABLE IF NOT EXISTS rest_pedido_qr_item (
    id_pedido_qr_item INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    id_pedido_qr INT UNSIGNED NOT NULL,

    id_item INT UNSIGNED NOT NULL,

    cantidad INT UNSIGNED NOT NULL,

    observaciones VARCHAR(100) NULL,

    CONSTRAINT fk_qr_item_pedido
        FOREIGN KEY (id_pedido_qr)
        REFERENCES rest_pedido_qr(id_pedido_qr),

    CONSTRAINT fk_qr_item_menu
        FOREIGN KEY (id_item)
        REFERENCES rest_item_menu(id_item),

    INDEX idx_qr_item_pedido (id_pedido_qr)

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_general_ci;


-- =====================================================
-- 3. GENERAR CÓDIGOS QR PARA LAS MESAS
-- Solo genera códigos para mesas que todavía no tienen.
-- No modifica los códigos QR existentes.
-- =====================================================

UPDATE rest_mesa
SET codigo_qr = LOWER(
    LEFT(
        SHA2(CONCAT(id_mesa, RAND(), NOW(6)), 256),
        10
    )
)
WHERE codigo_qr IS NULL
   OR codigo_qr = '';


-- =====================================================
-- 4. VERIFICACIÓN
-- =====================================================

SHOW TABLES LIKE 'rest_pedido_qr%';

SELECT
    id_mesa,
    numero,
    codigo_qr
FROM rest_mesa
ORDER BY numero;