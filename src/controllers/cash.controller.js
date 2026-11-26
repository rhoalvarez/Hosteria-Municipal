// ============================================================
// cash.controller.js – Caja del restaurante (Incremento 3)
// ============================================================
// Las reglas de negocio (sumas, saldos, arqueo, auditoría del sin cargo
// y de la reapertura) están en los procedimientos de 90_caja.sql y
// 98_cargo_comprobante.sql.
// Acá solo se valida que los datos tengan la forma correcta antes de
// mandarlos a la base, y se arma la respuesta para el frontend.
// ============================================================

// fs, path y crypto vienen con Node.js: no son librerías nuevas
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const { callProcedure } = require("../config/db");
const HttpError = require("../utils/httpError");
const audit = require("../services/audit.service");

// Formas de los movimientos MANUALES (gastos, proveedores, ajustes):
// solo lo que entra o sale del cajón o de la cuenta.
const FORMAS_PAGO = ["EFECTIVO", "TRANSFERENCIA"];

// Formas para COBRAR una mesa: además, cargo a habitación (RF-HAB).
// El cargo no entra a la caja: lo cobra recepción cuando el huésped se va.
const FORMAS_COBRO = ["EFECTIVO", "TRANSFERENCIA", "CARGO_HABITACION"];

// ---------- Fotos de los comprobantes de transferencia (RF-CAJ-13/14) ----------
// Se guardan en la carpeta uploads/comprobantes del servidor (fuera de
// frontend/, así NO se pueden abrir con una dirección sin iniciar sesión).
// La base guarda solo el nombre del archivo.
// Este archivo está en src/controllers: se suben dos niveles hasta la raíz.
const CARPETA_COMPROBANTES = path.join(__dirname, "..", "..", "uploads", "comprobantes");

// La pantalla achica la foto antes de mandarla (unos 200 KB).
// 700 KB de margen. express.json acepta hasta 1 MB (app.js).
const MAX_BYTES_COMPROBANTE = 700 * 1024;

// Nombre que arma el servidor: "1764190000000-ab12cd34ef56ab12.jpg"
// (fecha en milisegundos + 16 letras al azar). Si un nombre no tiene
// EXACTAMENTE este formato, se rechaza: así nadie puede pedir
// "../../.env" u otro archivo del servidor.
const FORMATO_ARCHIVO = /^\d{13}-[a-f0-9]{16}\.(jpg|png)$/;

// Máximo de formas de pago en un mismo cobro (pago dividido).
const MAX_PAGOS = 4;

// ------------------------------------------------------------
// Funciones de ayuda
// ------------------------------------------------------------

// Valida un id que viene en la URL (/turnos/:id). Tiene que ser entero > 0.
function idValido(valor, nombre = "id") {
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) {
    throw new HttpError(400, `El ${nombre} es inválido.`);
  }
  return n;
}

// Valida un importe: número, con dos decimales como máximo (como
// DECIMAL(10,2)). Por defecto acepta 0 (por ejemplo, el saldo inicial);
// con { mayorQueCero: true } exige que sea mayor que 0 (los pagos).
function importeValido(valor, nombre, { mayorQueCero = false } = {}) {
  const n = Number(valor);
  if (valor === undefined || valor === null || valor === "" || !Number.isFinite(n)) {
    throw new HttpError(400, `${nombre}: tiene que ser un número.`);
  }
  if (mayorQueCero && n <= 0) {
    throw new HttpError(400, `${nombre}: tiene que ser mayor que cero.`);
  }
  if (!mayorQueCero && n < 0) {
    throw new HttpError(400, `${nombre}: no puede ser negativo.`);
  }
  if (Math.round(n * 100) !== n * 100) {
    throw new HttpError(400, `${nombre}: como máximo dos decimales.`);
  }
  if (n > 99999999.99) {
    throw new HttpError(400, `${nombre}: el importe es demasiado grande.`);
  }
  return n;
}

