const { callProcedure } = require("../config/db");
const HttpError = require("../utils/httpError");
const audit = require("../services/audit.service");

exports.categorias = async (req, res) => {
  res.json(await callProcedure("sp_categoria_listar"));
};

exports.crearCategoria = async (req, res) => {
  const { letra, nombre } = req.body || {};

  if (!letra || !nombre) {
    throw new HttpError(400, "Letra y nombre son obligatorios.");
  }

  const result = (
    await callProcedure("sp_categoria_crear", [letra, nombre])
  )[0];

  await audit(req.user.id_usuario, "CREAR", "rest_categoria", result.id_categoria, {
    letra,
    nombre,
  });

  res.status(201).json(result);
};

exports.menu = async (req, res) => {
  res.json(
    await callProcedure("sp_menu_listar", [
      req.query.todos === "true" ? 0 : 1,
    ])
  );
};

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
    !Number.isFinite(Number(precio)) ||
    Number(precio) < 0
  ) {
    throw new HttpError(
      400,
      "Código, categoría, nombre y precio válido son obligatorios."
    );
  }

  const result = (
    await callProcedure("sp_menu_crear", [
      codigo,
      id_categoria,
      nombre,
      descripcion,
      Number(precio),
    ])
  )[0];

  await audit(req.user.id_usuario, "CREAR", "rest_item_menu", result.id_item, {
    codigo,
    nombre,
  });

  res.status(201).json(result);
};

// Editar un producto del menú
exports.editarMenu = async (req, res) => {
  const { codigo, id_categoria, nombre, descripcion = null, precio } =
    req.body || {};

  if (
    !codigo ||
    !id_categoria ||
    !nombre ||
    precio === undefined ||
    !Number.isFinite(Number(precio)) ||
    Number(precio) < 0
  ) {
    throw new HttpError(400, "Revisá los datos del producto y el precio.");
  }

  const result = await callProcedure("sp_menu_editar", [
    req.params.id,
    codigo,
    id_categoria,
    nombre,
    descripcion,
    Number(precio),
  ]);

  await audit(req.user.id_usuario, "EDITAR", "rest_item_menu", req.params.id, {
    codigo,
    nombre,
  });

  res.json(result[0] || { mensaje: "Producto actualizado." });
};

// Baja lógica
exports.eliminarMenu = async (req, res) => {
  const result = await callProcedure("sp_menu_baja", [req.params.id]);

  await audit(req.user.id_usuario, "BAJA", "rest_item_menu", req.params.id);

  res.json(result[0] || { mensaje: "Producto dado de baja." });
};

// Cambiar disponibilidad
exports.cambiarDisponibilidad = async (req, res) => {
  const { disponible } = req.body || {};

  if (typeof disponible !== "boolean") {
    throw new HttpError(400, "Indicá si el producto está disponible.");
  }

  const result = await callProcedure("sp_menu_disponibilidad", [
    req.params.id,
    disponible ? 1 : 0,
  ]);

  await audit(
    req.user.id_usuario,
    "CAMBIAR_DISPONIBILIDAD",
    "rest_item_menu",
    req.params.id,
    { disponible }
  );

  res.json(result[0] || { mensaje: "Disponibilidad actualizada." });
};

// Listar productos dados de baja
exports.menuBajas = async (req, res) => {
  res.json(await callProcedure("sp_menu_listar_bajas"));
};

// Reactivar producto
exports.reactivarMenu = async (req, res) => {
  const result = await callProcedure("sp_menu_reactivar", [req.params.id]);

  await audit(req.user.id_usuario, "REACTIVAR", "rest_item_menu", req.params.id);

  res.json(result[0] || { mensaje: "Producto reactivado." });
};

exports.mesas = async (req, res) => {
  res.json(await callProcedure("sp_mesa_listar"));
};

exports.crearMesa = async (req, res) => {
  const { numero, capacidad, codigo_qr = null } = req.body || {};

  if (!numero || !capacidad || Number(capacidad) < 1) {
    throw new HttpError(400, "Número y capacidad válida son obligatorios.");
  }

  const result = (
    await callProcedure("sp_mesa_crear", [
      numero,
      Number(capacidad),
      codigo_qr,
    ])
  )[0];

  await audit(req.user.id_usuario, "CREAR", "rest_mesa", result.id_mesa, {
    numero,
  });

  res.status(201).json(result);
};