// ============================================================
// stats.routes.js – Rutas de estadísticas (Incremento 3)
// ============================================================
// Las estadísticas muestran ventas e ingresos: son solo para el rol
// ENCARGADO (las recepcionistas entran con ese rol). Igual que en
// caja, auth y roles se aplican una sola vez a todo el router.
// Prefijo (en app.js): /api/estadisticas
// ============================================================

const router = require("express").Router();

const asyncHandler = require("../utils/asyncHandler");
const c = require("../controllers/stats.controller");
const auth = require("../middlewares/auth");
const roles = require("../middlewares/roles");

router.use(auth);
router.use(roles("ENCARGADO"));

// Ranking de platos vendidos (RF-EST-01)
// ?desde=AAAA-MM-DD&hasta=AAAA-MM-DD&categoria=<id> (categoria opcional)
router.get("/platos", asyncHandler(c.rankingPlatos));

// Ingresos por semana o por mes, por forma de pago (RF-EST-02)
// ?desde=AAAA-MM-DD&hasta=AAAA-MM-DD&agrupar=SEMANA|MES
router.get("/ingresos", asyncHandler(c.ingresos));

// Ventas por mozo y comensales (RF-EST-05)
// ?desde=AAAA-MM-DD&hasta=AAAA-MM-DD
router.get("/mozos", asyncHandler(c.ventasMozos));

module.exports = router;