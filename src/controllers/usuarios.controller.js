const bcrypt = require("bcryptjs");
const { callProcedure } = require("../config/db");
const HttpError = require("../utils/httpError");
const audit = require("../services/audit.service");

const ROLES_VALIDOS = ["ENCARGADO", "MOZO", "COCINA"];

exports.crearUsuario = async (req, res) => {
  const { nombre, usuario, clave, rol } = req.body || {};

  if (!nombre || !usuario || !clave || !rol) {
    throw new HttpError(
      400,
      "Nombre, usuario, contraseña y rol son obligatorios."
    );
  }

  if (clave.length < 8) {
    throw new HttpError(
      400,
      "La contraseña debe tener al menos 8 caracteres."
    );
  }

  if (!ROLES_VALIDOS.includes(rol)) {
    throw new HttpError(
      400,
      "Rol inválido. Usá ENCARGADO, MOZO o COCINA."
    );
  }

  const hash = await bcrypt.hash(clave, 12);

  const result = await callProcedure("sp_usuario_crear", [
    nombre,
    usuario,
    hash,
    rol
  ]);

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