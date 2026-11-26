// ============================================================
// usuarios.controller.js – ABM de usuarios del restaurante (RF-USU-03)
// ============================================================
// Alta: es la de Rosario, con dos agregados:
//   - Limpia espacios y valida el formato del usuario y el nombre.
//   - Si el usuario ya existe, responde 409 con un mensaje claro
//     (antes daba un error 500 genérico).
// Nuevo: listar, editar (nombre y rol), cambiar contraseña,
// activar/desactivar.
//
// La tabla "usuario" la COMPARTEN los tres sistemas. Por eso:
//   - Solo se ven y se tocan usuarios con rol en sistema = 'HOSTERIA'
//     (eso lo filtran los procedimientos de 97_usuarios.sql).
//   - Nunca se borra un usuario: se desactiva (el login ya rechaza
//     a los inactivos) y su historial queda intacto.
//
// Las reglas de negocio están ACÁ y no en la base porque son más
// fáciles de leer y de defender, y porque así cada error sale con
// el código HTTP correcto (400, 404, 409).
// Todas las rutas son solo para ENCARGADO (ver usuarios.routes.js).
// ============================================================

const bcrypt = require("bcryptjs");
const { callProcedure } = require("../config/db");
const HttpError = require("../utils/httpError");
const audit = require("../services/audit.service");

const ROLES_VALIDOS = ["ENCARGADO", "MOZO", "COCINA"];

// Mismo costo de bcrypt que en el alta de Rosario: si fuera distinto,
// igual funcionaría, pero así todos los hash quedan iguales.
const COSTO_BCRYPT = 12;

// Usuario del login: letras, números, punto, guion y guion bajo,
// de 3 a 50 caracteres, sin espacios (propuesta).
const FORMATO_USUARIO = /^[a-zA-Z0-9._-]{3,50}$/;

// ------------------------------------------------------------
// Funciones de ayuda
// ------------------------------------------------------------

// Lee el :id de la URL y verifica que sea un número entero positivo.
function leerId(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, "Id de usuario inválido.");
  }
  return id;
}

// Valida el nombre visible (el que aparece en pantalla).
function validarNombre(nombre) {
  if (nombre.length < 2 || nombre.length > 100) {
    throw new HttpError(400, "El nombre debe tener entre 2 y 100 caracteres.");
  }
}

function validarRol(rol) {
  if (!ROLES_VALIDOS.includes(rol)) {
    throw new HttpError(400, "Rol inválido. Usá ENCARGADO, MOZO o COCINA.");
  }
}

function validarClave(clave) {
  if (typeof clave !== "string" || clave.length < 8) {
    throw new HttpError(400, "La contraseña debe tener al menos 8 caracteres.");
  }
}

// Busca un usuario DEL RESTAURANTE. Si no existe o no tiene rol en
// HOSTERIA (por ejemplo, es solo de reservas), responde 404.
async function obtenerUsuario(id) {
  const filas = await callProcedure("sp_usuario_obtener", [id]);
  const usuario = filas[0];
  if (!usuario) {
    throw new HttpError(404, "El usuario no existe en el restaurante.");
  }
  // MariaDB puede devolver los números como texto: los pasamos a número.
  usuario.activo = Number(usuario.activo);
  usuario.otros_sistemas = Number(usuario.otros_sistemas);
  return usuario;
}

// Cuántos encargados activos hay en el restaurante.
async function contarEncargadosActivos() {
  const filas = await callProcedure("sp_usuario_encargados_activos", []);
  return Number(filas[0].total);
}

// ¿Este cambio deja al restaurante sin ningún encargado activo?
// Pasa si el usuario HOY es encargado activo y es el único.
async function esUltimoEncargado(usuario) {
  if (usuario.rol !== "ENCARGADO" || usuario.activo !== 1) {
    return false;
  }
  const total = await contarEncargadosActivos();
  return total <= 1;
}

// ------------------------------------------------------------
// GET /api/usuarios – Listar usuarios del restaurante
// ------------------------------------------------------------
exports.listarUsuarios = async (req, res) => {
  const filas = await callProcedure("sp_usuario_listar", []);

  // Se mandan números y booleanos reales, nunca la contraseña.
  const usuarios = filas.map((u) => ({
    id_usuario: u.id_usuario,
    nombre: u.nombre,
    usuario: u.usuario,
    rol: u.rol,
    activo: Number(u.activo) === 1,
    creado: u.creado,
    // true = también se usa en reservas o stock
    otros_sistemas: Number(u.otros_sistemas) > 0
  }));

  res.json(usuarios);
};

