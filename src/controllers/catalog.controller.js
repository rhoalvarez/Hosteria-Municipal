const { callProcedure } = require("../config/db");
const HttpError = require("../utils/httpError");
const audit = require("../services/audit.service");

// ==========================================
// VALIDACIONES DEL MENÚ
// ==========================================

// Validar nombre
function validarNombre(nombre) {
  if (typeof nombre !== "string") {
    throw new HttpError(400, "El nombre debe ser un texto.");
  }

  const nombreLimpio = nombre.trim();

  if (nombreLimpio.length < 2 || nombreLimpio.length > 60) {
    throw new HttpError(
      400,
      "El nombre debe tener entre 2 y 60 caracteres."
    );
  }

  return nombreLimpio;
}

// Validar código, categoría, nombre y precio
async function validarProducto(codigo, id_categoria, nombre, precio) {
  if (typeof codigo !== "string") {
    throw new HttpError(400, "El código debe ser un texto.");
  }

  codigo = codigo.trim().toUpperCase();

  // Formato utilizado: A01, A02, B04
  if (!/^[A-Z][0-9]{2}$/.test(codigo)) {
    throw new HttpError(
      400,
      "El código debe tener una letra y dos números. Ejemplo: A01."
    );
  }

  // Validar categoría
  if (
    id_categoria === undefined ||
    id_categoria === null ||
    id_categoria === "" ||
    !Number.isInteger(Number(id_categoria)) ||
    Number(id_categoria) <= 0
  ) {
    throw new HttpError(400, "Seleccioná una categoría válida.");
  }

  // Validar nombre
  nombre = validarNombre(nombre);

  // Validar precio entero
  if (
    precio === undefined ||
    precio === null ||
    precio === "" ||
    !Number.isInteger(Number(precio)) ||
    Number(precio) < 0
  ) {
    throw new HttpError(
      400,
      "El precio debe ser un número entero mayor o igual a cero."
    );
  }

  // Buscar categoría existente
  const categorias = await callProcedure("sp_categoria_listar");

  const categoria = categorias.find(
    (cat) => Number(cat.id_categoria) === Number(id_categoria)
  );

  if (!categoria) {
    throw new HttpError(400, "La categoría seleccionada no existe.");
  }

  // El código debe comenzar con la letra de su categoría
  if (codigo[0] !== String(categoria.letra).toUpperCase()) {
    throw new HttpError(
      400,
      `El código debe comenzar con la letra ${categoria.letra} de la categoría seleccionada.`
    );
  }

  return {
    codigo,
    id_categoria: Number(id_categoria),
    nombre,
    precio: Number(precio),
  };
}

// ==========================================
// MANEJO DE CÓDIGO DUPLICADO
// ==========================================

function manejarErrorDuplicado(error, codigo) {
  if (error.code === "ER_DUP_ENTRY" || error.errno === 1062) {
    throw new HttpError(
      409,
      `Ya existe un plato con el código ${codigo}.`
    );
  }

  throw error;
}

// ==========================================
// CATEGORÍAS
// ==========================================

// Listar categorías
exports.categorias = async (req, res) => {
  res.json(await callProcedure("sp_categoria_listar"));
};

// Crear categoría
exports.crearCategoria = async (req, res) => {
  const { letra, nombre } = req.body || {};

  if (
    typeof letra !== "string" ||
    typeof nombre !== "string" ||
    !letra.trim() ||
    !nombre.trim()
  ) {
    throw new HttpError(400, "Letra y nombre son obligatorios.");
  }

  const letraLimpia = letra.trim().toUpperCase();
  const nombreLimpio = nombre.trim();

  if (!/^[A-Z]$/.test(letraLimpia)) {
    throw new HttpError(
      400,
      "La letra debe ser una sola letra."
    );
  }

  if (nombreLimpio.length < 2 || nombreLimpio.length > 60) {
    throw new HttpError(
      400,
      "El nombre de la categoría debe tener entre 2 y 60 caracteres."
    );
  }

  const result = (
    await callProcedure("sp_categoria_crear", [
      letraLimpia,
      nombreLimpio,
    ])
  )[0];

  await audit(
    req.user.id_usuario,
    "CREAR",
    "rest_categoria",
    result.id_categoria,
    {
      letra: letraLimpia,
      nombre: nombreLimpio,
    }
  );

  res.status(201).json(result);
};

// ==========================================
// MENÚ
// ==========================================

// Listar productos del menú
exports.menu = async (req, res) => {
  res.json(
    await callProcedure("sp_menu_listar", [
      req.query.todos === "true" ? 0 : 1,
    ])
  );
};

// Crear producto
exports.crearMenu = async (req, res) => {
  const {
    codigo,
    id_categoria,
    nombre,
    descripcion = null,
    precio,
  } = req.body || {};

  const producto = await validarProducto(
    codigo,
    id_categoria,
    nombre,
    precio
  );

  let result;

  try {
    result = (
      await callProcedure("sp_menu_crear", [
        producto.codigo,
        producto.id_categoria,
        producto.nombre,
        descripcion,
        producto.precio,
      ])
    )[0];
  } catch (error) {
    manejarErrorDuplicado(error, producto.codigo);
  }

  await audit(
    req.user.id_usuario,
    "CREAR",
    "rest_item_menu",
    result.id_item,
    {
      codigo: producto.codigo,
      nombre: producto.nombre,
    }
  );

  res.status(201).json(result);
};

