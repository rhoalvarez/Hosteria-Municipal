const crypto = require("crypto");
const { pool, callProcedure } = require("../config/db");
const HttpError = require("../utils/httpError");
const audit = require("../services/audit.service");

// =====================================================
// VALIDACIONES GENERALES
// =====================================================

function validarId(valor, mensaje = "ID inválido.") {
  const id = Number(valor);

  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, mensaje);
  }

  return id;
}

function validarItems(items) {
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
}

/* Prepara los ítems para mandarlos a los procedimientos.
   Copia solo los campos que usan (id_item, cantidad, observaciones)
   y convierte las observaciones vacías o null en ''.
   Por qué: si el JSON lleva "observaciones": null, en MariaDB
   JSON_UNQUOTE(JSON_EXTRACT(...)) devuelve el TEXTO 'null', y en la
   cocina aparecía la aclaración "⚠ null". */
function itemsParaProcedimiento(items) {
  return items.map((item) => ({
    id_item: Number(item.id_item),
    cantidad: Number(item.cantidad),
    observaciones:
      item.observaciones == null
        ? ""
        : String(item.observaciones).trim(),
  }));
}

// =====================================================
// CREAR COMANDA Y PRIMER PEDIDO
// =====================================================

exports.pedidoInicial = async (req, res) => {
  const {
    id_mesa,
    personas,
    uid,
    origen = "SALON",
    items,
  } = req.body || {};

  const mesa = validarId(id_mesa, "Indicá una mesa válida.");
  const cantidadPersonas = Number(personas);

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

  if (!["SALON", "MOSTRADOR", "QR"].includes(origen)) {
    throw new HttpError(400, "El origen del pedido no es válido.");
  }

  validarItems(items);

  const r = await callProcedure("sp_comanda_pedido_inicial", [
    mesa,
    req.user.id_usuario,
    cantidadPersonas,
    uid.trim(),
    origen,
    req.user.id_usuario,
    JSON.stringify(itemsParaProcedimiento(items)),
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

  const mesa = validarId(id_mesa, "Indicá una mesa válida.");
  const cantidadPersonas = Number(personas);

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

  const [numeroRows] = await pool.query(
    "SELECT COALESCE(MAX(numero), 0) + 1 AS numero FROM rest_comanda"
  );

  const numero = Number(numeroRows[0].numero);

  const r = await callProcedure("sp_comanda_abrir", [
    numero,
    mesa,
    req.user.id_usuario,
    cantidadPersonas,
  ]);

  await audit(
    req.user.id_usuario,
    "ABRIR",
    "rest_comanda",
    r[0].id_comanda,
    {
      id_mesa: mesa,
      personas: cantidadPersonas,
    }
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
  const idComanda = validarId(req.params.id, "Comanda inválida.");

  if (typeof uid !== "string" || !uid.trim()) {
    throw new HttpError(400, "El UID del pedido es obligatorio.");
  }

  if (!["SALON", "MOSTRADOR", "QR"].includes(origen)) {
    throw new HttpError(400, "El origen del pedido no es válido.");
  }

  validarItems(items);

  const r = await callProcedure("sp_pedido_crear", [
    idComanda,
    uid.trim(),
    origen,
    req.user.id_usuario,
    JSON.stringify(itemsParaProcedimiento(items)),
  ]);

  await audit(
    req.user.id_usuario,
    "CREAR",
    "rest_pedido",
    r[0].id_pedido,
    {
      id_comanda: idComanda,
      uid,
    }
  );

  res.status(201).json(r[0]);
};

// =====================================================
// CAMBIAR ESTADO DE PEDIDO
// =====================================================

exports.estadoPedido = async (req, res) => {
  const { estado } = req.body || {};
  const idPedido = validarId(req.params.id, "Pedido inválido.");

  if (!["ENVIADO", "CANCELADO"].includes(estado)) {
    throw new HttpError(
      400,
      "Para marcar como listo utilizá la ruta específica."
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

  res.json({
    mensaje: "Estado actualizado correctamente.",
  });
};

// =====================================================
// DETALLE DE UN PEDIDO
// =====================================================

exports.detallePedido = async (req, res) => {
  const idPedido = validarId(req.params.id, "Pedido inválido.");

  const r = await callProcedure("sp_pedido_detalle", [
    idPedido,
  ]);

  if (!r.length) {
    throw new HttpError(404, "Pedido no encontrado.");
  }

  res.json(r);
};

// =====================================================
// PEDIDOS PENDIENTES DE COCINA
// =====================================================

exports.pedidosCocina = async (req, res) => {
  const r = await callProcedure("sp_cocina_pedidos");
  res.json(r);
};

// =====================================================
// MARCAR PEDIDO COMO LISTO
// =====================================================

exports.marcarListo = async (req, res) => {
  const idPedido = validarId(req.params.id, "Pedido inválido.");

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

  res.json({
    mensaje: "Pedido marcado como listo.",
  });
};

// =====================================================
// SOLICITAR CUENTA
// =====================================================

exports.pedirCuenta = async (req, res) => {
  const idComanda = validarId(
    req.params.id,
    "Comanda inválida."
  );

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

  res.json({
    mensaje: "Cuenta solicitada correctamente.",
  });
};

// =====================================================
// CONSULTAR PEDIDOS DE UNA MESA
// =====================================================

exports.pedidosMesa = async (req, res) => {
  const idMesa = validarId(req.params.id, "Mesa inválida.");

  const r = await callProcedure("sp_mesa_pedidos", [
    idMesa,
  ]);

  res.json(r);
};

// =====================================================
// QR: MENÚ PÚBLICO
// =====================================================

exports.qrMenu = async (req, res) => {
  const codigo = String(req.params.codigo || "").trim();

  if (!codigo) {
    throw new HttpError(400, "Código QR inválido.");
  }

  const [mesas] = await pool.query(
    `SELECT id_mesa, numero, activa
     FROM rest_mesa
     WHERE codigo_qr = ?
     LIMIT 1`,
    [codigo]
  );

  if (!mesas.length || !mesas[0].activa) {
    throw new HttpError(404, "La mesa no existe o está inactiva.");
  }

  // Se incluye la letra (A, B, D): el frontend agrupa y ordena
  // el menú por letra, igual que en la pantalla del mozo.
  const [categorias] = await pool.query(
    `SELECT DISTINCT c.id_categoria, c.letra, c.nombre
     FROM rest_categoria c
     INNER JOIN rest_item_menu i
       ON i.id_categoria = c.id_categoria
     WHERE c.activa = 1
       AND i.activo = 1
     ORDER BY c.nombre`
  );

  const [menu] = await pool.query(
    `SELECT
        i.id_item,
        i.codigo,
        i.id_categoria,
        c.nombre AS categoria,
        i.nombre,
        i.descripcion,
        i.precio,
        i.agotado
     FROM rest_item_menu i
     INNER JOIN rest_categoria c
       ON c.id_categoria = i.id_categoria
     WHERE i.activo = 1
       AND c.activa = 1
     ORDER BY c.nombre, i.nombre`
  );

  res.json({
    mesa: {
      id_mesa: mesas[0].id_mesa,
      numero: mesas[0].numero,
    },
    categorias,
    menu,
  });
};

// =====================================================
// QR: EL CLIENTE ENVÍA SU PEDIDO
// NO SE ENVÍA A COCINA HASTA QUE CONFIRME EL MOZO
// =====================================================

exports.qrCrearPedido = async (req, res) => {
  const codigo = String(req.params.codigo || "").trim();
  const { uid, items } = req.body || {};

  if (!codigo) {
    throw new HttpError(400, "Código QR inválido.");
  }

  if (typeof uid !== "string" || !uid.trim()) {
    throw new HttpError(400, "El UID del pedido es obligatorio.");
  }

  validarItems(items);

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [mesas] = await connection.query(
      `SELECT id_mesa, numero, activa
       FROM rest_mesa
       WHERE codigo_qr = ?
       LIMIT 1
       FOR UPDATE`,
      [codigo]
    );

    if (!mesas.length || !mesas[0].activa) {
      throw new HttpError(404, "La mesa no existe o está inactiva.");
    }

    const idMesa = Number(mesas[0].id_mesa);

    // Evitar duplicados por reintentos del cliente.
    // (Va ANTES del control de la cuenta: si el cliente reintenta un
    //  pedido que ya entró, se le responde lo mismo que la primera vez.)
    const [existentes] = await connection.query(
      `SELECT id_pedido_qr, estado
       FROM rest_pedido_qr
       WHERE uid = ?
       LIMIT 1`,
      [uid.trim()]
    );

    if (existentes.length) {
      await connection.commit();

      return res.status(200).json({
        mensaje: "Este pedido QR ya fue recibido.",
        ...existentes[0],
      });
    }

    // Con la cuenta pedida no se aceptan pedidos QR (RF-QR-04 de la ERS):
    // la mesa ya está por cobrarse.
    const [cuentaPedida] = await connection.query(
      `SELECT id_comanda
       FROM rest_comanda
       WHERE id_mesa = ?
         AND estado = 'ABIERTA'
         AND cuenta_pedida IS NOT NULL
       LIMIT 1`,
      [idMesa]
    );

    if (cuentaPedida.length) {
      throw new HttpError(
        409,
        "La cuenta de esta mesa ya fue pedida. Llamá al mozo."
      );
    }

    // Solo un pedido QR pendiente por mesa.
    const [pendientes] = await connection.query(
      `SELECT id_pedido_qr
       FROM rest_pedido_qr
       WHERE mesa_esperando = ?
         AND estado = 'POR_CONFIRMAR'
       LIMIT 1
       FOR UPDATE`,
      [idMesa]
    );

    if (pendientes.length) {
      throw new HttpError(
        409,
        "La mesa ya tiene un pedido QR esperando al mozo."
      );
    }

    // Verificar que todos los productos estén disponibles.
    for (const item of items) {
      const [disponibles] = await connection.query(
        `SELECT id_item
         FROM rest_item_menu
         WHERE id_item = ?
           AND activo = 1
           AND agotado = 0
         LIMIT 1`,
        [Number(item.id_item)]
      );

      if (!disponibles.length) {
        throw new HttpError(
          400,
          "Uno de los artículos no está disponible."
        );
      }
    }

    const [insertQr] = await connection.query(
      `INSERT INTO rest_pedido_qr
        (id_mesa, uid, estado, mesa_esperando)
       VALUES (?, ?, 'POR_CONFIRMAR', ?)`,
      [idMesa, uid.trim(), idMesa]
    );

    const idPedidoQr = insertQr.insertId;

    for (const item of items) {
      await connection.query(
        `INSERT INTO rest_pedido_qr_item
          (id_pedido_qr, id_item, cantidad, observaciones)
         VALUES (?, ?, ?, ?)`,
        [
          idPedidoQr,
          Number(item.id_item),
          Number(item.cantidad),
          item.observaciones
            ? String(item.observaciones).trim()
            : null,
        ]
      );
    }

    await connection.commit();

    return res.status(201).json({
      mensaje: "Pedido enviado. Esperá la confirmación del mozo.",
      id_pedido_qr: idPedidoQr,
      estado: "POR_CONFIRMAR",
    });
  } catch (error) {
    await connection.rollback();

    if (error.code === "ER_DUP_ENTRY") {
      throw new HttpError(
        409,
        "La mesa ya tiene un pedido QR esperando al mozo."
      );
    }

    throw error;
  } finally {
    connection.release();
  }
};

// =====================================================
// QR: PEDIDOS PENDIENTES PARA MOZO / ENCARGADO
// =====================================================

// Devuelve UNA FILA POR ÍTEM (como cocina y los pedidos de la mesa);
// el frontend las agrupa por id_pedido_qr.
// No se usa JSON_ARRAYAGG: esa función existe recién desde MariaDB 10.5,
// y el XAMPP de la hostería trae MariaDB 10.4 (daba error 500).
exports.qrPedidosPendientes = async (req, res) => {
  const [filas] = await pool.query(
    `SELECT
        qr.id_pedido_qr,
        qr.uid,
        qr.estado,
        qr.creado,
        m.id_mesa,
        m.numero AS mesa,
        CASE
          WHEN c.cuenta_pedida IS NOT NULL THEN 'CUENTA_PEDIDA'
          WHEN c.id_comanda IS NOT NULL THEN 'OCUPADA'
          ELSE 'LIBRE'
        END AS estado_mesa,
        qi.id_item,
        i.codigo,
        i.nombre,
        i.precio,
        qi.cantidad,
        qi.observaciones
     FROM rest_pedido_qr qr
     INNER JOIN rest_mesa m
       ON m.id_mesa = qr.id_mesa
     LEFT JOIN rest_comanda c
       ON c.id_mesa = m.id_mesa
      AND c.estado = 'ABIERTA'
     INNER JOIN rest_pedido_qr_item qi
       ON qi.id_pedido_qr = qr.id_pedido_qr
     INNER JOIN rest_item_menu i
       ON i.id_item = qi.id_item
     WHERE qr.estado = 'POR_CONFIRMAR'
     ORDER BY qr.creado, qr.id_pedido_qr, qi.id_pedido_qr_item`
  );

  res.json(filas);
};

// =====================================================
// QR: CONFIRMAR PEDIDO
// =====================================================

exports.qrResolverPedido = async (req, res) => {
  const idPedidoQr = validarId(
    req.params.id,
    "Pedido QR inválido."
  );

  const personasRaw = req.body?.personas;

  const connection = await pool.getConnection();

  let qr;
  let mesaLibre = false;
  let idComanda = null;
  let itemsQr = [];

  try {
    await connection.beginTransaction();

    const [qrRows] = await connection.query(
      `SELECT *
       FROM rest_pedido_qr
       WHERE id_pedido_qr = ?
       FOR UPDATE`,
      [idPedidoQr]
    );

    if (!qrRows.length) {
      throw new HttpError(404, "Pedido QR no encontrado.");
    }

    qr = qrRows[0];

    if (qr.estado !== "POR_CONFIRMAR") {
      throw new HttpError(409, "Este pedido QR ya fue resuelto.");
    }

    const [mesas] = await connection.query(
      `SELECT id_mesa, activa
       FROM rest_mesa
       WHERE id_mesa = ?
       FOR UPDATE`,
      [qr.id_mesa]
    );

    if (!mesas.length || !mesas[0].activa) {
      throw new HttpError(404, "La mesa no existe o está inactiva.");
    }

    // rest_mesa no tiene columna estado: la ocupación se determina
    // por la existencia de una comanda ABIERTA.
    const [comandasAbiertas] = await connection.query(
      `SELECT id_comanda
       FROM rest_comanda
       WHERE id_mesa = ?
         AND estado = 'ABIERTA'
       ORDER BY id_comanda DESC
       LIMIT 1
       FOR UPDATE`,
      [qr.id_mesa]
    );

    mesaLibre = comandasAbiertas.length === 0;

    if (!mesaLibre) {
      idComanda = Number(comandasAbiertas[0].id_comanda);
    }

    const [items] = await connection.query(
      `SELECT id_item, cantidad, observaciones
       FROM rest_pedido_qr_item
       WHERE id_pedido_qr = ?`,
      [idPedidoQr]
    );

    if (!items.length) {
      throw new HttpError(
        400,
        "El pedido QR no contiene artículos."
      );
    }

    itemsQr = itemsParaProcedimiento(items);

    if (mesaLibre) {
      const personas = Number(personasRaw);

      if (
        !Number.isInteger(personas) ||
        personas < 1 ||
        personas > 20
      ) {
        throw new HttpError(
          400,
          "Indicá la cantidad de personas (1 a 20) para abrir la mesa."
        );
      }
    }

    // Marcar como procesando para evitar doble confirmación.
    await connection.query(
      `UPDATE rest_pedido_qr
       SET estado = 'PROCESANDO'
       WHERE id_pedido_qr = ?`,
      [idPedidoQr]
    );

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  try {
    const uidPedido = qr.uid;
    let resultado;

    if (mesaLibre) {
      // Mesa libre: el mozo confirma y carga la cantidad de personas.
      resultado = await callProcedure(
        "sp_comanda_pedido_inicial",
        [
          Number(qr.id_mesa),
          req.user.id_usuario,
          Number(personasRaw),
          uidPedido,
          "QR",
          req.user.id_usuario,
          JSON.stringify(itemsQr),
        ]
      );

      idComanda = Number(resultado?.[0]?.id_comanda);
    } else {
      // Mesa ocupada: se agrega a la comanda que ya está abierta.
      resultado = await callProcedure(
        "sp_pedido_crear",
        [
          idComanda,
          uidPedido,
          "QR",
          req.user.id_usuario,
          JSON.stringify(itemsQr),
        ]
      );
    }

    const idPedido = Number(resultado?.[0]?.id_pedido);

    if (!idPedido) {
      throw new Error(
        "El procedimiento no devolvió el ID del pedido."
      );
    }

    await pool.query(
      `UPDATE rest_pedido_qr
       SET estado = 'CONFIRMADO',
           mesa_esperando = NULL,
           resuelto = NOW(),
           id_usuario_resuelve = ?,
           id_pedido = ?
       WHERE id_pedido_qr = ?
         AND estado = 'PROCESANDO'`,
      [
        req.user.id_usuario,
        idPedido,
        idPedidoQr,
      ]
    );

    await audit(
      req.user.id_usuario,
      "CONFIRMAR_QR",
      "rest_pedido_qr",
      idPedidoQr,
      {
        id_pedido: idPedido,
        id_comanda: idComanda,
      }
    );

    return res.json({
      mensaje: "Pedido QR confirmado y agregado a la comanda.",
      id_pedido: idPedido,
      id_comanda: idComanda,
    });
  } catch (error) {
    // Si falla la creación, vuelve a quedar pendiente.
    await pool.query(
      `UPDATE rest_pedido_qr
       SET estado = 'POR_CONFIRMAR',
           mesa_esperando = id_mesa
       WHERE id_pedido_qr = ?
         AND estado = 'PROCESANDO'`,
      [idPedidoQr]
    );

    throw error;
  }
};

// =====================================================
// QR: DESCARTAR PEDIDO PENDIENTE
// =====================================================

exports.qrDescartarPedido = async (req, res) => {
  const idPedidoQr = validarId(
    req.params.id,
    "Pedido QR inválido."
  );

  const [resultado] = await pool.query(
    `UPDATE rest_pedido_qr
     SET estado = 'DESCARTADO',
         mesa_esperando = NULL,
         resuelto = NOW(),
         id_usuario_resuelve = ?
     WHERE id_pedido_qr = ?
       AND estado = 'POR_CONFIRMAR'`,
    [
      req.user.id_usuario,
      idPedidoQr,
    ]
  );

  if (!resultado.affectedRows) {
    const [existente] = await pool.query(
      `SELECT id_pedido_qr
       FROM rest_pedido_qr
       WHERE id_pedido_qr = ?`,
      [idPedidoQr]
    );

    if (!existente.length) {
      throw new HttpError(404, "Pedido QR no encontrado.");
    }

    throw new HttpError(
      409,
      "Este pedido QR ya fue resuelto o está siendo procesado."
    );
  }

  await audit(
    req.user.id_usuario,
    "DESCARTAR_QR",
    "rest_pedido_qr",
    idPedidoQr
  );

  res.json({
    mensaje: "Pedido QR descartado.",
  });
};

// =====================================================
// COMPATIBILIDAD CON LA RUTA ANTERIOR
// =====================================================

exports.qrResolverAccionAnterior = async (req, res) => {
  const accion = String(
    req.body?.accion || ""
  ).toUpperCase();

  if (accion === "DESCARTAR") {
    return exports.qrDescartarPedido(req, res);
  }

  return exports.qrResolverPedido(req, res);
};

// =====================================================
// ANULAR UN ÍTEM YA ENVIADO A COCINA (RF-PED-06)
// Agregado por Luján (rama anular-item).
// - Solo el encargado (lo controla la ruta con roles("ENCARGADO")).
// - Motivo obligatorio: mínimo 5 letras, máximo 255 (lo que entra en
//   rest_pedido_item.motivo_anulacion).
// - Todo el trabajo lo hace sp_item_anular (database/96_anular_item.sql)
//   en UNA transacción: marca anulado = 1, recalcula rest_comanda.total
//   y guarda el registro en rest_auditoria. Por eso acá NO se llama a
//   audit(): quedaría registrado dos veces.
// =====================================================

exports.anularItem = async (req, res) => {
  const idPedidoItem = validarId(req.params.id, "Ítem inválido.");
  const motivo = String(req.body?.motivo ?? "").trim();

  // Se valida también acá (no solo en la base) para responder rápido
  // y con un mensaje claro.
  if (motivo.length < 5) {
    throw new HttpError(
      400,
      "El motivo es obligatorio (mínimo 5 letras)."
    );
  }

  if (motivo.length > 255) {
    throw new HttpError(
      400,
      "El motivo no puede superar los 255 caracteres."
    );
  }

  let r;

  try {
    r = await callProcedure("sp_item_anular", [
      idPedidoItem,
      req.user.id_usuario,
      motivo,
    ]);
  } catch (error) {
    // Los SIGNAL del procedimiento llegan con sqlState '45000'.
    // Se traducen a códigos HTTP para que la pantalla sepa qué pasó:
    // 404 = el ítem no existe; 409 = ya estaba anulado o la comanda
    // ya se cerró/cobró; 400 = cualquier otro dato inválido.
    if (error.sqlState === "45000") {
      const texto = error.sqlMessage || error.message;
      let status = 400;

      if (texto.includes("no existe")) {
        status = 404;
      } else if (
        texto.includes("ya estaba anulado") ||
        texto.includes("cerrada")
      ) {
        status = 409;
      }

      throw new HttpError(status, texto);
    }

    throw error;
  }

  // Los DECIMAL llegan como texto ("12000.00"): se pasan a número.
  res.json({
    mensaje: "Ítem anulado.",
    id_pedido_item: Number(r[0].id_pedido_item),
    id_comanda: Number(r[0].id_comanda),
    total: Number(r[0].total),
  });
};