// ------------------------------------------------------------
// POST /api/usuarios – Alta (de Rosario + validaciones y 409)
// ------------------------------------------------------------
exports.crearUsuario = async (req, res) => {
  const body = req.body || {};
  const nombre = String(body.nombre || "").trim();
  const usuario = String(body.usuario || "").trim();
  const clave = body.clave;
  const rol = body.rol;

  if (!nombre || !usuario || !clave || !rol) {
    throw new HttpError(
      400,
      "Nombre, usuario, contraseña y rol son obligatorios."
    );
  }

  validarNombre(nombre);

  if (!FORMATO_USUARIO.test(usuario)) {
    throw new HttpError(
      400,
      "El usuario debe tener de 3 a 50 caracteres: letras, números, punto, guion o guion bajo, sin espacios."
    );
  }

  validarClave(clave);
  validarRol(rol);

  const hash = await bcrypt.hash(clave, COSTO_BCRYPT);

  let result;
  try {
    result = await callProcedure("sp_usuario_crear", [
      nombre,
      usuario,
      hash,
      rol
    ]);
  } catch (error) {
    // La columna usuario.usuario es UNIQUE: si ya existe, MariaDB
    // devuelve ER_DUP_ENTRY. Puede ser un usuario de otro sistema.
    if (error.code === "ER_DUP_ENTRY") {
      throw new HttpError(
        409,
        `Ya existe el usuario "${usuario}" (puede ser de reservas o stock). Elegí otro.`
      );
    }
    throw error;
  }

  await audit(
    req.user.id_usuario,
    "CREAR",
    "usuario",
    result[0].id_usuario,
    { usuario, rol }
  );

  res.status(201).json({
    mensaje: "Usuario creado correctamente.",
    id_usuario: result[0].id_usuario,
    nombre,
    usuario,
    rol
  });
};

// ------------------------------------------------------------
// PUT /api/usuarios/:id – Editar nombre y rol
// El usuario del login NO se cambia (propuesta).
// ------------------------------------------------------------
exports.editarUsuario = async (req, res) => {
  const id = leerId(req);
  const body = req.body || {};
  const nombre = String(body.nombre || "").trim();
  const rol = body.rol;

  if (!nombre || !rol) {
    throw new HttpError(400, "Nombre y rol son obligatorios.");
  }

  validarNombre(nombre);
  validarRol(rol);

  const actual = await obtenerUsuario(id);
  const cambiaRol = actual.rol !== rol;

  if (cambiaRol && actual.rol === "ENCARGADO") {
    // Si el encargado se saca a sí mismo el rol, pierde el acceso
    // a esta pantalla en el mismo momento.
    if (id === req.user.id_usuario) {
      throw new HttpError(
        409,
        "No podés quitarte a vos mismo el rol de encargado."
      );
    }
    if (await esUltimoEncargado(actual)) {
      throw new HttpError(
        409,
        "Es el único encargado activo: el restaurante quedaría sin nadie que lo administre."
      );
    }
  }

  await callProcedure("sp_usuario_editar", [id, nombre, rol]);

  await audit(req.user.id_usuario, "EDITAR", "usuario", id, {
    antes: { nombre: actual.nombre, rol: actual.rol },
    despues: { nombre, rol }
  });

  res.json({
    mensaje: "Usuario actualizado.",
    id_usuario: id,
    nombre,
    usuario: actual.usuario,
    rol
  });
};

// ------------------------------------------------------------
// PATCH /api/usuarios/:id/clave – Cambiar contraseña
// OJO: la clave está en la tabla compartida; si el usuario también
// se usa en reservas o stock, cambia allá también.
// ------------------------------------------------------------
exports.cambiarClave = async (req, res) => {
  const id = leerId(req);
  const { clave } = req.body || {};

  validarClave(clave);

  const actual = await obtenerUsuario(id);

  const hash = await bcrypt.hash(clave, COSTO_BCRYPT);
  await callProcedure("sp_usuario_cambiar_clave", [id, hash]);

  // En la auditoría NUNCA va la contraseña ni el hash.
  await audit(req.user.id_usuario, "CAMBIAR_CLAVE", "usuario", id, {
    usuario: actual.usuario
  });

  res.json({
    mensaje: "Contraseña actualizada.",
    id_usuario: id,
    otros_sistemas: actual.otros_sistemas > 0
  });
};

// ------------------------------------------------------------
// PATCH /api/usuarios/:id/activo – Activar o desactivar
// Body: { "activo": true } o { "activo": false }
// ------------------------------------------------------------
exports.cambiarActivo = async (req, res) => {
  const id = leerId(req);
  const { activo } = req.body || {};

  if (typeof activo !== "boolean") {
    throw new HttpError(400, 'Mandá "activo": true o false.');
  }

  const actual = await obtenerUsuario(id);

  if (!activo) {
    if (id === req.user.id_usuario) {
      throw new HttpError(409, "No podés desactivarte a vos mismo.");
    }
    // "activo" está en la tabla compartida: desactivarlo acá también
    // lo dejaría afuera de reservas o stock.
    if (actual.otros_sistemas > 0) {
      throw new HttpError(
        409,
        "Este usuario también se usa en otro sistema (reservas o stock). No se puede desactivar desde el restaurante."
      );
    }
    if (await esUltimoEncargado(actual)) {
      throw new HttpError(
        409,
        "Es el único encargado activo: el restaurante quedaría sin nadie que lo administre."
      );
    }
  }

  await callProcedure("sp_usuario_activar", [id, activo ? 1 : 0]);

  await audit(
    req.user.id_usuario,
    activo ? "ACTIVAR" : "DESACTIVAR",
    "usuario",
    id,
    { usuario: actual.usuario }
  );

  res.json({
    mensaje: activo ? "Usuario activado." : "Usuario desactivado.",
    id_usuario: id,
    activo
  });
};