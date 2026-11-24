const { callProcedure } = require("../config/db");
const HttpError = require("../utils/httpError");
const audit = require("../services/audit.service");

// =====================================================
// CREAR COMANDA Y PRIMER PEDIDO EN UNA SOLA TRANSACCION
// =====================================================
exports.pedidoInicial = async (req, res) => {
  const {
    id_mesa,
    personas,
    uid,
    origen = "SALON",
    items,
  } = req.body || {};

  const mesa = Number(id_mesa);
  const cantidadPersonas = Number(personas);

  if (!Number.isInteger(mesa) || mesa <= 0) {
    throw new HttpError(400, "Indicá una mesa válida.");
  }

  if (
    !Number.isInteger(cantidadPersonas) ||
    cantidadPersonas < 1 ||
    cantidadPersonas > 20
  ) {
    throw new HttpError(
      400,
      "La cantidad de personas debe estar entre 1 y 20."
    );
  }

  if (typeof uid !== "string" || !uid.trim()) {
    throw new HttpError(400, "El UID del pedido es obligatorio.");
  }

  if (!["SALON", "MOSTRADOR"].includes(origen)) {
    throw new HttpError(400, "El origen del pedido no es válido.");
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, "El pedido debe contener artículos.");
  }

  for (const item of items) {
    if (
      !Number.isInteger(Number(item.id_item)) ||
      Number(item.id_item) <= 0
    ) {
      throw new HttpError(400, "Artículo inválido.");
    }

    if (
      !Number.isInteger(Number(item.cantidad)) ||
      Number(item.cantidad) < 1 ||
      Number(item.cantidad) > 50
    ) {
      throw new HttpError(
        400,
        "Cada cantidad debe estar entre 1 y 50."
      );
    }

    if (
      item.observaciones != null &&
      String(item.observaciones).length > 100
    ) {
      throw new HttpError(
        400,
        "Las observaciones no pueden superar los 100 caracteres."
      );
    }
  }

  const r = await callProcedure("sp_comanda_pedido_inicial", [
    mesa,
    req.user.id_usuario,
    cantidadPersonas,
    uid.trim(),
    origen,
    req.user.id_usuario,
    JSON.stringify(items),
  ]);

  await audit(
    req.user.id_usuario,
    "COMANDA_PRIMER_PEDIDO",
    "rest_comanda",
    r[0].id_comanda,
    {
      id_mesa: mesa,
      id_pedido: r[0].id_pedido,
    }
  );

  res.status(201).json({
    mensaje: "Comanda y primer pedido creados correctamente.",
    ...r[0],
  });
};

// =====================================================
// ABRIR COMANDA
// =====================================================
exports.abrirComanda = async (req, res) => {
  const { id_mesa, personas } = req.body || {};

  if (!Number.isInteger(Number(id_mesa)) || Number(id_mesa) <= 0) {
    throw new HttpError(400, "Indicá una mesa válida.");
  }

  if (
    !Number.isInteger(Number(personas)) ||
    Number(personas) < 1 ||
    Number(personas) > 20
  ) {
    throw new HttpError(
      400,
      "La cantidad de personas debe estar entre 1 y 20."
    );
  }

  const r = await callProcedure("sp_comanda_abrir", [
    Number(id_mesa),
    req.user.id_usuario,
    Number(personas),
  ]);

  await audit(
    req.user.id_usuario,
    "ABRIR",
    "rest_comanda",
    r[0].id_comanda,
    { id_mesa, personas }
  );

  res.status(201).json(r[0]);
};

// =====================================================
// LISTAR COMANDAS ABIERTAS
// =====================================================
exports.comandasAbiertas = async (req, res) => {
  const r = await callProcedure("sp_comandas_abiertas");
  res.json(r);
};

// =====================================================
// CREAR PEDIDO EN COMANDA EXISTENTE
// =====================================================
exports.crearPedido = async (req, res) => {
  const { uid, origen = "SALON", items } = req.body || {};
  const idComanda = Number(req.params.id);

  if (!Number.isInteger(idComanda) || idComanda <= 0) {
    throw new HttpError(400, "Comanda inválida.");
  }

  if (
    typeof uid !== "string" ||
    !uid.trim() ||
    !Array.isArray(items) ||
    items.length === 0
  ) {
    throw new HttpError(400, "UID e ítems del pedido son obligatorios.");
  }

  if (!["SALON", "MOSTRADOR"].includes(origen)) {
    throw new HttpError(400, "El origen del pedido no es válido.");
  }

  for (const item of items) {
    if (
      !Number.isInteger(Number(item.id_item)) ||
      Number(item.id_item) <= 0
    ) {
      throw new HttpError(400, "Cada artículo debe tener un ID válido.");
    }

    if (
      !Number.isInteger(Number(item.cantidad)) ||
      Number(item.cantidad) < 1 ||
      Number(item.cantidad) > 50
    ) {
      throw new HttpError(
        400,
        "Cada cantidad debe estar entre 1 y 50."
      );
    }

    if (
      item.observaciones != null &&
      String(item.observaciones).length > 100
    ) {
      throw new HttpError(
        400,
        "Las observaciones no pueden superar los 100 caracteres."
      );
    }
  }

  const r = await callProcedure("sp_pedido_crear", [
    idComanda,
    uid.trim(),
    origen,
    req.user.id_usuario,
    JSON.stringify(items),
  ]);

  await audit(
    req.user.id_usuario,
    "CREAR",
    "rest_pedido",
    r[0].id_pedido,
    { id_comanda: idComanda, uid }
  );

  res.status(201).json(r[0]);
};

