const { callProcedure } = require("../config/db");
const HttpError = require("../utils/httpError");
const audit = require("../services/audit.service");
exports.abrirCaja = async (req, res) => {
  const saldo = Number(req.body?.saldo_inicial ?? 0);
  if (!Number.isFinite(saldo) || saldo < 0)
    throw new HttpError(400, "Saldo inicial inválido.");
  const r = await callProcedure("sp_caja_abrir", [req.user.id_usuario, saldo]);
  await audit(
    req.user.id_usuario,
    "ABRIR",
    "rest_turno_caja",
    r[0].id_turno_caja,
    { saldo_inicial: saldo },
  );
  res.status(201).json(r[0]);
};
exports.cerrarCaja = async (req, res) => {
  const { efectivo_contado, observaciones = null } = req.body || {};
  if (efectivo_contado === undefined || Number(efectivo_contado) < 0)
    throw new HttpError(400, "Efectivo contado inválido.");
  const r = await callProcedure("sp_caja_cerrar", [
    req.params.id,
    req.user.id_usuario,
    efectivo_contado,
    observaciones,
  ]);
  await audit(req.user.id_usuario, "CERRAR", "rest_turno_caja", req.params.id, {
    efectivo_contado,
  });
  res.json(r[0]);
};
exports.cobrarComanda = async (req, res) => {
  const {
    id_turno_caja,
    total,
    forma = "EFECTIVO",
    importe,
    sin_cargo = false,
    id_autoriza = null,
    motivo_sin_cargo = null,
  } = req.body || {};
  if (!id_turno_caja || total === undefined)
    throw new HttpError(400, "Turno de caja y total son obligatorios.");
  const r = await callProcedure("sp_cobro_registrar", [
    req.params.id,
    id_turno_caja,
    req.user.id_usuario,
    total,
    forma,
    importe ?? total,
    sin_cargo ? 1 : 0,
    id_autoriza,
    motivo_sin_cargo,
  ]);
  await audit(req.user.id_usuario, "COBRAR", "rest_cobro", r[0].id_cobro, {
    id_comanda: req.params.id,
    total,
  });
  res.status(201).json(r[0]);
};
