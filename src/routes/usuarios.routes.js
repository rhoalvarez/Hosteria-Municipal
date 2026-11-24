const router = require("express").Router();

const asyncHandler = require("../utils/asyncHandler");
const c = require("../controllers/usuarios.controller");
const auth = require("../middlewares/auth");
const roles = require("../middlewares/roles");

router.use(auth);

router.post(
  "/",
  roles("ENCARGADO"),
  asyncHandler(c.crearUsuario)
);

module.exports = router;