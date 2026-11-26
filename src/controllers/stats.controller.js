// ============================================================
// stats.controller.js – Estadísticas del restaurante (Incremento 3)
// ============================================================
// Los cálculos (qué cuenta como venta, sumas por forma de pago,
// agrupar por semana o mes) están en los procedimientos de
// 95_estadisticas.sql. Acá solo se valida que los datos tengan la
// forma correcta antes de mandarlos a la base.
//
// Son consultas de SOLO LECTURA: no se modifica nada, por eso no
// se graba auditoría.
//
// Los importes y cantidades llegan como texto ("17000.00"), igual
// que en caja: los convierte a número api.js en el frontend.
// ============================================================

const { callProcedure } = require("../config/db");
const HttpError = require("../utils/httpError");

// Formas de agrupar los ingresos (RF-EST-02).
const AGRUPACIONES = ["SEMANA", "MES"];

// (propuesta) Máximo de días por consulta: un año y un poco más.
// El mismo límite está en los procedimientos.
const MAX_DIAS = 400;

// Milisegundos que tiene un día (para calcular la diferencia de días).
const MS_POR_DIA = 24 * 60 * 60 * 1000;

// ------------------------------------------------------------
// Funciones de ayuda
// ------------------------------------------------------------

// Valida una fecha que viene en la URL (?desde=2026-11-23).
// Tiene que tener el formato AAAA-MM-DD y ser un día que exista
// (rechaza, por ejemplo, 2026-02-31).
// Se usa Date.UTC para que la zona horaria no corra el día.
// Devuelve la fecha como texto, que es lo que espera MariaDB.
function fechaValida(valor, nombre) {
  const t = String(valor ?? "").trim();

  if (t === "") {
    throw new HttpError(400, `Falta la fecha ${nombre}.`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    throw new HttpError(400, `Fecha ${nombre}: usá el formato AAAA-MM-DD.`);
  }

  const [anio, mes, dia] = t.split("-").map(Number);
  const f = new Date(Date.UTC(anio, mes - 1, dia));

  // Si el día no existe, JavaScript lo "corre" (31/02 → 03/03):
  // por eso se compara lo que quedó con lo que vino.
  if (
    f.getUTCFullYear() !== anio ||
    f.getUTCMonth() !== mes - 1 ||
    f.getUTCDate() !== dia
  ) {
    throw new HttpError(400, `Fecha ${nombre}: ese día no existe.`);
  }

  return t;
}

// Valida el período completo: las dos fechas, el orden y el largo.
function periodoValido(query) {
  const desde = fechaValida(query.desde, "desde");
  const hasta = fechaValida(query.hasta, "hasta");

  // Con el formato AAAA-MM-DD se pueden comparar como texto.
  if (desde > hasta) {
    throw new HttpError(400, "La fecha desde no puede ser posterior a la fecha hasta.");
  }

  const dias = (Date.parse(hasta) - Date.parse(desde)) / MS_POR_DIA;
  if (dias > MAX_DIAS) {
    throw new HttpError(400, "El período no puede ser mayor a un año.");
  }

  return { desde, hasta };
}

// Categoría opcional: si no viene (o viene vacía o 0) son todas.
// Devuelve 0 para "todas" (el procedimiento lo entiende así).
function categoriaValida(valor) {
  if (valor === undefined || valor === null || valor === "" || valor === "0") {
    return 0;
  }
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) {
    throw new HttpError(400, "La categoría es inválida.");
  }
  return n;
}

// ------------------------------------------------------------
// CONSULTAS
// ------------------------------------------------------------

// GET /api/estadisticas/platos?desde=2026-11-23&hasta=2026-11-29&categoria=1
// Ranking de platos vendidos en el período (RF-EST-01).
// Una fila por plato, del más vendido al menos vendido:
// { id_item, codigo, nombre, id_categoria, letra, categoria,
//   cantidad, importe, cantidad_sin_cargo }
exports.rankingPlatos = async (req, res) => {
  const { desde, hasta } = periodoValido(req.query);
  const categoria = categoriaValida(req.query.categoria);

  const r = await callProcedure("sp_est_platos", [desde, hasta, categoria]);
  res.json(r);
};

// GET /api/estadisticas/ingresos?desde=2026-11-01&hasta=2026-11-30&agrupar=SEMANA
// Ingresos por semana o por mes, por forma de pago (RF-EST-02).
// Una fila por período (solo los períodos que tuvieron cobros):
// { periodo, efectivo, transferencia, cargo_habitacion, total,
//   cantidad_cobros, cantidad_sin_cargo, valor_sin_cargo }
// periodo: "2026-11-23" (lunes de la semana) o "2026-11" (mes).
exports.ingresos = async (req, res) => {
  const { desde, hasta } = periodoValido(req.query);

  const agrupar = String(req.query.agrupar ?? "SEMANA").trim().toUpperCase();
  if (!AGRUPACIONES.includes(agrupar)) {
    throw new HttpError(400, "Agrupar tiene que ser SEMANA o MES.");
  }

  const r = await callProcedure("sp_est_ingresos", [desde, hasta, agrupar]);
  res.json(r);
};