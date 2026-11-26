const router = require("express").Router();

const asyncHandler = require("../utils/asyncHandler");
const c = require("../controllers/restaurant.controller");
const auth = require("../middlewares/auth");
const roles = require("../middlewares/roles");

// =====================================================
// PEDIDOS QR PÚBLICOS
// No requieren iniciar sesión.
// =====================================================

// Consultar menú y mesa mediante el código QR
router.get(
  "/qr/:codigo/menu",
  asyncHandler(c.qrMenu)
);

// Enviar pedido desde el celular del cliente
router.post(
  "/qr/:codigo/pedidos",
  asyncHandler(c.qrCrearPedido)
);

// =====================================================
// RUTAS PROTEGIDAS
// Requieren autenticación.
// =====================================================

router.use(auth);

// =====================================================
// COMANDAS
// =====================================================

// Listar comandas abiertas
router.get(
  "/comandas/abiertas",
  roles("ENCARGADO", "MOZO"),
  asyncHandler(c.comandasAbiertas)
);

// Abrir comanda sin pedido inicial
router.post(
  "/comandas",
  roles("ENCARGADO", "MOZO"),
  asyncHandler(c.abrirComanda)
);

// Crear comanda y primer pedido
router.post(
  "/comandas/primer-pedido",
  roles("ENCARGADO", "MOZO"),
  asyncHandler(c.pedidoInicial)
);

// =====================================================
// PEDIDOS
// =====================================================

// Agregar pedido a una comanda existente
router.post(
  "/comandas/:id/pedidos",
  roles("ENCARGADO", "MOZO"),
  asyncHandler(c.crearPedido)
);

// Consultar detalle de un pedido
router.get(
  "/pedidos/:id",
  roles("ENCARGADO", "MOZO", "COCINA"),
  asyncHandler(c.detallePedido)
);

// Cambiar estado del pedido
router.patch(
  "/pedidos/:id/estado",
  roles("ENCARGADO", "COCINA"),
  asyncHandler(c.estadoPedido)
);

// Anular un ítem ya enviado a cocina (RF-PED-06)
// Solo el encargado. :id es el id_pedido_item (un renglón del pedido).
// Body: { "motivo": "..." } (mínimo 5 letras).
router.patch(
  "/pedidos-items/:id/anular",
  roles("ENCARGADO"),
  asyncHandler(c.anularItem)
);

// =====================================================
// PEDIDOS QR PARA EL MOZO
// Rutas solicitadas por Luján.
// =====================================================

// Listar pedidos QR pendientes
router.get(
  "/pedidos-qr",
  roles("ENCARGADO", "MOZO"),
  asyncHandler(c.qrPedidosPendientes)
);

// Confirmar pedido QR
router.post(
  "/pedidos-qr/:id/confirmar",
  roles("ENCARGADO", "MOZO"),
  asyncHandler(c.qrResolverPedido)
);

// Descartar pedido QR
router.post(
  "/pedidos-qr/:id/descartar",
  roles("ENCARGADO", "MOZO"),
  asyncHandler(c.qrDescartarPedido)
);

// =====================================================
// COCINA
// =====================================================

// Listar pedidos pendientes
router.get(
  "/cocina/pedidos",
  roles("ENCARGADO", "COCINA"),
  asyncHandler(c.pedidosCocina)
);

// Marcar pedido como listo
router.patch(
  "/pedidos/:id/listo",
  roles("ENCARGADO", "COCINA"),
  asyncHandler(c.marcarListo)
);

// =====================================================
// CUENTA
// =====================================================

// Solicitar cuenta de una comanda
router.post(
  "/comandas/:id/cuenta",
  roles("ENCARGADO", "MOZO"),
  asyncHandler(c.pedirCuenta)
);

// =====================================================
// PEDIDOS POR MESA
// =====================================================

// Consultar pedidos de una mesa
router.get(
  "/mesas/:id/pedidos",
  roles("ENCARGADO", "MOZO"),
  asyncHandler(c.pedidosMesa)
);

module.exports = router;