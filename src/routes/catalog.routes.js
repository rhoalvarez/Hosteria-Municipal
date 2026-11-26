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

// Aumento de precios por porcentaje (solo encargado).
// Van ANTES de "/menu/:id" por claridad: así nadie piensa que
// "aumento" se toma como un id.
// GET  = vista previa (no cambia nada) · POST = aplicar
router.get(
  "/menu/aumento",
  roles("ENCARGADO"),
  asyncHandler(c.vistaAumento)
);

router.post(
  "/menu/aumento",
  roles("ENCARGADO"),
  asyncHandler(c.aplicarAumento)
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