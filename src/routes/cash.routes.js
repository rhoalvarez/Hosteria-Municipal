const router = require("express").Router();

const asyncHandler = require("../utils/asyncHandler");
const c = require("../controllers/cash.controller");
const auth = require("../middlewares/auth");
const roles = require("../middlewares/roles");

router.use(auth);

// Apertura y cierre de caja
router.post(
  "/turnos/apertura",
  roles("ENCARGADO"),
  asyncHandler(c.abrirCaja)
);

router.post(
  "/turnos/:id/cierre",
  roles("ENCARGADO"),
  asyncHandler(c.cerrarCaja)
);

// Cobros
router.post(
  "/comandas/:id/cobros",
  roles("ENCARGADO"),
  asyncHandler(c.cobrarComanda)
);

module.exports = router;