// =====================================================
// CAMBIAR ESTADO DE PEDIDO
// =====================================================
exports.estadoPedido = async (req, res) => {
  const { estado } = req.body || {};
  const idPedido = Number(req.params.id);

  if (!Number.isInteger(idPedido) || idPedido <= 0) {
    throw new HttpError(400, "Pedido inválido.");
  }

  if (!["ENVIADO", "CANCELADO"].includes(estado)) {
    throw new HttpError(
      400,
      "Para marcar como listo utilizá la ruta específica. Estado inválido."
    );
  }

  const r = await callProcedure("sp_pedido_estado", [
    idPedido,
    estado,
  ]);

  if (!Number(r[0]?.afectados)) {
    throw new HttpError(
      404,
      "Pedido no encontrado o no se pudo actualizar."
    );
  }

  await audit(
    req.user.id_usuario,
    "CAMBIAR_ESTADO",
    "rest_pedido",
    idPedido,
    { estado }
  );

  res.json({ mensaje: "Estado actualizado correctamente." });
};

// =====================================================
// DETALLE DE UN PEDIDO
// =====================================================
exports.detallePedido = async (req, res) => {
  const idPedido = Number(req.params.id);

  if (!Number.isInteger(idPedido) || idPedido <= 0) {
    throw new HttpError(400, "Pedido inválido.");
  }

  const r = await callProcedure("sp_pedido_detalle", [idPedido]);

  if (!r.length) {
    throw new HttpError(404, "Pedido no encontrado.");
  }

  res.json(r);
};

// =====================================================
// LISTAR PEDIDOS PENDIENTES DE COCINA
// =====================================================
exports.pedidosCocina = async (req, res) => {
  const r = await callProcedure("sp_cocina_pedidos");
  res.json(r);
};

// =====================================================
// MARCAR PEDIDO COMO LISTO
// =====================================================
exports.marcarListo = async (req, res) => {
  const idPedido = Number(req.params.id);

  if (!Number.isInteger(idPedido) || idPedido <= 0) {
    throw new HttpError(400, "Pedido inválido.");
  }

  const r = await callProcedure("sp_pedido_marcar_listo", [
    idPedido,
  ]);

  if (!Number(r[0]?.afectados)) {
    throw new HttpError(
      409,
      "El pedido ya no está pendiente o no existe."
    );
  }

  await audit(
    req.user.id_usuario,
    "MARCAR_LISTO",
    "rest_pedido",
    idPedido
  );

  res.json({ mensaje: "Pedido marcado como listo." });
};

// =====================================================
// SOLICITAR CUENTA
// =====================================================
exports.pedirCuenta = async (req, res) => {
  const idComanda = Number(req.params.id);

  if (!Number.isInteger(idComanda) || idComanda <= 0) {
    throw new HttpError(400, "Comanda inválida.");
  }

  const r = await callProcedure("sp_comanda_pedir_cuenta", [
    idComanda,
  ]);

  if (!Number(r[0]?.afectados)) {
    throw new HttpError(
      409,
      "La comanda no existe, está cerrada o ya tiene la cuenta solicitada."
    );
  }

  await audit(
    req.user.id_usuario,
    "PEDIR_CUENTA",
    "rest_comanda",
    idComanda
  );

  res.json({ mensaje: "Cuenta solicitada correctamente." });
};

// =====================================================
// CONSULTAR PEDIDOS DE UNA MESA
// =====================================================
exports.pedidosMesa = async (req, res) => {
  const idMesa = Number(req.params.id);

  if (!Number.isInteger(idMesa) || idMesa <= 0) {
    throw new HttpError(400, "Mesa inválida.");
  }

  const r = await callProcedure("sp_mesa_pedidos", [
    idMesa,
  ]);

  res.json(r);
};