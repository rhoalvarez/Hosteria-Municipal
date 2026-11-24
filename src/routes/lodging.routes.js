const router = require("express").Router();

const asyncHandler = require("../utils/asyncHandler");
const c = require("../controllers/lodging.controller");
const auth = require("../middlewares/auth");
const roles = require("../middlewares/roles");

router.use(auth);

// Huéspedes
router.get(
  "/huespedes",
  roles("ENCARGADO"),
  asyncHandler(c.huespedes)
);

router.post(
  "/huespedes",
  roles("ENCARGADO"),
  asyncHandler(c.crearHuesped)
);

// Estadías
router.get(
  "/estadias",
  roles("ENCARGADO"),
  asyncHandler(c.estadias)
);

router.post(
  "/estadias",
  roles("ENCARGADO"),
  asyncHandler(c.crearEstadia)
);

module.exports = router;