// Editar producto
exports.editarMenu = async (req, res) => {
  const {
    codigo,
    id_categoria,
    nombre,
    descripcion = null,
    precio,
  } = req.body || {};

  const producto = await validarProducto(
    codigo,
    id_categoria,
    nombre,
    precio
  );

  let result;

  try {
    result = await callProcedure("sp_menu_editar", [
      req.params.id,
      producto.codigo,
      producto.id_categoria,
      producto.nombre,
      descripcion,
      producto.precio,
    ]);
  } catch (error) {
    manejarErrorDuplicado(error, producto.codigo);
  }

  await audit(
    req.user.id_usuario,
    "EDITAR",
    "rest_item_menu",
    req.params.id,
    {
      codigo: producto.codigo,
      nombre: producto.nombre,
    }
  );

  res.json(result[0] || {
    mensaje: "Producto actualizado.",
  });
};

// Dar de baja producto
exports.eliminarMenu = async (req, res) => {
  const result = await callProcedure("sp_menu_baja", [
    req.params.id,
  ]);

  await audit(
    req.user.id_usuario,
    "BAJA",
    "rest_item_menu",
    req.params.id
  );

  res.json(result[0] || {
    mensaje: "Producto dado de baja.",
  });
};

// Cambiar disponibilidad
exports.cambiarDisponibilidad = async (req, res) => {
  const { disponible } = req.body || {};

  if (typeof disponible !== "boolean") {
    throw new HttpError(
      400,
      "Indicá si el producto está disponible."
    );
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

  res.json(result[0] || {
    mensaje: "Disponibilidad actualizada.",
  });
};

// Listar productos dados de baja
exports.menuBajas = async (req, res) => {
  res.json(await callProcedure("sp_menu_listar_bajas"));
};

// Reactivar producto
exports.reactivarMenu = async (req, res) => {
  const result = await callProcedure("sp_menu_reactivar", [
    req.params.id,
  ]);

  await audit(
    req.user.id_usuario,
    "REACTIVAR",
    "rest_item_menu",
    req.params.id
  );

  res.json(result[0] || {
    mensaje: "Producto reactivado.",
  });
};

// ==========================================
// MESAS
// ==========================================

// Listar mesas
exports.mesas = async (req, res) => {
  res.json(await callProcedure("sp_mesa_listar"));
};

// Crear mesa
exports.crearMesa = async (req, res) => {
  const {
    numero,
    capacidad,
    codigo_qr = null,
  } = req.body || {};

  if (
    numero === undefined ||
    numero === null ||
    numero === "" ||
    !Number.isInteger(Number(numero)) ||
    Number(numero) <= 0
  ) {
    throw new HttpError(
      400,
      "El número de mesa debe ser un entero positivo."
    );
  }

  if (
    capacidad === undefined ||
    capacidad === null ||
    capacidad === "" ||
    !Number.isInteger(Number(capacidad)) ||
    Number(capacidad) < 1
  ) {
    throw new HttpError(
      400,
      "La capacidad debe ser un entero mayor o igual a 1."
    );
  }

  const result = (
    await callProcedure("sp_mesa_crear", [
      Number(numero),
      Number(capacidad),
      codigo_qr,
    ])
  )[0];

  await audit(
    req.user.id_usuario,
    "CREAR",
    "rest_mesa",
    result.id_mesa,
    {
      numero: Number(numero),
    }
  );

  res.status(201).json(result);
};
// ==========================================
// AUMENTO DE PRECIOS POR PORCENTAJE
// ==========================================
// Los precios cambian cada 6 meses aprox. (relevamiento): en vez de
// editar plato por plato, se sube un % a todos o a una categoría.
// La fórmula y la transacción están en 99_aumento_precios.sql
// (fn_precio_aumentado): la vista previa y el aplicar usan la MISMA,
// así lo que el encargado ve es exactamente lo que se guarda.

const REDONDEOS = [1, 10, 50, 100];

// Lee y valida porcentaje, categoría y redondeo (de la URL o del body)
function datosAumento(origen) {
  const porcentaje = Number(origen.porcentaje);
  if (
    !Number.isFinite(porcentaje) ||
    porcentaje <= 0 ||
    porcentaje > 100 ||
    Math.round(porcentaje * 100) !== porcentaje * 100
  ) {
    throw new HttpError(
      400,
      "El porcentaje tiene que ser mayor que 0 y como máximo 100 (hasta 2 decimales)."
    );
  }

  // 0 = todas las categorías
  const categoria = Number(origen.categoria ?? 0);
  if (!Number.isInteger(categoria) || categoria < 0) {
    throw new HttpError(400, "Categoría inválida.");
  }

  const redondeo = Number(origen.redondeo ?? 1);
  if (!REDONDEOS.includes(redondeo)) {
    throw new HttpError(400, "El redondeo tiene que ser 1, 10, 50 o 100.");
  }

  return { porcentaje, categoria, redondeo };
}

// GET /api/menu/aumento?porcentaje=15&categoria=0&redondeo=100
// Vista previa: precio actual y nuevo de cada plato. NO cambia nada.
exports.vistaAumento = async (req, res) => {
  const d = datosAumento(req.query);
  res.json(
    await callProcedure("sp_menu_aumento_vista", [d.porcentaje, d.categoria, d.redondeo])
  );
};

// POST /api/menu/aumento   body: { porcentaje, categoria, redondeo }
// Aplica el aumento en una sola transacción (y queda en la auditoría).
exports.aplicarAumento = async (req, res) => {
  const d = datosAumento(req.body || {});
  const result = (
    await callProcedure("sp_menu_aumento_aplicar", [
      d.porcentaje,
      d.categoria,
      d.redondeo,
      req.user.id_usuario,
    ])
  )[0];

  res.json({
    platos_actualizados: Number(result.platos_actualizados),
    porcentaje: d.porcentaje,
    categoria: d.categoria,
    redondeo: d.redondeo,
  });
};