// Limpia un texto opcional. Devuelve '' si no vino (NUNCA null:
// los procedimientos convierten '' en NULL con NULLIF, y así evitamos
// el problema del texto 'null' que tuvimos con las observaciones).
function texto(valor, max, nombre) {
  if (valor === undefined || valor === null) return "";
  const t = String(valor).trim();
  if (t.length > max) {
    throw new HttpError(400, `${nombre}: máximo ${max} caracteres.`);
  }
  return t;
}

// Graba la auditoría sin romper la respuesta. Si el cobro ya se guardó
// y la auditoría falla, NO hay que devolver error: el frontend pensaría
// que el cobro falló y lo intentaría de nuevo.
async function auditarSinFallar(...datos) {
  try {
    await audit(...datos);
  } catch (err) {
    console.error("No se pudo registrar la auditoría:", err.message);
  }
}

// ------------------------------------------------------------
// CONSULTAS
// ------------------------------------------------------------

// GET /api/caja/turno-actual
// Responde { abierto: false, turno: null } si no hay caja abierta.
exports.turnoActual = async (req, res) => {
  const r = await callProcedure("sp_caja_turno_actual");
  const turno = r[0] || null;
  res.json({ abierto: turno !== null, turno });
};

// GET /api/caja/turnos?cantidad=30  (historial, del más nuevo al más viejo)
exports.listarTurnos = async (req, res) => {
  let cantidad = Number(req.query.cantidad ?? 30);
  if (!Number.isInteger(cantidad) || cantidad <= 0) cantidad = 30;
  if (cantidad > 100) cantidad = 100;

  const r = await callProcedure("sp_caja_turnos_listar", [cantidad]);
  res.json(r);
};

// GET /api/caja/turnos/:id  (resumen de un turno, abierto o cerrado)
exports.resumenTurno = async (req, res) => {
  const id = idValido(req.params.id, "turno");
  const r = await callProcedure("sp_caja_resumen", [id]);
  if (!r[0]) throw new HttpError(404, "El turno de caja no existe.");
  res.json(r[0]);
};

// GET /api/caja/turnos/:id/movimientos
exports.movimientosTurno = async (req, res) => {
  const id = idValido(req.params.id, "turno");
  const r = await callProcedure("sp_caja_movimientos", [id]);
  res.json(r);
};

// GET /api/caja/codigos  (para el combo de movimientos manuales)
exports.codigosCaja = async (req, res) => {
  const r = await callProcedure("sp_caja_codigos");
  res.json(r);
};

// ------------------------------------------------------------
// APERTURA, CIERRE Y REAPERTURA
// ------------------------------------------------------------

// Turnos de caja (RF-CAJ-10, a confirmar con la hostería).
// Sin Ñ a propósito: la pantalla muestra "Mañana".
const TURNOS = ["MANANA", "TARDE", "NOCHE"];

// POST /api/caja/turnos/apertura   body: { saldo_inicial, turno }
// Usa sp_caja_abrir_turno (99b): igual que antes + el turno elegido.
exports.abrirCaja = async (req, res) => {
  const saldo = importeValido(req.body?.saldo_inicial ?? 0, "Saldo inicial");
  const turno = String(req.body?.turno ?? "").trim().toUpperCase();
  if (!TURNOS.includes(turno)) {
    throw new HttpError(400, "Elegí el turno: mañana, tarde o noche.");
  }

  const r = await callProcedure("sp_caja_abrir_turno", [req.user.id_usuario, saldo, turno]);

  await auditarSinFallar(
    req.user.id_usuario,
    "ABRIR",
    "rest_turno_caja",
    r[0].id_turno_caja,
    { saldo_inicial: saldo, turno }
  );

  res.status(201).json(r[0]);
};

// POST /api/caja/turnos/:id/cierre   body: { efectivo_contado, observaciones }
// Devuelve el resumen completo del turno (esperado, contado, diferencia,
// transferencias) para mostrar el arqueo.
exports.cerrarCaja = async (req, res) => {
  const id = idValido(req.params.id, "turno");
  const contado = importeValido(req.body?.efectivo_contado, "Efectivo contado");
  const observaciones = texto(req.body?.observaciones, 1000, "Observaciones");

  const r = await callProcedure("sp_caja_cerrar", [
    id,
    req.user.id_usuario,
    contado,
    observaciones,
  ]);

  await auditarSinFallar(
    req.user.id_usuario,
    "CERRAR",
    "rest_turno_caja",
    id,
    { efectivo_contado: contado, diferencia: r[0]?.diferencia }
  );

  res.json(r[0]);
};

