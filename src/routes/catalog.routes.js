const router = require("express").Router();

const asyncHandler = require("../utils/asyncHandler");
const c = require("../controllers/catalog.controller");
const auth = require("../middlewares/auth");
const roles = require("../middlewares/roles");

router.use(auth);

// Categorías
router.get("/categorias", asyncHandler(c.categorias));

router.post(
  "/categorias",
  roles("ENCARGADO"),
  asyncHandler(c.crearCategoria)
);

// Menú
router.get("/menu", asyncHandler(c.menu));

router.post(
  "/menu",
  roles("ENCARGADO"),
  asyncHandler(c.crearMenu)
);

router.put(
  "/menu/:id",
  roles("ENCARGADO"),
  asyncHandler(c.editarMenu)
);

router.delete(
  "/menu/:id",
  roles("ENCARGADO"),
  asyncHandler(c.eliminarMenu)
);

router.patch(
  "/menu/:id/disponible",
  roles("ENCARGADO"),
  asyncHandler(c.cambiarDisponibilidad)
);

router.get(
  "/menu/bajas",
  roles("ENCARGADO"),
  asyncHandler(c.menuBajas)
);

router.patch(
  "/menu/:id/reactivar",
  roles("ENCARGADO"),
  asyncHandler(c.reactivarMenu)
);

// Mesas
router.get("/mesas", asyncHandler(c.mesas));

router.post(
  "/mesas",
  roles("ENCARGADO"),
  asyncHandler(c.crearMesa)
);

module.exports = router;