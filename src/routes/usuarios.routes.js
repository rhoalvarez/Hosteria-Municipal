// ============================================================
// usuarios.routes.js – ABM de usuarios del restaurante (RF-USU-03)
// Prefijo (en app.js): /api/usuarios
// ============================================================
// Todas las rutas piden sesión iniciada (auth) y rol ENCARGADO.
// En el restaurante no hay rol recepción: las recepcionistas
// entran como encargadas (decidido 22/11).
//
//   GET    /api/usuarios             → listar usuarios del restaurante
//   POST   /api/usuarios             → alta (la de Rosario)
//   PUT    /api/usuarios/:id         → editar nombre y rol
//   PATCH  /api/usuarios/:id/clave   → cambiar contraseña
//   PATCH  /api/usuarios/:id/activo  → activar / desactivar
//
// No hay DELETE a propósito: un usuario nunca se borra porque
// sus comandas, pedidos y cobros lo referencian. Se desactiva.
// ============================================================

const router = require("express").Router();

const asyncHandler = require("../utils/asyncHandler");
const c = require("../controllers/usuarios.controller");
const auth = require("../middlewares/auth");
const roles = require("../middlewares/roles");

// Primero se verifica el token; después, el rol en cada ruta.
router.use(auth);

router.get(
  "/",
  roles("ENCARGADO"),
  asyncHandler(c.listarUsuarios)
);

router.post(
  "/",
  roles("ENCARGADO"),
  asyncHandler(c.crearUsuario)
);

router.put(
  "/:id",
  roles("ENCARGADO"),
  asyncHandler(c.editarUsuario)
);

router.patch(
  "/:id/clave",
  roles("ENCARGADO"),
  asyncHandler(c.cambiarClave)
);

router.patch(
  "/:id/activo",
  roles("ENCARGADO"),
  asyncHandler(c.cambiarActivo)
);

module.exports = router;