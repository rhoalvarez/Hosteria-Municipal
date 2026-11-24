const router = require("express").Router();

const asyncHandler = require("../utils/asyncHandler");
const c = require("../controllers/restaurant.controller");
const auth = require("../middlewares/auth");
const roles = require("../middlewares/roles");

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

// Crear comanda y primer pedido en una sola transacción
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