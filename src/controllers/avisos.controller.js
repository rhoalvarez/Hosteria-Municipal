// ============================================================
// avisos.controller.js – Avisos para el mozo (RF-PED-05)
// ============================================================
// Pedidos que cocina marcó LISTO y todavía no se cobraron (la mesa
// sigue abierta). La pantalla de Mesas los pide cada 5 segundos,
// junto con las mesas, y avisa al mozo para que los lleve.
// "Ya lo llevé" se guarda en el celular de cada mozo: la ERS no
// tiene un estado "entregado", así que la base no cambia.
// Solo lectura: no se graba auditoría.
// ============================================================

const { callProcedure } = require("../config/db");

// GET /api/avisos/pedidos-listos
// [{ id_pedido, listo, id_mesa, mesa_numero, mozo }]
exports.pedidosListos = async (req, res) => {
  res.json(await callProcedure("sp_pedidos_listos"));
};