// POST /api/caja/turnos/:id/reapertura   body: { motivo }
// La auditoría la graba el procedimiento (con lo que decía el cierre).
exports.reabrirCaja = async (req, res) => {
  const id = idValido(req.params.id, "turno");
  const motivo = texto(req.body?.motivo, 255, "Motivo");

  if (motivo.length < 5) {
    throw new HttpError(400, "Para reabrir la caja hay que escribir el motivo.");
  }

  const r = await callProcedure("sp_caja_reabrir", [id, req.user.id_usuario, motivo]);
  res.json(r[0]);
};

// ------------------------------------------------------------
// COBRO DE UNA COMANDA
// ------------------------------------------------------------

// POST /api/caja/comandas/:id/cobros
// body:
// {
//   "total": 11500,
//   "pagos": [
//     { "forma": "EFECTIVO", "importe": 3500 },
//     { "forma": "TRANSFERENCIA", "importe": 8000, "medio_transferencia": "Mercado Pago" }
//   ],
//   "sin_cargo": false,
//   "motivo_sin_cargo": ""
// }
// El turno NO se manda: la base usa el turno abierto.
// El total se manda para comprobar que la cuenta no cambió mientras se cobraba.
exports.cobrarComanda = async (req, res) => {
  const idComanda = idValido(req.params.id, "número de comanda");
  const body = req.body || {};

  const total = importeValido(body.total, "Total");
  const sinCargo = body.sin_cargo ?? false;

  if (typeof sinCargo !== "boolean") {
    throw new HttpError(400, "El campo sin_cargo debe ser verdadero o falso.");
  }

  const motivo = texto(body.motivo_sin_cargo, 255, "Motivo del sin cargo");
  let pagos = [];

  if (sinCargo) {
    if (motivo === "") {
      throw new HttpError(400, "Un cobro sin cargo requiere motivo.");
    }
    // Sin cargo: no entra plata, no se mandan pagos.
  } else {
    if (!Array.isArray(body.pagos)) {
      throw new HttpError(400, "Falta la lista de pagos.");
    }
    if (total > 0 && body.pagos.length === 0) {
      throw new HttpError(400, "Falta indicar la forma de pago.");
    }
    if (body.pagos.length > MAX_PAGOS) {
      throw new HttpError(400, `Como máximo ${MAX_PAGOS} formas de pago por cobro.`);
    }

    // Se arma cada pago con los campos exactos que espera el procedimiento.
    pagos = [];
    for (const [i, p] of body.pagos.entries()) {
      const forma = String(p?.forma ?? "").trim().toUpperCase();

      if (!FORMAS_COBRO.includes(forma)) {
        throw new HttpError(400, `Pago ${i + 1}: forma de pago no permitida.`);
      }

      const importe = importeValido(p.importe, `Pago ${i + 1}`, { mayorQueCero: true });
      const medio = texto(p.medio_transferencia, 50, `Pago ${i + 1}: medio`);

      if (forma === "TRANSFERENCIA" && medio === "") {
        throw new HttpError(400, `Pago ${i + 1}: indicá el medio de la transferencia.`);
      }

      // Cargo a habitación: qué huésped (la base controla que siga alojado)
      let idEstadia = 0;
      if (forma === "CARGO_HABITACION") {
        idEstadia = Number(p.id_estadia);
        if (!Number.isInteger(idEstadia) || idEstadia <= 0) {
          throw new HttpError(400, `Pago ${i + 1}: elegí la habitación del huésped.`);
        }
      }

      // Foto del comprobante: opcional, solo en transferencias.
      // Tiene que ser un archivo que subió ESTE servidor.
      let comprobante = "";
      if (forma === "TRANSFERENCIA") {
        comprobante = texto(p.comprobante, 40, `Pago ${i + 1}: comprobante`);
        if (comprobante !== "" && !(await existeComprobante(comprobante))) {
          throw new HttpError(400, `Pago ${i + 1}: la foto del comprobante no se encontró. Volvé a sacarla.`);
        }
      }

      // Nunca mandamos null al procedimiento: '' y 0 (ver texto()).
      pagos.push({
        forma,
        importe,
        medio_transferencia: forma === "TRANSFERENCIA" ? medio : "",
        id_estadia: idEstadia,
        comprobante,
      });
    }

    // Control previo (el procedimiento lo vuelve a controlar).
    // Se suma en centavos para evitar errores de redondeo de JavaScript
    // (por ejemplo 0.1 + 0.2 = 0.30000000000000004).
    const sumaCentavos = pagos.reduce((s, p) => s + Math.round(p.importe * 100), 0);
    if (sumaCentavos !== Math.round(total * 100)) {
      throw new HttpError(400, "La suma de los pagos no coincide con el total.");
    }
  }

  const r = await callProcedure("sp_cobro_registrar", [
    idComanda,
    req.user.id_usuario,
    total,
    JSON.stringify(pagos),
    sinCargo ? 1 : 0,
    motivo,
  ]);

  // El sin cargo ya quedó auditado dentro del procedimiento.
  if (!sinCargo) {
    await auditarSinFallar(
      req.user.id_usuario,
      "COBRAR",
      "rest_cobro",
      r[0].id_cobro,
      { id_comanda: idComanda, total, pagos }
    );
  }

  res.status(201).json(r[0]);
};

