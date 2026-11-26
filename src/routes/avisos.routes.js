// ============================================================
// avisos.routes.js – Avisos para el mozo (RF-PED-05)
// Prefijo (en app.js): /api/avisos
// ============================================================
// Lo ven el MOZO y el ENCARGADO (los dos usan la pantalla de Mesas).
// ============================================================

const router = require("express").Router();

const asyncHandler = require("../utils/asyncHandler");
const c = require("../controllers/avisos.controller");
const auth = require("../middlewares/auth");
const roles = require("../middlewares/roles");

router.use(auth);
router.use(roles("MOZO", "ENCARGADO"));

// Pedidos listos para llevar a la mesa
router.get("/pedidos-listos", asyncHandler(c.pedidosListos));

module.exports = router;