const { callProcedure } = require("../config/db");
const HttpError = require("../utils/httpError");
const audit = require("../services/audit.service");
exports.categorias = async (req, res) =>
  res.json(await callProcedure("sp_categoria_listar"));
exports.crearCategoria = async (req, res) => {
  const { letra, nombre } = req.body || {};
  if (!letra || !nombre)
    throw new HttpError(400, "Letra y nombre son obligatorios.");
  const result = (
    await callProcedure("sp_categoria_crear", [letra, nombre])
  )[0];
  await audit(
    req.user.id_usuario,
    "CREAR",
    "rest_categoria",
    result.id_categoria,
    { letra, nombre },
  );
  res.status(201).json(result);
};
exports.menu = async (req, res) =>
  res.json(
    await callProcedure("sp_menu_listar", [req.query.todos === "true" ? 0 : 1]),
  );
exports.crearMenu = async (req, res) => {
  const {
    codigo,
    id_categoria,
    nombre,
    descripcion = null,
    precio,
  } = req.body || {};
  if (
    !codigo ||
    !id_categoria ||
    !nombre ||
    precio === undefined ||
    Number(precio) < 0
  )
    throw new HttpError(
      400,
      "Código, categoría, nombre y precio válido son obligatorios.",
    );
  const result = (
    await callProcedure("sp_menu_crear", [
      codigo,
      id_categoria,
      nombre,
      descripcion,
      precio,
    ])
  )[0];
  await audit(req.user.id_usuario, "CREAR", "rest_item_menu", result.id_item, {
    codigo,
    nombre,
  });
  res.status(201).json(result);
};
exports.mesas = async (req, res) =>
  res.json(await callProcedure("sp_mesa_listar"));
exports.crearMesa = async (req, res) => {
  const { numero, capacidad, codigo_qr = null } = req.body || {};
  if (!numero || !capacidad)
    throw new HttpError(400, "Número y capacidad son obligatorios.");
  const result = (
    await callProcedure("sp_mesa_crear", [numero, capacidad, codigo_qr])
  )[0];
  await audit(req.user.id_usuario, "CREAR", "rest_mesa", result.id_mesa, {
    numero,
  });
  res.status(201).json(result);
};
