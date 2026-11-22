const { callProcedure } = require("../config/db");
const HttpError = require("../utils/httpError");
const audit = require("../services/audit.service");
exports.huespedes = async (req, res) =>
  res.json(await callProcedure("sp_huesped_listar"));
exports.crearHuesped = async (req, res) => {
  const { nombre, apellido, dni } = req.body || {};
  if (!nombre || !apellido || !dni)
    throw new HttpError(400, "Nombre, apellido y DNI son obligatorios.");
  const r = await callProcedure("sp_huesped_crear", [nombre, apellido, dni]);
  await audit(req.user.id_usuario, "CREAR", "huesped", r[0].id_huesped, {
    dni,
  });
  res.status(201).json(r[0]);
};
exports.estadias = async (req, res) =>
  res.json(await callProcedure("sp_estadias_listar"));
exports.crearEstadia = async (req, res) => {
  const { id_huesped, nro_habitacion, ingreso, egreso = null } = req.body || {};
  if (!id_huesped || !nro_habitacion || !ingreso)
    throw new HttpError(400, "Huésped, habitación e ingreso son obligatorios.");
  const r = await callProcedure("sp_estadia_crear", [
    id_huesped,
    nro_habitacion,
    ingreso,
    egreso,
  ]);
  await audit(req.user.id_usuario, "CREAR", "estadia", r[0].id_estadia, {
    nro_habitacion,
  });
  res.status(201).json(r[0]);
};