// ------------------------------------------------------------
// MOVIMIENTO MANUAL (gastos, proveedores, ajustes)
// ------------------------------------------------------------

// POST /api/caja/movimientos
// body: { codigo, forma, medio_transferencia, importe, concepto,
//         tipo_comprobante, nro_comprobante, dni_cuit,
//         huesped_proveedor, detalle }
// Si suma o resta lo decide el TIPO del código (INGRESO / EGRESO).
exports.registrarMovimiento = async (req, res) => {
  const b = req.body || {};

  const codigo = texto(b.codigo, 20, "Código").toUpperCase();
  if (codigo === "") throw new HttpError(400, "Elegí el código de caja.");
  if (codigo === "COBRO") {
    throw new HttpError(400, "Los cobros se registran desde la mesa, no como movimiento manual.");
  }

  const forma = texto(b.forma ?? "EFECTIVO", 30, "Forma").toUpperCase();
  if (!FORMAS_PAGO.includes(forma)) {
    throw new HttpError(400, "Forma de pago no permitida.");
  }

  const medio = texto(b.medio_transferencia, 50, "Medio de transferencia");
  if (forma === "TRANSFERENCIA" && medio === "") {
    throw new HttpError(400, "Indicá el medio de la transferencia.");
  }

  const importe = importeValido(b.importe, "Importe", { mayorQueCero: true });

  const r = await callProcedure("sp_movimiento_registrar", [
    req.user.id_usuario,
    codigo,
    forma,
    medio,
    importe,
    texto(b.concepto, 100, "Concepto"),
    texto(b.tipo_comprobante, 30, "Tipo de comprobante"),
    texto(b.nro_comprobante, 50, "Número de comprobante"),
    texto(b.dni_cuit, 20, "DNI/CUIT"),
    texto(b.huesped_proveedor, 150, "Huésped/proveedor"),
    texto(b.detalle, 1000, "Detalle"),
  ]);

  await auditarSinFallar(
    req.user.id_usuario,
    "MOVIMIENTO",
    "rest_movimiento_caja",
    r[0].id_movimiento,
    { codigo, forma, importe }
  );

  res.status(201).json(r[0]);
};
// ------------------------------------------------------------
// CARGO A HABITACIÓN (RF-HAB)
// ------------------------------------------------------------

