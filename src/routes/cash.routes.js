// ============================================================
// cash.routes.js – Rutas de caja (Incremento 3)
// ============================================================
// Toda la caja es solo para el rol ENCARGADO (las recepcionistas
// entran con ese rol). Por eso auth y roles se aplican una sola vez
// a todo el router, en lugar de repetirlos en cada ruta.
// ============================================================

const router = require("express").Router();

const asyncHandler = require("../utils/asyncHandler");
const c = require("../controllers/cash.controller");
const auth = require("../middlewares/auth");
const roles = require("../middlewares/roles");

router.use(auth);
router.use(roles("ENCARGADO"));

// ---------- Consultas ----------

// Turno abierto con sus totales: { abierto, turno }
router.get("/turno-actual", asyncHandler(c.turnoActual));

// Historial de turnos (?cantidad=30)
router.get("/turnos", asyncHandler(c.listarTurnos));

// Resumen de un turno (abierto o cerrado)
router.get("/turnos/:id", asyncHandler(c.resumenTurno));

// Movimientos de un turno (pantalla y exportar CSV)
router.get("/turnos/:id/movimientos", asyncHandler(c.movimientosTurno));

// Códigos para movimientos manuales (sin COBRO)
router.get("/codigos", asyncHandler(c.codigosCaja));

// Huéspedes alojados, para el cargo a habitación (RF-HAB)
router.get("/estadias-activas", asyncHandler(c.estadiasActivas));

// ---------- Apertura, cierre y reapertura ----------

router.post("/turnos/apertura", asyncHandler(c.abrirCaja));
router.post("/turnos/:id/cierre", asyncHandler(c.cerrarCaja));
router.post("/turnos/:id/reapertura", asyncHandler(c.reabrirCaja));

// ---------- Cobros y movimientos ----------

// Cobro de una comanda (pago dividido, sin cargo, cargo a habitación)
router.post("/comandas/:id/cobros", asyncHandler(c.cobrarComanda));

// Movimiento manual: gasto, proveedor, ajuste
router.post("/movimientos", asyncHandler(c.registrarMovimiento));

// ---------- Fotos de comprobantes de transferencia (RF-CAJ-13/14) ----------

// Subir la foto (JSON con la imagen en base64). Devuelve { archivo }
router.post("/comprobantes", asyncHandler(c.subirComprobante));

// Ver la foto (solo con sesión de encargado: no es una dirección pública)
router.get("/comprobantes/:archivo", asyncHandler(c.verComprobante));

module.exports = router;