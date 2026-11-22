const { callProcedure } = require("../config/db");
const HttpError = require("../utils/httpError");
const audit = require("../services/audit.service");
exports.abrirComanda = async (req, res) => {
  const { numero, id_mesa, personas } = req.body || {};
  if (!numero || !id_mesa || !personas)
    throw new HttpError(
      400,
      "Número, mesa y cantidad de personas son obligatorios.",
    );
  const r = await callProcedure("sp_comanda_abrir", [
    numero,
    id_mesa,
    req.user.id_usuario,
    personas,
  ]);
  await audit(req.user.id_usuario, "ABRIR", "rest_comanda", r[0].id_comanda, {
    numero,
    id_mesa,
  });
  res.status(201).json(r[0]);
};
exports.comandasAbiertas = async (req, res) =>
  res.json(await callProcedure("sp_comandas_abiertas"));
exports.crearPedido = async (req, res) => {
  const { uid, origen = "SALON", items } = req.body || {};
  if (!uid || !Array.isArray(items) || !items.length)
    throw new HttpError(400, "UID e ítems del pedido son obligatorios.");
  const r = await callProcedure("sp_pedido_crear", [
    req.params.id,
    uid,
    origen,
    req.user.id_usuario,
    JSON.stringify(items),
  ]);
  await audit(req.user.id_usuario, "CREAR", "rest_pedido", r[0].id_pedido, {
    id_comanda: req.params.id,
    uid,
  });
  res.status(201).json(r[0]);
};
exports.estadoPedido = async (req, res) => {
  const { estado } = req.body || {};
  if (!estado) throw new HttpError(400, "Indicá el estado.");
  const r = await callProcedure("sp_pedido_estado", [req.params.id, estado]);
  if (!Number(r[0].afectados))
    throw new HttpError(404, "Pedido no encontrado.");
  await audit(
    req.user.id_usuario,
    "CAMBIAR_ESTADO",
    "rest_pedido",
    req.params.id,
    { estado },
  );
  res.json({ mensaje: "Estado actualizado." });
};
exports.detallePedido = async (req, res) => {
  const r = await callProcedure("sp_pedido_detalle", [req.params.id]);
  if (!r.length) throw new HttpError(404, "Pedido no encontrado.");
  res.json(r);
};