// GET /api/caja/estadias-activas
// Huéspedes alojados ahora, para el combo del cobro.
// Sale de la vista v_rest_estadias_activas: es lo ÚNICO que hay que
// cambiar para conectarlo con las tablas del sistema de reservas.
exports.estadiasActivas = async (req, res) => {
  const r = await callProcedure("sp_estadias_activas");
  res.json(r);
};

// ------------------------------------------------------------
// FOTO DEL COMPROBANTE DE TRANSFERENCIA (RF-CAJ-13/14)
// ------------------------------------------------------------
// Cómo funciona:
//  1. El encargado saca la foto con el celular al cobrar. La pantalla
//     la achica y la manda como texto (base64) en el JSON: así no hace
//     falta ninguna librería para recibir archivos.
//  2. El servidor controla que sea de verdad una imagen JPG o PNG
//     (mira los primeros bytes, no solo lo que dice el texto), le pone
//     un nombre al azar y la guarda en uploads/comprobantes.
//  3. Devuelve el nombre; la pantalla lo manda junto con el cobro y
//     queda en rest_cobro_pago.foto_comprobante.

// ¿El nombre tiene el formato correcto y el archivo existe?
async function existeComprobante(archivo) {
  if (!FORMATO_ARCHIVO.test(archivo)) return false;
  try {
    await fs.access(path.join(CARPETA_COMPROBANTES, archivo));
    return true;
  } catch {
    return false;
  }
}

// POST /api/caja/comprobantes   body: { imagen: "data:image/jpeg;base64,..." }
// Responde { archivo: "1764190000000-ab12cd34ef56ab12.jpg" }
exports.subirComprobante = async (req, res) => {
  const imagen = req.body?.imagen;
  if (typeof imagen !== "string") {
    throw new HttpError(400, "Falta la foto del comprobante.");
  }

  const partes = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(imagen);
  if (!partes) {
    throw new HttpError(400, "La foto tiene que ser JPG o PNG.");
  }

  const datos = Buffer.from(partes[2], "base64");
  if (datos.length === 0) {
    throw new HttpError(400, "La foto está vacía.");
  }
  if (datos.length > MAX_BYTES_COMPROBANTE) {
    throw new HttpError(413, "La foto es demasiado grande.");
  }

  // "Firma" del archivo: los primeros bytes de un JPG son FF D8 FF y
  // los de un PNG 89 50 4E 47. Así no se guarda cualquier cosa
  // disfrazada de imagen.
  const esJpg = datos[0] === 0xff && datos[1] === 0xd8 && datos[2] === 0xff;
  const esPng = datos.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if ((partes[1] === "jpeg" && !esJpg) || (partes[1] === "png" && !esPng)) {
    throw new HttpError(400, "El archivo no es una imagen válida.");
  }

  // Nombre al azar: nunca se usa el nombre que manda el navegador
  const archivo = Date.now() + "-" + crypto.randomBytes(8).toString("hex") + (esJpg ? ".jpg" : ".png");

  await fs.mkdir(CARPETA_COMPROBANTES, { recursive: true });
  // flag "wx": si por casualidad ya existe un archivo con ese nombre, falla en vez de pisarlo
  await fs.writeFile(path.join(CARPETA_COMPROBANTES, archivo), datos, { flag: "wx" });

  await auditarSinFallar(req.user.id_usuario, "SUBIR_COMPROBANTE", "rest_cobro_pago", null, { archivo });

  res.status(201).json({ archivo });
};

// GET /api/caja/comprobantes/:archivo  → la imagen (solo ENCARGADO, con token)
exports.verComprobante = async (req, res) => {
  const archivo = String(req.params.archivo || "");
  if (!FORMATO_ARCHIVO.test(archivo)) {
    throw new HttpError(400, "Nombre de comprobante inválido.");
  }
  if (!(await existeComprobante(archivo))) {
    throw new HttpError(404, "No se encontró la foto del comprobante.");
  }
  // Que el navegador no la guarde en caché: es un dato privado
  res.set("Cache-Control", "private, no-store");
  res.sendFile(path.join(CARPETA_COMPROBANTES, archivo));
};