/* =========================================================
   api.js — Capa de acceso a datos del frontend
   ---------------------------------------------------------
   Las pantallas NUNCA hacen fetch directamente: siempre llaman
   a las funciones de este archivo (login, obtenerMesas, ...).

   USAR_MOCK = true  → usa datos simulados guardados en el
                        localStorage del navegador.
   USAR_MOCK = false → llama al backend real (Node.js + MySQL).

   Las dos formas devuelven los datos con EL MISMO formato, así
   que al cambiar el interruptor las pantallas no se tocan.

   El backend de Rosario usa otros nombres (id_mesa, id_item,
   letra, agotado, estados en MAYÚSCULA) y trabaja con COMANDAS.
   Las funciones "adaptar..." de más abajo traducen sus datos al
   formato que esperan las pantallas. Si mañana cambia un nombre
   en el backend, se corrige en UN solo lugar: este archivo.

   sesion.js es OPCIONAL: las pantallas del personal lo cargan
   antes que este archivo; la pantalla del cliente (QR) no lo
   carga, porque el cliente no inicia sesión.
   ========================================================= */

// ⚠️ Antes de instalar en la hostería tiene que estar en false
const USAR_MOCK = false;

/* Dirección del backend.
   - En la instalación, Node.js sirve también el frontend, así que
     alcanza con una ruta relativa ('/api'): funciona aunque cambie la IP.
   - Mientras probamos con Live Server (puerto 5500), el frontend y el
     backend están en puertos distintos: hay que llamar a Node en el
     3000 (y el .env del backend tiene que permitir ese origen en
     CORS_ORIGIN). */
const API_URL = location.port === '5500'
  ? 'http://localhost:3000/api'
  : '/api';

const DEMORA_MOCK = 300;           // ms, para simular la red
const CLAVE_MOCK = 'rest_mock_db'; // dónde guardamos la "base" simulada

// Códigos QR de PRUEBA para el mock: prueba01, prueba02... prueba12.
// En la base real son códigos al azar (columna rest_mesa.codigo_qr).
function codigoQrPrueba(numero) {
  return 'prueba' + String(numero).padStart(2, '0');
}

/* ---------------------------------------------------------
   DATOS SIMULADOS
   Códigos y precios de EJEMPLO: reemplazar por el menú real
   de la hostería (A comidas, B bebidas, D desayunos...).
   --------------------------------------------------------- */
const DATOS_INICIALES = {
  // Las claves en texto plano son SOLO para el mock.
  // En el backend se guardan hasheadas y nunca viajan al frontend.
  // Roles: encargado, mozo, cocina (las recepcionistas usan encargado)
  usuarios: [
    { id: 1, usuario: 'encargado', clave: '1234', nombre: 'Encargado', rol: 'encargado' },
    { id: 2, usuario: 'recepcion', clave: '1234', nombre: 'Recepción', rol: 'encargado' },
    { id: 3, usuario: 'mozo1',     clave: '1234', nombre: 'Mozo 1',    rol: 'mozo' },
    { id: 4, usuario: 'mozo2',     clave: '1234', nombre: 'Mozo 2',    rol: 'mozo' },
    { id: 5, usuario: 'cocina',    clave: '1234', nombre: 'Cocina',    rol: 'cocina' }
  ],
  categorias: [
    { codigo: 'A', nombre: 'Comidas' },
    { codigo: 'B', nombre: 'Bebidas' },
    { codigo: 'D', nombre: 'Desayunos y cafetería' }
  ],
  menu: [
    { id: 1, codigo: 'A01', nombre: 'Milanesa con papas fritas', categoria: 'A', precio: 9500, disponible: true, activo: true, descripcion: 'Milanesa de carne con papas fritas caseras' },
    { id: 2, codigo: 'A02', nombre: 'Empanadas (docena)',        categoria: 'A', precio: 12000, disponible: true, activo: true, descripcion: 'De carne, fritas o al horno' },
    { id: 3, codigo: 'A03', nombre: 'Locro',                     categoria: 'A', precio: 8000, disponible: true, activo: true },
    { id: 4, codigo: 'A04', nombre: 'Cabrito al horno',          categoria: 'A', precio: 15000, disponible: false, activo: true },
    { id: 5, codigo: 'B01', nombre: 'Agua mineral 500 ml',       categoria: 'B', precio: 1500, disponible: true, activo: true },
    { id: 6, codigo: 'B02', nombre: 'Gaseosa 500 ml',            categoria: 'B', precio: 2000, disponible: true, activo: true },
    { id: 7, codigo: 'B03', nombre: 'Vino tinto (copa)',         categoria: 'B', precio: 3000, disponible: true, activo: true },
    { id: 8, codigo: 'D01', nombre: 'Café con leche',            categoria: 'D', precio: 1800, disponible: true, activo: true },
    { id: 9, codigo: 'D02', nombre: 'Tostado de jamón y queso',  categoria: 'D', precio: 3500, disponible: true, activo: true }
  ],
  // 12 mesas, como en el Excel actual (a confirmar con la hostería)
  mesas: Array.from({ length: 12 }, (_, i) => ({
    id: i + 1,
    numero: i + 1,
    estado: 'libre',
    codigo_qr: codigoQrPrueba(i + 1)
  })),
  pedidos: [],
  ultimoIdPedido: 0,
  ultimoIdPlato: 9,
  // Bandeja de pedidos QR (en la base: rest_pedido_qr)
  pedidosQr: [],
  ultimoIdPedidoQr: 0
};

/* ---------------------------------------------------------
   Funciones internas del mock
   --------------------------------------------------------- */

// Copia profunda. Usamos JSON y no structuredClone porque
// alguna tablet o celular viejo puede no tenerlo.
function copiar(objeto) {
  return JSON.parse(JSON.stringify(objeto));
}

function leerMock() {
  try {
    const texto = localStorage.getItem(CLAVE_MOCK);
    if (texto) {
      const db = JSON.parse(texto);
      completarMock(db);
      return db;
    }
  } catch (e) { /* si falla, arrancamos de cero */ }
  const nueva = copiar(DATOS_INICIALES);
  guardarMock(nueva);
  return nueva;
}

/* Si el navegador tiene guardado un mock VIEJO (de antes del Inc. 2),
   le agregamos lo que le falta para el QR sin borrar lo que había. */
function completarMock(db) {
  let cambio = false;
  if (!Array.isArray(db.pedidosQr)) {
    db.pedidosQr = [];
    cambio = true;
  }
  if (typeof db.ultimoIdPedidoQr !== 'number') {
    db.ultimoIdPedidoQr = 0;
    cambio = true;
  }
  (db.mesas || []).forEach(m => {
    if (!m.codigo_qr) {
      m.codigo_qr = codigoQrPrueba(m.numero);
      cambio = true;
    }
  });
  if (cambio) guardarMock(db);
}

function guardarMock(db) {
  try {
    localStorage.setItem(CLAVE_MOCK, JSON.stringify(db));
  } catch (e) {
    console.error('No se pudo guardar el mock', e);
  }
}

// Para probar: escribir reiniciarMock() en la consola del navegador
function reiniciarMock() {
  guardarMock(copiar(DATOS_INICIALES));
  console.log('Datos simulados reiniciados');
}

function esperar(ms) {
  return new Promise(resolver => setTimeout(resolver, ms));
}

// Crea un error con el código HTTP, igual que el backend real
function errorApi(mensaje, estado) {
  const error = new Error(mensaje);
  error.estado = estado;
  return error;
}

/* Sesión actual, o null si no hay.
   La pantalla del cliente (QR) no carga sesion.js, así que primero
   nos fijamos si la función obtenerSesion existe. */
function sesionActual() {
  return typeof obtenerSesion === 'function' ? obtenerSesion() : null;
}

// Usuario actual (para saber qué mozo hace el pedido)
function usuarioActual() {
  const sesion = sesionActual();
  return sesion ? sesion.usuario : null;
}

/* ---------------------------------------------------------
   Petición al backend real
   Formato de error del backend: { "error": "mensaje" }
   --------------------------------------------------------- */
async function peticion(metodo, ruta, cuerpo) {
  const opciones = {
    method: metodo,
    headers: { 'Content-Type': 'application/json' }
  };

  const sesion = sesionActual();
  if (sesion && sesion.token) {
    opciones.headers['Authorization'] = 'Bearer ' + sesion.token;
  }
  if (cuerpo !== undefined) {
    opciones.body = JSON.stringify(cuerpo);
  }

  let respuesta;
  try {
    respuesta = await fetch(API_URL + ruta, opciones);
  } catch (e) {
    // fetch solo falla así cuando no llega al servidor
    throw errorApi('No se pudo conectar con el servidor. Revisá que estés conectado al wifi de la hostería.', 0);
  }

  let datos = null;
  try {
    datos = await respuesta.json();
  } catch (e) { /* respuesta sin cuerpo */ }

  if (!respuesta.ok) {
    const mensaje = (datos && datos.error) || 'Error del servidor (' + respuesta.status + ')';
    throw errorApi(mensaje, respuesta.status);
  }
  return datos;
}

/* =========================================================
   ADAPTADORES: datos del backend → formato de las pantallas
   ---------------------------------------------------------
   Detalles de cómo llegan los datos desde MySQL (mysql2):
   - Los BOOLEAN llegan como 0 / 1  → los pasamos a true / false
   - Los DECIMAL (precios) llegan como texto "9500.00" → Number()
   - Los estados llegan en MAYÚSCULA ("PENDIENTE") → minúscula
   ========================================================= */

function aMinuscula(texto) {
  return String(texto || '').toLowerCase();
}

function aBooleano(valor) {
  return Number(valor) === 1 || valor === true;
}

// Las categorías casi no cambian: las pedimos una vez por pantalla
// y las guardamos acá. Hacen falta para traducir id_categoria ↔ letra.
// Guardamos la PROMESA (no el resultado): si tres funciones piden las
// categorías al mismo tiempo al abrir Menú, comparten UNA sola petición
// en vez de hacer tres. Si la petición falla, borramos la caché para
// que el próximo intento vuelva a preguntar al servidor.
let categoriasCache = null;

function categoriasDelServidor() {
  if (!categoriasCache) {
    categoriasCache = peticion('GET', '/categorias').catch(error => {
      categoriasCache = null;
      throw error;
    });
  }
  return categoriasCache;
}

// { id_categoria, letra, nombre, activa } → { codigo, nombre }
function adaptarCategoria(c) {
  return { codigo: c.letra, nombre: c.nombre };
}

// { id_item, codigo, id_categoria, nombre, precio, agotado, activo }
//   → { id, codigo, nombre, categoria (letra), precio, disponible, activo }
function adaptarPlato(p, categorias) {
  const categoria = categorias.find(c => c.id_categoria === p.id_categoria);
  return {
    id: p.id_item,
    codigo: p.codigo,
    nombre: p.nombre,
    categoria: categoria ? categoria.letra : '',
    precio: Number(p.precio),
    disponible: !aBooleano(p.agotado), // en la base se guarda al revés: "agotado"
    activo: aBooleano(p.activo)
  };
}

// { id_mesa, numero, estado: 'CUENTA_PEDIDA', pedidos_qr }
//   → { id, numero, estado: 'cuenta_pedida', pedidos_qr }
// pedidos_qr = cuántos pedidos QR esperan al mozo (0 si el backend
// todavía no lo manda: así no se rompe nada mientras tanto).
function adaptarMesa(m) {
  return {
    id: m.id_mesa,
    numero: m.numero,
    estado: aMinuscula(m.estado),
    pedidos_qr: Number(m.pedidos_qr || 0)
  };
}

/* El backend devuelve los pedidos "aplanados": UNA FILA POR ÍTEM
   (así salen de un JOIN en SQL). Acá los agrupamos en un objeto por
   pedido con su lista de ítems, que es lo que esperan las pantallas.
   Usamos un Map para encontrar rápido el pedido de cada fila y un
   arreglo para mantener el orden de llegada que manda el servidor. */
function agruparPedidos(filas) {
  const pedidos = [];
  const porId = new Map();

  for (const f of filas) {
    // Una comanda sin pedidos viene con id_pedido null: la salteamos
    if (f.id_pedido === null || f.id_pedido === undefined) continue;

    let pedido = porId.get(f.id_pedido);
    if (!pedido) {
      pedido = {
        id: f.id_pedido,
        id_comanda: f.id_comanda,
        mesa_id: f.id_mesa !== undefined ? f.id_mesa : null,
        mesa_numero: f.mesa_numero !== undefined ? f.mesa_numero : null,
        mozo_id: null,
        mozo_nombre: f.mozo || '',
        personas: f.personas !== undefined ? f.personas : null,
        // cocina lo manda como "estado"; pedidos de la mesa, como "estado_pedido"
        estado: aMinuscula(f.estado_pedido || f.estado),
        creado_en: f.creado,
        items: []
      };
      if (f.minutos_espera !== undefined) {
        pedido.minutos_espera = Number(f.minutos_espera);
      }
      porId.set(f.id_pedido, pedido);
      pedidos.push(pedido);
    }

    if (f.id_item !== null && f.id_item !== undefined) {
      pedido.items.push({
        // id del RENGLÓN (rest_pedido_item): hace falta para anular
        // un ítem ya enviado (RF-PED-06). null si el backend no lo manda.
        id_pedido_item: f.id_pedido_item !== undefined ? f.id_pedido_item : null,
        menu_id: f.id_item,
        codigo: f.codigo || '',
        nombre: f.articulo,
        cantidad: Number(f.cantidad),
        observaciones: f.observaciones || '',
        precio_unitario: f.precio_unitario !== undefined ? Number(f.precio_unitario) : null
      });
    }
  }
  return pedidos;
}

/* Identificador único de cada envío de pedido (columna uid).
   Sirve para que el backend no guarde dos veces el mismo pedido.
   No usamos crypto.randomUUID() porque el navegador solo lo permite
   con https o en localhost, y en la hostería entramos por
   http://IP-local. Fecha + número al azar alcanza para este uso. */
function generarUid() {
  return 'p' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// Las rutas de modificación del menú devuelven { afectados: N }.
// Si no cambió ninguna fila, el plato no existía (o estaba dado de baja).
function exigirAfectados(resultado, mensaje) {
  if (resultado && resultado.afectados !== undefined && Number(resultado.afectados) === 0) {
    throw errorApi(mensaje, 404);
  }
}

// Busca la comanda abierta de una mesa (null si está libre)
async function comandaAbiertaDeMesa(idMesa) {
  const filas = await peticion('GET', '/mesas/' + idMesa + '/pedidos');
  return filas.length > 0 ? filas[0].id_comanda : null;
}

// Después de crear o modificar un plato, lo traemos de nuevo del
// servidor para devolverlo con el mismo formato que el mock.
async function buscarPlatoEnServidor(idPlato) {
  const menu = await obtenerMenu();
  return menu.find(p => p.id === idPlato) || { id: idPlato };
}

/* =========================================================
   FUNCIONES PÚBLICAS — las que usan las pantallas
   Cada una tiene su versión mock y su versión real.
   ========================================================= */

/* ---------- USUARIOS (RF-USU) ---------- */

// Devuelve { token, usuario: { id, nombre, rol } }
async function login(usuario, clave) {
  if (!USAR_MOCK) {
    // El backend responde { token, usuario: { id_usuario, nombre, usuario, rol: 'MOZO' } }
    const r = await peticion('POST', '/auth/login', { usuario, clave });
    return {
      token: r.token,
      usuario: {
        id: r.usuario.id_usuario,
        nombre: r.usuario.nombre,
        rol: aMinuscula(r.usuario.rol) // 'MOZO' → 'mozo', como PAGINA_POR_ROL
      }
    };
  }

  await esperar(DEMORA_MOCK);
  const db = leerMock();
  const encontrado = db.usuarios.find(u => u.usuario === usuario && u.clave === clave);
  if (!encontrado) throw errorApi('Usuario o contraseña incorrectos', 401);

  // Nunca devolvemos la clave, igual que el backend real
  return {
    token: 'token-simulado-' + encontrado.id,
    usuario: { id: encontrado.id, nombre: encontrado.nombre, rol: encontrado.rol }
  };
}

/* ---------- MESAS (RF-MES) ---------- */
// Estados de mesa: libre | ocupada | cuenta_pedida
// Cada mesa trae además pedidos_qr: cuántos pedidos QR esperan al mozo.

async function obtenerMesas() {
  if (!USAR_MOCK) {
    const mesas = await peticion('GET', '/mesas');
    return mesas
      .filter(m => aBooleano(m.activa)) // las mesas desactivadas no se muestran
      .map(adaptarMesa);
  }

  await esperar(DEMORA_MOCK);
  const db = leerMock();
  return db.mesas.map(m => ({
    ...m,
    pedidos_qr: db.pedidosQr.filter(q => q.mesa_id === m.id && q.estado === 'por_confirmar').length
  }));
}

/* El único cambio de estado que hace el mozo es "pedir la cuenta".
   En el backend la cuenta se pide sobre la COMANDA abierta de la mesa,
   así que primero buscamos cuál es. Liberar la mesa lo hace Caja
   al cobrar (Inc. 3). */
async function cambiarEstadoMesa(idMesa, estado) {
  if (!USAR_MOCK) {
    if (estado !== 'cuenta_pedida') {
      throw errorApi('Ese cambio de estado se hace desde Caja', 400);
    }
    const idComanda = await comandaAbiertaDeMesa(idMesa);
    if (!idComanda) throw errorApi('La mesa no tiene una comanda abierta', 409);
    await peticion('POST', '/comandas/' + idComanda + '/cuenta');
    return { id: idMesa, estado: 'cuenta_pedida' };
  }

  await esperar(DEMORA_MOCK);
  const db = leerMock();
  const mesa = db.mesas.find(m => m.id === idMesa);
  if (!mesa) throw errorApi('La mesa no existe', 404);
  mesa.estado = estado;
  guardarMock(db);
  return mesa;
}

/* ---------- MENÚ (RF-MEN) ---------- */

async function obtenerCategorias() {
  if (!USAR_MOCK) {
    const categorias = await categoriasDelServidor();
    return categorias
      .filter(c => aBooleano(c.activa))
      .map(adaptarCategoria)
      .sort((a, b) => a.codigo.localeCompare(b.codigo)); // A, B, D...
  }

  await esperar(DEMORA_MOCK);
  return leerMock().categorias;
}

// Devuelve todos los platos activos (también los agotados,
// para que el mozo los vea marcados como "Agotado")
async function obtenerMenu() {
  if (!USAR_MOCK) {
    const categorias = await categoriasDelServidor();
    const platos = await peticion('GET', '/menu'); // solo activos
    return platos.map(p => adaptarPlato(p, categorias));
  }

  await esperar(DEMORA_MOCK);
  return leerMock().menu.filter(p => p.activo);
}

// Platos dados de baja (solo el encargado, para poder reactivarlos)
async function obtenerPlatosBaja() {
  if (!USAR_MOCK) {
    const categorias = await categoriasDelServidor();
    const platos = await peticion('GET', '/menu/bajas');
    return platos.map(p => adaptarPlato(p, categorias));
  }

  await esperar(DEMORA_MOCK);
  return leerMock().menu.filter(p => !p.activo);
}

/* Reglas del plato. Están acá arriba (globales) para que menu.js
   use LAS MISMAS en el formulario y no haya dos versiones.
   El backend tiene que validar lo mismo: la validación del
   frontend se puede saltear desde el navegador. */
const FORMATO_CODIGO = /^[A-Z]\d{2,3}$/; // A01, B12, D105 (a confirmar con el menú real)
const LARGO_MIN_NOMBRE = 2;
const LARGO_MAX_NOMBRE = 60;
const PRECIO_MAXIMO = 9999999;          // (propuesta) frena un cero de más por error

// Ordena lo que escribió el usuario: saca espacios y pone el código
// en mayúsculas. Copia SOLO los campos permitidos: así nadie puede
// mandar "activo", "disponible" o "id" para cambiarlos por acá.
function limpiarPlato(datos) {
  return {
    codigo: String(datos.codigo || '').trim().toUpperCase(),
    nombre: String(datos.nombre || '').trim(),
    categoria: String(datos.categoria || '').trim().toUpperCase(),
    precio: Number(datos.precio)
  };
}

/* Las mismas validaciones que tiene que hacer el backend (400 = datos mal).
   categorias = lista con el formato de las pantallas: [{ codigo, nombre }]
   La usan el mock y también la versión real (antes de mandar al servidor). */
function validarPlato(categorias, plato) {
  if (!categorias.some(c => c.codigo === plato.categoria)) {
    throw errorApi('La categoría no existe', 400);
  }
  if (!FORMATO_CODIGO.test(plato.codigo)) {
    throw errorApi('El código debe ser una letra y 2 o 3 números (ej.: A01)', 400);
  }
  if (plato.codigo[0] !== plato.categoria) {
    throw errorApi('El código tiene que empezar con la letra de la categoría (' + plato.categoria + ')', 400);
  }
  if (plato.nombre.length < LARGO_MIN_NOMBRE || plato.nombre.length > LARGO_MAX_NOMBRE) {
    throw errorApi('El nombre debe tener entre ' + LARGO_MIN_NOMBRE + ' y ' + LARGO_MAX_NOMBRE + ' letras', 400);
  }
  if (!Number.isInteger(plato.precio) || plato.precio < 1 || plato.precio > PRECIO_MAXIMO) {
    throw errorApi('El precio debe ser un número entero mayor a 0', 400);
  }
}

/* El código no se puede repetir, contando TAMBIÉN los dados de baja.
   Si no, al reactivar uno habría dos platos con el mismo código y
   las estadísticas mezclarían platos distintos.
   En MySQL: UNIQUE en la columna codigo. (409 = conflicto) */
function verificarCodigoLibre(db, codigo, idPropio) {
  const otro = db.menu.find(p => p.codigo === codigo && p.id !== idPropio);
  if (!otro) return;
  if (otro.activo) {
    throw errorApi('Ya existe un plato con el código ' + codigo + ' (' + otro.nombre + ')', 409);
  }
  throw errorApi('El código ' + codigo + ' es de un plato dado de baja (' + otro.nombre +
                 '): reactivalo desde "Dados de baja"', 409);
}

/* Arma el cuerpo que espera el backend:
   { codigo, id_categoria, nombre, precio }
   (las pantallas trabajan con la LETRA de la categoría; la base,
   con su id_categoria) */
async function platoParaServidor(datos) {
  const plato = limpiarPlato(datos);
  const categorias = await categoriasDelServidor();
  validarPlato(categorias.map(adaptarCategoria), plato);

  const categoria = categorias.find(c => c.letra === plato.categoria);
  return {
    codigo: plato.codigo,
    id_categoria: categoria.id_categoria,
    nombre: plato.nombre,
    precio: plato.precio
  };
}

// datos = { codigo, nombre, categoria, precio }
async function crearPlato(datos) {
  if (!USAR_MOCK) {
    const cuerpo = await platoParaServidor(datos);
    const r = await peticion('POST', '/menu', cuerpo); // devuelve { id_item }
    return buscarPlatoEnServidor(r.id_item);
  }

  await esperar(DEMORA_MOCK);
  const db = leerMock();
  const plato = limpiarPlato(datos);
  validarPlato(db.categorias, plato);
  verificarCodigoLibre(db, plato.codigo, null);

  db.ultimoIdPlato++;
  const nuevo = { id: db.ultimoIdPlato, ...plato, disponible: true, activo: true };
  db.menu.push(nuevo);
  guardarMock(db);
  return nuevo;
}

/* PUT = se manda el plato COMPLETO { codigo, nombre, categoria, precio }.
   Cambiar el precio NO toca los pedidos viejos: cada pedido guardó
   su precio_unitario del momento. */
async function editarPlato(idPlato, datos) {
  if (!USAR_MOCK) {
    const cuerpo = await platoParaServidor(datos);
    const r = await peticion('PUT', '/menu/' + idPlato, cuerpo);
    exigirAfectados(r, 'El plato no existe o fue dado de baja');
    return buscarPlatoEnServidor(idPlato);
  }

  await esperar(DEMORA_MOCK);
  const db = leerMock();
  const plato = db.menu.find(p => p.id === idPlato && p.activo);
  if (!plato) throw errorApi('El plato no existe o fue dado de baja', 404);

  const cambios = limpiarPlato(datos);
  validarPlato(db.categorias, cambios);
  verificarCodigoLibre(db, cambios.codigo, plato.id);

  Object.assign(plato, cambios); // seguro: cambios solo tiene los 4 campos permitidos
  guardarMock(db);
  return plato;
}

/* Baja LÓGICA: el plato no se borra, se marca activo = false.
   Así los pedidos viejos (y las estadísticas) siguen sabiendo
   qué plato era. */
async function eliminarPlato(idPlato) {
  if (!USAR_MOCK) {
    const r = await peticion('DELETE', '/menu/' + idPlato);
    exigirAfectados(r, 'El plato no existe o ya fue dado de baja');
    return { ok: true };
  }

  await esperar(DEMORA_MOCK);
  const db = leerMock();
  const plato = db.menu.find(p => p.id === idPlato && p.activo);
  if (!plato) throw errorApi('El plato no existe o ya fue dado de baja', 404);
  plato.activo = false;
  guardarMock(db);
  return { ok: true };
}

/* Vuelve a poner activo un plato dado de baja.
   Vuelve DISPONIBLE (propuesta) y con el precio que tenía:
   la pantalla le avisa al encargado que lo revise. */
async function reactivarPlato(idPlato) {
  if (!USAR_MOCK) {
    const r = await peticion('PATCH', '/menu/' + idPlato + '/reactivar');
    exigirAfectados(r, 'El plato no existe o ya está activo');
    return buscarPlatoEnServidor(idPlato);
  }

  await esperar(DEMORA_MOCK);
  const db = leerMock();
  const plato = db.menu.find(p => p.id === idPlato && !p.activo);
  if (!plato) throw errorApi('El plato no existe o ya está activo', 404);
  plato.activo = true;
  plato.disponible = true;
  guardarMock(db);
  return plato;
}

// Para avisar al salón que un plato se agotó (problema del relevamiento)
async function cambiarDisponibilidad(idPlato, disponible) {
  if (!USAR_MOCK) {
    const r = await peticion('PATCH', '/menu/' + idPlato + '/disponible', { disponible });
    exigirAfectados(r, 'El plato no existe o fue dado de baja');
    return buscarPlatoEnServidor(idPlato);
  }

  await esperar(DEMORA_MOCK);
  if (typeof disponible !== 'boolean') throw errorApi('Disponible debe ser verdadero o falso', 400);
  const db = leerMock();
  const plato = db.menu.find(p => p.id === idPlato && p.activo);
  if (!plato) throw errorApi('El plato no existe o fue dado de baja', 404);
  plato.disponible = disponible;
  guardarMock(db);
  return plato;
}

/* ---------- PEDIDOS (RF-PED) y COCINA (RF-COC) ---------- */
// Estados de un pedido: pendiente | en_preparacion | listo
// (los pedidos QR sin confirmar NO están acá: viven en la bandeja,
//  ver la sección PEDIDO POR QR más abajo)

/* datos = { mesa_id, personas, items: [ { menu_id, cantidad, observaciones } ] }
   El precio NO lo manda el frontend: lo pone el backend desde el
   menú. Así nadie puede cambiar un precio desde el navegador.

   En el backend real:
   - Primer pedido (viene "personas", la mesa está libre):
     POST /comandas/primer-pedido → abre la comanda y guarda el pedido
     en UNA sola transacción (si algo falla, no queda nada a medias).
   - Pedidos siguientes: buscamos la comanda abierta de la mesa y
     usamos POST /comandas/:id/pedidos. */
async function crearPedido(datos) {
  if (!USAR_MOCK) {
    const items = (datos.items || []).map(i => ({
      id_item: i.menu_id,
      cantidad: i.cantidad,
      observaciones: i.observaciones || ''
    }));
    const uid = datos.uid || generarUid();
    let r;

    if (datos.personas) {
      r = await peticion('POST', '/comandas/primer-pedido', {
        id_mesa: datos.mesa_id,
        personas: datos.personas,
        uid,
        origen: 'SALON',
        items
      });
    } else {
      const idComanda = await comandaAbiertaDeMesa(datos.mesa_id);
      if (!idComanda) {
        throw errorApi('La mesa ya no tiene una comanda abierta. Volvé a Mesas y abrila de nuevo.', 409);
      }
      r = await peticion('POST', '/comandas/' + idComanda + '/pedidos', {
        uid,
        origen: 'SALON',
        items
      });
    }
    return { id: r.id_pedido, mesa_id: datos.mesa_id, estado: 'pendiente' };
  }

  await esperar(DEMORA_MOCK);
  const db = leerMock();
  const mesa = db.mesas.find(m => m.id === datos.mesa_id);
  if (!mesa) throw errorApi('La mesa no existe', 404);
  if (!datos.items || datos.items.length === 0) throw errorApi('El pedido no tiene platos', 400);

  // Armamos cada ítem copiando nombre y precio del momento.
  // Si el precio cambia en 6 meses, este pedido queda con el de hoy.
  const items = [];
  for (const item of datos.items) {
    const plato = db.menu.find(p => p.id === item.menu_id && p.activo);
    if (!plato) throw errorApi('Un plato del pedido no existe', 400);
    if (!plato.disponible) throw errorApi(plato.nombre + ' está agotado', 409);
    items.push({
      menu_id: plato.id,
      codigo: plato.codigo,
      nombre: plato.nombre,
      cantidad: item.cantidad,
      observaciones: item.observaciones || '',
      precio_unitario: plato.precio
    });
  }

  const mozo = usuarioActual();
  db.ultimoIdPedido++;
  const pedido = {
    id: db.ultimoIdPedido,
    mesa_id: mesa.id,
    mesa_numero: mesa.numero,
    mozo_id: mozo ? mozo.id : null,
    mozo_nombre: mozo ? mozo.nombre : '',
    personas: datos.personas || null,
    estado: 'pendiente',
    creado_en: new Date().toISOString(),
    items
  };
  db.pedidos.push(pedido);
  mesa.estado = 'ocupada';
  guardarMock(db);
  return pedido;
}

// Pedidos de una mesa (para que el mozo vea lo que ya pidió)
async function obtenerPedidosMesa(idMesa) {
  if (!USAR_MOCK) {
    const filas = await peticion('GET', '/mesas/' + idMesa + '/pedidos');
    const pedidos = agruparPedidos(filas);
    pedidos.forEach(p => { p.mesa_id = idMesa; });
    return pedidos;
  }

  await esperar(DEMORA_MOCK);
  return leerMock().pedidos.filter(p => p.mesa_id === idMesa);
}

/* Vista de cocina: lo que falta preparar, por orden de llegada.
   Cada pedido trae minutos_espera calculado por el SERVIDOR.
   Así no dependemos del reloj de la tablet, que sin internet se
   puede atrasar o adelantar. */
async function obtenerPedidosCocina() {
  if (!USAR_MOCK) {
    // El backend responde UNA FILA POR ÍTEM, con estos nombres:
    // { id_pedido, id_comanda, estado: 'PENDIENTE', creado, minutos_espera,
    //   mozo, id_item, articulo, cantidad, observaciones }
    // agruparPedidos ya los traduce (id_pedido → id, creado → creado_en,
    // articulo → nombre, estado en minúscula, etc.).
    const filas = await peticion('GET', '/cocina/pedidos'); // ya vienen ordenados
    const pedidos = agruparPedidos(filas);

    /* sp_cocina_pedidos devuelve mesa_numero (50_cocina_mesa.sql).
       Si algún pedido llegara sin mesa (por ejemplo, de MOSTRADOR),
       mostramos "Mesa ?" en vez de "Mesa null". */
    pedidos.forEach(p => {
      if (p.mesa_numero === null || p.mesa_numero === undefined) {
        p.mesa_numero = '?';
      }
    });
    return pedidos;
  }

  await esperar(DEMORA_MOCK);
  const ahora = Date.now();
  return leerMock().pedidos
    .filter(p => p.estado === 'pendiente' || p.estado === 'en_preparacion')
    .sort((a, b) => a.creado_en.localeCompare(b.creado_en))
    // Copiamos cada pedido y le agregamos los minutos que lleva esperando
    .map(p => ({
      ...p,
      minutos_espera: Math.floor((ahora - new Date(p.creado_en).getTime()) / 60000)
    }));
}

// La única acción de cocina: "Listo"
// El backend devuelve 409 si el pedido ya no estaba pendiente.
async function marcarPedidoListo(idPedido) {
  if (!USAR_MOCK) {
    // PATCH /pedidos/:id/listo de Rosario: hace el UPDATE solo si el
    // pedido sigue PENDIENTE / EN_PREPARACION (una sola consulta, sin
    // carrera entre dos tablets). Si no cambió nada → 409.
    // peticion() convierte ese 409 en un error con .estado = 409, y
    // cocina.js lo toma como "ya estaba hecho" (saca la tarjeta sin error).
    await peticion('PATCH', '/pedidos/' + idPedido + '/listo');
    return { id: idPedido, estado: 'listo' };
  }

  await esperar(DEMORA_MOCK);
  const db = leerMock();
  const pedido = db.pedidos.find(p => p.id === idPedido);
  if (!pedido) throw errorApi('El pedido no existe', 404);
  // Si ya estaba listo (por ejemplo, lo marcaron el encargado y
  // cocina casi al mismo tiempo), avisamos con 409 = conflicto
  if (pedido.estado !== 'pendiente' && pedido.estado !== 'en_preparacion') {
    throw errorApi('El pedido ya estaba marcado como listo', 409);
  }
  pedido.estado = 'listo';
  guardarMock(db);
  return pedido;
}

/* Anular un ítem YA ENVIADO a cocina (RF-PED-06).
   Solo el encargado (el backend responde 403 a los demás).
   idPedidoItem = id del renglón (item.id_pedido_item de obtenerPedidosMesa)
   motivo       = obligatorio, de 5 a 255 letras

   No tiene versión mock, igual que la caja: las reglas (comanda
   abierta, no anular dos veces, recalcular el total y auditar)
   viven en sp_item_anular (96_anular_item.sql), en UNA transacción.

   Errores que devuelve el backend:
   400 motivo inválido · 404 el ítem no existe ·
   409 ya estaba anulado o la mesa ya se cobró.
   Devuelve { id_pedido_item, id_comanda, total } (total NUEVO de la comanda). */
const LARGO_MIN_MOTIVO_ANULAR = 5;
const LARGO_MAX_MOTIVO_ANULAR = 255;

async function anularItem(idPedidoItem, motivo) {
  if (USAR_MOCK) {
    throw errorApi('Anular un ítem funciona solo con el backend real: poné USAR_MOCK = false en api.js', 501);
  }

  const id = Number(idPedidoItem);
  if (!Number.isInteger(id) || id < 1) {
    throw errorApi('No se encontró el ítem a anular. Actualizá la pantalla.', 400);
  }

  const texto = String(motivo || '').trim();
  if (texto.length < LARGO_MIN_MOTIVO_ANULAR) {
    throw errorApi('Escribí el motivo (mínimo ' + LARGO_MIN_MOTIVO_ANULAR + ' letras)', 400);
  }
  if (texto.length > LARGO_MAX_MOTIVO_ANULAR) {
    throw errorApi('El motivo puede tener hasta ' + LARGO_MAX_MOTIVO_ANULAR + ' letras', 400);
  }

  const r = await peticion('PATCH', '/pedidos-items/' + id + '/anular', { motivo: texto });
  return {
    id_pedido_item: r.id_pedido_item,
    id_comanda: r.id_comanda,
    total: aImporte(r.total)
  };
}

/* =========================================================
   PEDIDO POR QR (RF-QR) — Incremento 2
   ---------------------------------------------------------
   Cómo funciona:
   1. El cliente escanea el QR de la mesa: abre qr.html?c=CODIGO.
      CODIGO es rest_mesa.codigo_qr (al azar, NO el número de mesa:
      si fuera el número, cualquiera lo cambia y pide para otra mesa).
   2. El cliente arma el pedido y lo envía SIN usuario. El pedido
      queda en una BANDEJA aparte (rest_pedido_qr) "por confirmar".
      Cocina NO lo ve: no está en rest_pedido.
   3. El mozo ve el aviso en la tarjeta de la mesa y lo confirma
      (si la mesa está libre, carga las personas) o lo descarta.
      Al confirmar, el backend lo pasa a una comanda y pedido reales
      con los mismos procedimientos del Inc. 1 → recién ahí va a cocina.

   Estados de la bandeja: por_confirmar | confirmado | descartado
   (nunca se borra: queda el registro, RNF-BD-05)
   ========================================================= */

// Las mismas reglas que el pedido del mozo (y que el backend)
const CANTIDAD_MAX_QR = 50;
const LARGO_MAX_OBS_QR = 100;
const PERSONAS_MAX = 20;

// Copia SOLO los campos permitidos de cada ítem y los ordena
// (igual que limpiarPlato: nadie puede colar un precio por acá)
function limpiarItemsQr(items) {
  return (Array.isArray(items) ? items : []).map(i => ({
    menu_id: Number(i.menu_id),
    cantidad: Number(i.cantidad),
    observaciones: String(i.observaciones || '').trim()
  }));
}

// Validaciones del pedido del cliente (400 = datos mal).
// La pantalla también las usa, pero la seguridad real es el backend.
function validarItemsQr(items) {
  if (items.length === 0) {
    throw errorApi('Tu pedido está vacío: agregá al menos un plato', 400);
  }
  for (const i of items) {
    if (!Number.isInteger(i.menu_id) || i.menu_id < 1) {
      throw errorApi('Hay un plato inválido en el pedido', 400);
    }
    if (!Number.isInteger(i.cantidad) || i.cantidad < 1 || i.cantidad > CANTIDAD_MAX_QR) {
      throw errorApi('La cantidad de cada plato tiene que ser entre 1 y ' + CANTIDAD_MAX_QR, 400);
    }
    if (i.observaciones.length > LARGO_MAX_OBS_QR) {
      throw errorApi('Las observaciones pueden tener hasta ' + LARGO_MAX_OBS_QR + ' letras', 400);
    }
  }
}

// Mock: busca la mesa por su código QR (404 si no existe)
function mesaPorCodigoMock(db, codigo) {
  const mesa = db.mesas.find(m => m.codigo_qr === codigo);
  if (!mesa) throw errorApi('Este código QR no es válido. Pedile ayuda al mozo.', 404);
  return mesa;
}

// Plato para el CLIENTE: sin "activo" (solo ve los activos)
// y con descripción (RF-QR-02)
function adaptarPlatoQr(p, categorias) {
  const plato = adaptarPlato(p, categorias);
  return {
    id: plato.id,
    codigo: plato.codigo,
    nombre: plato.nombre,
    descripcion: p.descripcion || '',
    categoria: plato.categoria,
    precio: plato.precio,
    disponible: plato.disponible
  };
}

/* Bandeja del mozo (GET /pedidos-qr). Nombres REALES del backend:
   { id_pedido_qr, uid, estado, creado, id_mesa, mesa (número),
     estado_mesa: 'LIBRE' | 'OCUPADA' | 'CUENTA_PEDIDA', ... }
   Los ítems pueden llegar de DOS formas, y aceptamos las dos:
   a) UNA FILA POR ÍTEM (id_item, nombre, precio, cantidad,
      observaciones en cada fila), como los otros pedidos.
   b) Una fila por pedido con "items": un arreglo JSON (versión con
      JSON_ARRAYAGG). MariaDB lo puede mandar como TEXTO, así que si
      es texto lo convertimos con JSON.parse.
   Si cambia algún nombre en el backend, se corrige SOLO acá. */
function agruparPedidosQr(filas) {
  const pedidos = [];
  const porId = new Map();

  for (const f of filas) {
    let pedido = porId.get(f.id_pedido_qr);
    if (!pedido) {
      pedido = {
        id: f.id_pedido_qr,
        mesa_id: f.id_mesa,
        // el backend lo llama "mesa"; aceptamos también "mesa_numero"
        mesa_numero: f.mesa_numero !== undefined ? f.mesa_numero : f.mesa,
        // estado_mesa 'LIBRE' → hay que pedir las personas al confirmar
        mesa_libre: f.estado_mesa !== undefined
          ? aMinuscula(f.estado_mesa) === 'libre'
          : aBooleano(f.mesa_libre),
        creado_en: f.creado,
        items: []
      };
      porId.set(f.id_pedido_qr, pedido);
      pedidos.push(pedido);
    }

    if (f.items !== undefined && f.items !== null) {
      // Forma b): los ítems vienen todos juntos en "items"
      for (const item of leerListaJson(f.items)) {
        agregarItemQr(pedido, item);
      }
    } else {
      // Forma a): esta fila ES un ítem
      agregarItemQr(pedido, f);
    }
  }
  return pedidos;
}

// Convierte "items" en arreglo, venga como arreglo o como texto JSON.
// Si el texto está mal formado devolvemos [] en vez de romper la pantalla.
function leerListaJson(valor) {
  if (Array.isArray(valor)) return valor;
  try {
    const lista = JSON.parse(valor);
    return Array.isArray(lista) ? lista : [];
  } catch (e) {
    return [];
  }
}

// Agrega un ítem al pedido QR con el formato de las pantallas
function agregarItemQr(pedido, i) {
  if (i.id_item === null || i.id_item === undefined) return;
  pedido.items.push({
    menu_id: i.id_item,
    codigo: i.codigo || '',
    nombre: i.nombre || i.articulo || '',
    cantidad: Number(i.cantidad),
    observaciones: i.observaciones || '',
    precio: Number(i.precio) // precio ACTUAL del menú (el definitivo lo pone el backend al confirmar)
  });
}

/* El menú del QR puede mandar las categorías SIN la letra
   ({ id_categoria, nombre }). Las pantallas trabajan con la letra
   (A, B, D), así que la completamos: la sacamos del código del primer
   plato de esa categoría (A01 → A). Si la categoría no tiene platos,
   usamos el id como clave, para que igual funcione el filtro. */
function completarLetras(categorias, platos) {
  return categorias.map(c => {
    if (c.letra) return c;
    const plato = platos.find(p => p.id_categoria === c.id_categoria && p.codigo);
    return { ...c, letra: plato ? String(plato.codigo)[0] : 'C' + c.id_categoria };
  });
}

/* ---------- Para el CLIENTE (sin usuario) ---------- */

/* Menú de la mesa del QR.
   Devuelve { mesa: { numero }, categorias: [{ codigo, nombre }],
              menu: [{ id, codigo, nombre, descripcion, categoria, precio, disponible }] }
   Las categorías vienen en la misma respuesta porque GET /categorias
   pide token, y el cliente no tiene. */
async function obtenerMenuQr(codigo) {
  if (!USAR_MOCK) {
    const r = await peticion('GET', '/qr/' + encodeURIComponent(codigo) + '/menu');
    const categorias = completarLetras(r.categorias || [], r.menu || []);
    return {
      mesa: { numero: r.mesa.numero },
      categorias: categorias
        .filter(c => c.activa === undefined || aBooleano(c.activa))
        .map(adaptarCategoria)
        .sort((a, b) => a.codigo.localeCompare(b.codigo)),
      menu: (r.menu || []).map(p => adaptarPlatoQr(p, categorias))
    };
  }

  await esperar(DEMORA_MOCK);
  const db = leerMock();
  const mesa = mesaPorCodigoMock(db, codigo);
  return {
    mesa: { numero: mesa.numero },
    categorias: copiar(db.categorias),
    menu: db.menu
      .filter(p => p.activo)
      .map(p => ({
        id: p.id,
        codigo: p.codigo,
        nombre: p.nombre,
        descripcion: p.descripcion || '',
        categoria: p.categoria,
        precio: p.precio,
        disponible: p.disponible
      }))
  };
}

/* El cliente envía su pedido.
   datos = { uid, items: [ { menu_id, cantidad, observaciones } ] }
   El uid lo genera la pantalla UNA vez por pedido y lo reusa si
   reintenta (por ejemplo, si se cortó el wifi): así el backend
   no lo guarda dos veces.
   Devuelve { id } (id de la bandeja). */
async function enviarPedidoQr(codigo, datos) {
  const items = limpiarItemsQr(datos.items);
  validarItemsQr(items);
  if (!datos.uid) throw errorApi('Falta el identificador del envío', 400);

  if (!USAR_MOCK) {
    const r = await peticion('POST', '/qr/' + encodeURIComponent(codigo) + '/pedidos', {
      uid: datos.uid,
      items: items.map(i => ({
        id_item: i.menu_id,
        cantidad: i.cantidad,
        observaciones: i.observaciones
      }))
    });
    return { id: r.id_pedido_qr };
  }

  await esperar(DEMORA_MOCK);
  const db = leerMock();
  const mesa = mesaPorCodigoMock(db, codigo);

  // Mismo uid que uno ya guardado = es un reintento: devolvemos el mismo
  const repetido = db.pedidosQr.find(q => q.uid === datos.uid);
  if (repetido) return { id: repetido.id };

  if (mesa.estado === 'cuenta_pedida') {
    throw errorApi('La cuenta de esta mesa ya fue pedida. Llamá al mozo.', 409);
  }
  // Uno solo esperando por mesa (en la base: mesa_esperando UNIQUE)
  const esperando = db.pedidosQr.find(q => q.mesa_id === mesa.id && q.estado === 'por_confirmar');
  if (esperando) {
    throw errorApi('Ya hay un pedido de esta mesa esperando al mozo. Cuando lo confirme vas a poder pedir de nuevo.', 409);
  }

  for (const item of items) {
    const plato = db.menu.find(p => p.id === item.menu_id && p.activo);
    if (!plato) throw errorApi('Un plato del pedido ya no está en el menú', 400);
    if (!plato.disponible) throw errorApi(plato.nombre + ' está agotado', 409);
  }

  // En la bandeja NO guardamos precio: lo pone el pedido real al confirmar
  db.ultimoIdPedidoQr++;
  const nuevo = {
    id: db.ultimoIdPedidoQr,
    uid: datos.uid,
    mesa_id: mesa.id,
    estado: 'por_confirmar',
    creado_en: new Date().toISOString(),
    resuelto_en: null,
    id_usuario_resuelve: null,
    id_pedido: null,
    items
  };
  db.pedidosQr.push(nuevo);
  guardarMock(db);
  return { id: nuevo.id };
}

/* ---------- Para el MOZO (con sesión) ---------- */

/* Pedidos QR que esperan al mozo, del más viejo al más nuevo.
   Cada uno: { id, mesa_id, mesa_numero, mesa_libre, creado_en,
               items: [{ menu_id, codigo, nombre, cantidad, observaciones, precio }] }
   mesa_libre = true → al confirmar hay que pedir las personas. */
async function obtenerPedidosQr() {
  if (!USAR_MOCK) {
    const filas = await peticion('GET', '/pedidos-qr');
    return agruparPedidosQr(filas);
  }

  await esperar(DEMORA_MOCK);
  const db = leerMock();
  return db.pedidosQr
    .filter(q => q.estado === 'por_confirmar')
    .sort((a, b) => a.creado_en.localeCompare(b.creado_en))
    .map(q => {
      const mesa = db.mesas.find(m => m.id === q.mesa_id);
      return {
        id: q.id,
        mesa_id: q.mesa_id,
        mesa_numero: mesa ? mesa.numero : '?',
        mesa_libre: mesa ? mesa.estado === 'libre' : false,
        creado_en: q.creado_en,
        items: q.items.map(i => {
          const plato = db.menu.find(p => p.id === i.menu_id) || {};
          return {
            menu_id: i.menu_id,
            codigo: plato.codigo || '',
            nombre: plato.nombre || '',
            cantidad: i.cantidad,
            observaciones: i.observaciones,
            precio: plato.precio || 0
          };
        })
      };
    });
}

/* El mozo confirma: el pedido pasa a la comanda y va a cocina.
   personas: OBLIGATORIO solo si la mesa está libre (1 a 20).
   409 si otro mozo ya lo confirmó o lo descartó.
   Si un plato se agotó mientras tanto, da error y el pedido
   SIGUE en la bandeja (el mozo ve qué pasó). */
async function confirmarPedidoQr(idPedidoQr, personas) {
  if (!USAR_MOCK) {
    const cuerpo = personas ? { personas: Number(personas) } : {};
    const r = await peticion('POST', '/pedidos-qr/' + idPedidoQr + '/confirmar', cuerpo);
    return { id_comanda: r.id_comanda, id_pedido: r.id_pedido };
  }

  await esperar(DEMORA_MOCK);
  const db = leerMock();
  const q = db.pedidosQr.find(p => p.id === idPedidoQr);
  if (!q || q.estado !== 'por_confirmar') {
    throw errorApi('Este pedido ya fue confirmado o descartado por otro mozo', 409);
  }
  const mesa = db.mesas.find(m => m.id === q.mesa_id);
  if (!mesa) throw errorApi('La mesa no existe', 404);
  if (mesa.estado === 'cuenta_pedida') {
    throw errorApi('La cuenta de la Mesa ' + mesa.numero + ' ya fue pedida', 409);
  }

  const mesaLibre = mesa.estado === 'libre';
  if (mesaLibre) {
    const n = Number(personas);
    if (!Number.isInteger(n) || n < 1 || n > PERSONAS_MAX) {
      throw errorApi('Indicá cuántas personas hay en la mesa (1 a ' + PERSONAS_MAX + ')', 400);
    }
  }

  // Reusamos crearPedido, igual que el backend reusa sus procedimientos.
  // Si falla (plato agotado), la bandeja queda como estaba.
  const pedido = await crearPedido({
    mesa_id: mesa.id,
    personas: mesaLibre ? Number(personas) : undefined,
    items: q.items
  });

  // crearPedido guardó su propia copia: volvemos a leer antes de marcar
  const db2 = leerMock();
  const q2 = db2.pedidosQr.find(p => p.id === idPedidoQr);
  const mozo = usuarioActual();
  q2.estado = 'confirmado';
  q2.resuelto_en = new Date().toISOString();
  q2.id_usuario_resuelve = mozo ? mozo.id : null;
  q2.id_pedido = pedido.id;
  guardarMock(db2);
  return { id_pedido: pedido.id };
}

/* El mozo descarta el pedido (por ejemplo, fue una broma o el
   cliente se arrepintió). No se borra: queda como "descartado".
   409 si otro mozo ya lo resolvió. */
async function descartarPedidoQr(idPedidoQr) {
  if (!USAR_MOCK) {
    await peticion('POST', '/pedidos-qr/' + idPedidoQr + '/descartar');
    return { ok: true };
  }

  await esperar(DEMORA_MOCK);
  const db = leerMock();
  const q = db.pedidosQr.find(p => p.id === idPedidoQr);
  if (!q || q.estado !== 'por_confirmar') {
    throw errorApi('Este pedido ya fue confirmado o descartado por otro mozo', 409);
  }
  const mozo = usuarioActual();
  q.estado = 'descartado';
  q.resuelto_en = new Date().toISOString();
  q.id_usuario_resuelve = mozo ? mozo.id : null;
  guardarMock(db);
  return { ok: true };
}
/* =========================================================
   CAJA (RF-CAJ) — Incremento 3
   ---------------------------------------------------------
   Todas las rutas son /api/caja/... y solo las puede usar el
   ENCARGADO (el backend responde 403 a los demás).

   La caja NO tiene versión mock: las reglas (turno abierto,
   arqueo solo con efectivo, total que tiene que coincidir) viven
   en los procedimientos de la base (90_caja.sql). Copiarlas acá
   sería tener DOS versiones de las mismas reglas que pueden
   quedar distintas. Con USAR_MOCK = true, la caja avisa que
   necesita el backend real.

   Cómo llegan los datos de la caja:
   - Los importes (DECIMAL) llegan como texto "17000.00" → Number()
   - Las fechas llegan en UTC ("...T02:50:22.000Z"): las dejamos
     así y la pantalla las muestra con toLocaleString("es-AR"),
     que las pasa a la hora local. NO cortar el texto.
   - Formas y tipos llegan en MAYÚSCULA → minúscula, como el resto.
   ========================================================= */

// Las mismas reglas que el backend (cash.controller.js)
const MAX_PAGOS = 4;
const FORMAS_PAGO = ['efectivo', 'transferencia'];
// Medios para el combo de transferencia (a confirmar con la hostería)
const MEDIOS_TRANSFERENCIA = ['BNA+', 'Mercado Pago', 'Naranja X', 'Otro'];
const IMPORTE_MAXIMO = 99999999; // DECIMAL(10,2) de la base

function cajaSoloBackendReal() {
  throw errorApi('La caja funciona solo con el backend real: poné USAR_MOCK = false en api.js', 501);
}

// "17000.00" → 17000. null o vacío → 0
function aImporte(valor) {
  return Number(valor || 0);
}

// Igual que aImporte, pero deja null si no hay dato
// (los datos del cierre son null mientras la caja está abierta)
function aImporteONull(valor) {
  return valor === null || valor === undefined ? null : Number(valor);
}

/* Pasa un importe a CENTAVOS enteros para comparar sumas.
   En JavaScript 0.1 + 0.2 da 0.30000000000000004: si sumamos
   pesos con decimales, una cuenta que "da justo" puede no dar.
   Con enteros eso no pasa. El backend hace lo mismo. */
function aCentavos(importe) {
  return Math.round(Number(importe) * 100);
}

// Importe válido: número, no negativo, con hasta 2 decimales
function validarImporte(valor, nombre, mayorQueCero) {
  const n = Number(valor);
  if (valor === '' || valor === null || valor === undefined || !Number.isFinite(n)) {
    throw errorApi(nombre + ': escribí un importe', 400);
  }
  if (mayorQueCero ? n <= 0 : n < 0) {
    throw errorApi(nombre + (mayorQueCero ? ' tiene que ser mayor que cero' : ' no puede ser negativo'), 400);
  }
  if (n > IMPORTE_MAXIMO) {
    throw errorApi(nombre + ': el importe es demasiado grande', 400);
  }
  // n * 100 tiene que dar un número entero (tolerancia por el redondeo de JS)
  if (Math.abs(n * 100 - Math.round(n * 100)) > 0.000001) {
    throw errorApi(nombre + ': como máximo 2 decimales', 400);
  }
  return n;
}

/* Fila de v_caja_resumen → formato de las pantallas
   estado: 'abierto' | 'cerrado' */
function adaptarTurno(t) {
  if (!t) return null;
  return {
    id: t.id_turno_caja,
    estado: aMinuscula(t.estado),
    apertura: t.apertura,
    cierre: t.cierre || null,
    usuario_apertura: t.usuario_apertura || '',
    usuario_cierre: t.usuario_cierre || '',
    saldo_inicial: aImporte(t.saldo_inicial),
    // Efectivo (lo único que se cuenta en el arqueo)
    ingresos_efectivo: aImporte(t.ingresos_efectivo),
    egresos_efectivo: aImporte(t.egresos_efectivo),
    efectivo_en_caja: aImporte(t.efectivo_en_caja),
    // Transferencias (se muestran aparte: no están en el cajón)
    ingresos_transferencia: aImporte(t.ingresos_transferencia),
    egresos_transferencia: aImporte(t.egresos_transferencia),
    // Todo junto, como el saldo del Excel de la hostería
    saldo_total: aImporte(t.saldo_total),
    cantidad_cobros: Number(t.cantidad_cobros || 0),
    cantidad_sin_cargo: Number(t.cantidad_sin_cargo || 0),
    // Datos del cierre (null mientras está abierto)
    efectivo_contado: aImporteONull(t.efectivo_contado),
    efectivo_esperado: aImporteONull(t.efectivo_esperado),
    total_transferencias: aImporteONull(t.total_transferencias),
    diferencia: aImporteONull(t.diferencia),
    observaciones: t.observaciones || ''
  };
}

// Fila de sp_caja_movimientos → formato de las pantallas
function adaptarMovimiento(m) {
  return {
    id: m.id_movimiento,
    fecha: m.fecha,
    codigo: m.codigo,
    tipo: aMinuscula(m.tipo),          // 'ingreso' | 'egreso'
    concepto: m.concepto || '',
    forma: aMinuscula(m.forma),        // 'efectivo' | 'transferencia'
    medio: m.medio_transferencia || '',
    tipo_comprobante: m.tipo_comprobante || '',
    nro_comprobante: m.nro_comprobante || '',
    dni_cuit: m.dni_cuit || '',
    huesped_proveedor: m.huesped_proveedor || '',
    detalle: m.detalle || '',
    ingreso: aImporte(m.ingreso),
    egreso: aImporte(m.egreso),
    saldo: aImporte(m.saldo),
    es_cobro: m.id_cobro !== null && m.id_cobro !== undefined, // lo generó un cobro de mesa
    usuario: m.usuario || ''
  };
}

/* ---------- COBRO DE UNA MESA (RF-CAJ-04/05) ---------- */

/* Cuenta de la mesa para cobrar: la comanda ABIERTA de esa mesa.
   Devuelve { id_comanda, numero, mesa_numero, personas, mozo,
              total, cuenta_pedida } o null si la mesa no tiene comanda.

   Usamos GET /comandas/abiertas y no la suma de los ítems porque
   el backend compara el total que mandamos con rest_comanda.total:
   tiene que ser EXACTAMENTE el de la base. Si la pantalla lo
   calculara por su cuenta y algo no coincidiera (por ejemplo, un
   ítem anulado), el cobro se rechazaría. */
async function obtenerCuentaMesa(idMesa) {
  if (USAR_MOCK) cajaSoloBackendReal();

  const comandas = await peticion('GET', '/comandas/abiertas');
  const c = comandas.find(x => Number(x.id_mesa) === Number(idMesa));
  if (!c) return null;

  return {
    id_comanda: c.id_comanda,
    numero: c.numero,
    mesa_numero: c.mesa,
    personas: c.personas,
    mozo: c.mozo || '',
    total: aImporte(c.total),
    cuenta_pedida: c.cuenta_pedida !== null && c.cuenta_pedida !== undefined
  };
}

/* Copia SOLO los campos permitidos de cada pago y los ordena.
   pagos = [{ forma: 'efectivo' | 'transferencia', importe, medio }] */
function limpiarPagos(pagos) {
  return (Array.isArray(pagos) ? pagos : []).map(p => ({
    forma: aMinuscula(String(p.forma || '').trim()),
    importe: p.importe,
    medio: String(p.medio || '').trim()
  }));
}

/* Mismas validaciones que el backend. La pantalla las usa para
   avisar ANTES de mandar; la seguridad real sigue siendo el backend. */
function validarCobro(total, pagos, sinCargo, motivo) {
  if (sinCargo) {
    if (!motivo) throw errorApi('Un cobro sin cargo requiere motivo', 400);
    return;
  }
  if (pagos.length === 0 && total > 0) {
    throw errorApi('Falta indicar la forma de pago', 400);
  }
  if (pagos.length > MAX_PAGOS) {
    throw errorApi('Como máximo ' + MAX_PAGOS + ' formas de pago por cobro', 400);
  }
  pagos.forEach((p, i) => {
    const nombre = 'Pago ' + (i + 1);
    if (!FORMAS_PAGO.includes(p.forma)) {
      throw errorApi(nombre + ': forma de pago no permitida', 400);
    }
    p.importe = validarImporte(p.importe, nombre, true);
    if (p.forma === 'transferencia' && !p.medio) {
      throw errorApi(nombre + ': indicá el medio de la transferencia', 400);
    }
  });
  const suma = pagos.reduce((s, p) => s + aCentavos(p.importe), 0);
  if (suma !== aCentavos(total)) {
    throw errorApi('La suma de los pagos (' + formatoPesosSeguro(suma / 100) +
                   ') no coincide con el total (' + formatoPesosSeguro(total) + ')', 400);
  }
}

// formato.js puede no estar cargado en alguna pantalla: por las dudas
function formatoPesosSeguro(numero) {
  return typeof formatoPesos === 'function' ? formatoPesos(numero) : '$ ' + numero;
}

/* Cobra la comanda y la cierra: la mesa queda LIBRE.
   datos = {
     total,                 // el total que se le MOSTRÓ al encargado
     pagos: [{ forma: 'efectivo' | 'transferencia', importe, medio }],
     sin_cargo: false,
     motivo: ''             // obligatorio si sin_cargo es true
   }
   Mandamos el total que se mostró en pantalla: si mientras tanto
   el mozo agregó algo, la base lo detecta ("El total de la cuenta
   cambió") y no se cobra de menos.
   Devuelve { id_cobro, numero_comanda, total }. */
async function cobrarComanda(idComanda, datos) {
  if (USAR_MOCK) cajaSoloBackendReal();

  const total = validarImporte(datos.total, 'Total', false);
  const sinCargo = datos.sin_cargo === true;
  const motivo = String(datos.motivo || '').trim();
  const pagos = sinCargo ? [] : limpiarPagos(datos.pagos);
  validarCobro(total, pagos, sinCargo, motivo);

  const r = await peticion('POST', '/caja/comandas/' + idComanda + '/cobros', {
    total,
    pagos: pagos.map(p => ({
      forma: p.forma.toUpperCase(),
      importe: p.importe,
      medio_transferencia: p.forma === 'transferencia' ? p.medio : ''
    })),
    sin_cargo: sinCargo,
    motivo_sin_cargo: sinCargo ? motivo : ''
  });

  return {
    id_cobro: r.id_cobro,
    numero_comanda: r.numero_comanda,
    total: aImporte(r.total)
  };
}

/* ---------- TURNO DE CAJA (RF-CAJ-01/02/08/09) ---------- */

// Devuelve { abierto: true/false, turno } (turno = null si está cerrada)
async function obtenerTurnoActual() {
  if (USAR_MOCK) cajaSoloBackendReal();
  const r = await peticion('GET', '/caja/turno-actual');
  return { abierto: r.abierto === true, turno: adaptarTurno(r.turno) };
}

// Abre la caja con el efectivo que hay en el cajón. Devuelve { id }
async function abrirCaja(saldoInicial) {
  if (USAR_MOCK) cajaSoloBackendReal();
  const saldo = validarImporte(saldoInicial, 'Saldo inicial', false);
  const r = await peticion('POST', '/caja/turnos/apertura', { saldo_inicial: saldo });
  return { id: r.id_turno_caja };
}

// Resumen de un turno (abierto o cerrado)
async function obtenerTurno(idTurno) {
  if (USAR_MOCK) cajaSoloBackendReal();
  return adaptarTurno(await peticion('GET', '/caja/turnos/' + idTurno));
}

// Historial de turnos, del más nuevo al más viejo (máx. 100)
async function obtenerTurnos(cantidad) {
  if (USAR_MOCK) cajaSoloBackendReal();
  const n = Number(cantidad) || 30;
  const filas = await peticion('GET', '/caja/turnos?cantidad=' + n);
  return filas.map(adaptarTurno);
}

/* Cierre con arqueo: el encargado cuenta el EFECTIVO del cajón.
   La base calcula lo esperado y la diferencia. Las transferencias
   no se cuentan (no están en el cajón): se informan aparte.
   (propuesta) Si hay diferencia, las observaciones son obligatorias:
   eso lo controla la base y devuelve el mensaje.
   Devuelve el turno cerrado (con esperado, contado y diferencia). */
async function cerrarCaja(idTurno, efectivoContado, observaciones) {
  if (USAR_MOCK) cajaSoloBackendReal();
  const contado = validarImporte(efectivoContado, 'Efectivo contado', false);
  const r = await peticion('POST', '/caja/turnos/' + idTurno + '/cierre', {
    efectivo_contado: contado,
    observaciones: String(observaciones || '').trim()
  });
  return adaptarTurno(r);
}

// Reabre el último turno cerrado (propuesta). Motivo: 5 letras o más.
async function reabrirCaja(idTurno, motivo) {
  if (USAR_MOCK) cajaSoloBackendReal();
  const texto = String(motivo || '').trim();
  if (texto.length < 5) throw errorApi('Para reabrir la caja hay que escribir el motivo', 400);
  const r = await peticion('POST', '/caja/turnos/' + idTurno + '/reapertura', { motivo: texto });
  return adaptarTurno(r);
}

/* ---------- MOVIMIENTOS (RF-CAJ-06/07) ---------- */

// Movimientos de un turno, en el orden en que se hicieron
async function obtenerMovimientos(idTurno) {
  if (USAR_MOCK) cajaSoloBackendReal();
  const filas = await peticion('GET', '/caja/turnos/' + idTurno + '/movimientos');
  return filas.map(adaptarMovimiento);
}

// Códigos para movimientos manuales: [{ codigo, concepto, tipo: 'ingreso' | 'egreso' }]
// (COBRO no viene: ese lo genera solo el sistema al cobrar una mesa)
async function obtenerCodigosCaja() {
  if (USAR_MOCK) cajaSoloBackendReal();
  const filas = await peticion('GET', '/caja/codigos');
  return filas.map(c => ({ codigo: c.codigo, concepto: c.concepto, tipo: aMinuscula(c.tipo) }));
}

/* Movimiento manual (gasto, pago a proveedor, ajuste).
   datos = { codigo, forma, medio, importe, concepto, tipo_comprobante,
             nro_comprobante, dni_cuit, huesped_proveedor, detalle }
   Si suma o resta lo decide el TIPO del código, no la pantalla.
   Devuelve { id, saldo }. */
async function registrarMovimiento(datos) {
  if (USAR_MOCK) cajaSoloBackendReal();

  const forma = aMinuscula(String(datos.forma || 'efectivo').trim());
  const medio = String(datos.medio || '').trim();
  if (!String(datos.codigo || '').trim()) throw errorApi('Elegí el código del movimiento', 400);
  if (!FORMAS_PAGO.includes(forma)) throw errorApi('Forma no permitida', 400);
  if (forma === 'transferencia' && !medio) throw errorApi('Indicá el medio de la transferencia', 400);
  const importe = validarImporte(datos.importe, 'Importe', true);

  // Copiamos SOLO los campos permitidos
  const r = await peticion('POST', '/caja/movimientos', {
    codigo: String(datos.codigo).trim(),
    forma: forma.toUpperCase(),
    medio_transferencia: forma === 'transferencia' ? medio : '',
    importe,
    concepto: String(datos.concepto || '').trim(),
    tipo_comprobante: String(datos.tipo_comprobante || '').trim(),
    nro_comprobante: String(datos.nro_comprobante || '').trim(),
    dni_cuit: String(datos.dni_cuit || '').trim(),
    huesped_proveedor: String(datos.huesped_proveedor || '').trim(),
    detalle: String(datos.detalle || '').trim()
  });
  return { id: r.id_movimiento, saldo: aImporte(r.saldo) };
}

/* =========================================================
   ESTADÍSTICAS (RF-EST) — Incremento 3
   ---------------------------------------------------------
   Rutas /api/estadisticas/... solo para el ENCARGADO (el
   backend responde 403 a los demás).

   Igual que la caja, NO tiene mock: los cálculos (qué cuenta
   como venta, sumas por forma de pago, agrupar por semana o mes)
   viven en 95_estadisticas.sql. Copiarlos acá sería tener dos
   versiones de las mismas reglas.

   Fechas: se mandan como texto 'AAAA-MM-DD' armado con la fecha
   LOCAL (no con toISOString(), que usa UTC: después de las 21 h
   de Argentina ya daría el día siguiente).

   Períodos: la base los devuelve como texto, igual que acá:
   - semana: '2026-11-23' (el LUNES de esa semana)
   - mes:    '2026-11'
   ========================================================= */

const AGRUPACIONES_EST = ['semana', 'mes'];
const MAX_DIAS_EST = 400; // (propuesta) el mismo límite que el backend
const MS_POR_DIA = 24 * 60 * 60 * 1000;

function estSoloBackendReal() {
  throw errorApi('Las estadísticas funcionan solo con el backend real: poné USAR_MOCK = false en api.js', 501);
}

/* ---------- Ayudas de fechas (también las usa la pantalla) ---------- */

// Date → 'AAAA-MM-DD' usando la fecha LOCAL del navegador
function fechaATexto(fecha) {
  const a = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  return a + '-' + m + '-' + d;
}

// 'AAAA-MM-DD' → Date local a las 00:00. Devuelve null si el texto
// no tiene ese formato o el día no existe (por ejemplo 2026-02-31).
function textoAFecha(texto) {
  const t = String(texto || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const [a, m, d] = t.split('-').map(Number);
  const f = new Date(a, m - 1, d);
  if (f.getFullYear() !== a || f.getMonth() !== m - 1 || f.getDate() !== d) return null;
  return f;
}

// Lunes de la semana de una fecha.
// getDay() da domingo = 0 ... sábado = 6. Con (getDay() + 6) % 7 queda
// lunes = 0 ... domingo = 6, igual que WEEKDAY() de MariaDB.
function lunesDe(fecha) {
  const f = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
  f.setDate(f.getDate() - (f.getDay() + 6) % 7);
  return f;
}

// Semana (lunes a domingo) que contiene la fecha. Sin fecha: la de hoy.
// Devuelve { desde, hasta } en texto 'AAAA-MM-DD'.
function rangoSemana(fecha) {
  const lunes = lunesDe(fecha || new Date());
  const domingo = new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + 6);
  return { desde: fechaATexto(lunes), hasta: fechaATexto(domingo) };
}

// Mes completo que contiene la fecha. Sin fecha: el mes actual.
// El día 0 del mes siguiente es el último día de este mes.
function rangoMes(fecha) {
  const f = fecha || new Date();
  const primero = new Date(f.getFullYear(), f.getMonth(), 1);
  const ultimo = new Date(f.getFullYear(), f.getMonth() + 1, 0);
  return { desde: fechaATexto(primero), hasta: fechaATexto(ultimo) };
}

// Mismas validaciones que el backend. Devuelve las dos fechas como Date.
function validarPeriodoEst(desde, hasta) {
  const fd = textoAFecha(desde);
  const fh = textoAFecha(hasta);
  if (!fd) throw errorApi('La fecha desde no es válida', 400);
  if (!fh) throw errorApi('La fecha hasta no es válida', 400);
  if (fd > fh) throw errorApi('La fecha desde no puede ser posterior a la fecha hasta', 400);
  if (Math.round((fh - fd) / MS_POR_DIA) > MAX_DIAS_EST) {
    throw errorApi('El período no puede ser mayor a un año', 400);
  }
  return { fd, fh };
}

/* Todos los períodos entre dos fechas, con el MISMO texto que arma la
   base. Sirve para completar con ceros las semanas o meses sin cobros:
   así el gráfico muestra la barra vacía en vez de saltearse la semana
   (si no, parecería que no faltó ninguna). */
function periodosEntre(fd, fh, agrupar) {
  const lista = [];
  if (agrupar === 'mes') {
    const f = new Date(fd.getFullYear(), fd.getMonth(), 1);
    while (f <= fh) {
      lista.push(fechaATexto(f).slice(0, 7)); // '2026-11-01' → '2026-11'
      f.setMonth(f.getMonth() + 1);
    }
  } else {
    // La primera semana empieza el lunes anterior (o igual) a "desde",
    // igual que en la base: un cobro del domingo 1/11 va a la semana
    // del lunes 26/10.
    const f = lunesDe(fd);
    while (f <= fh) {
      lista.push(fechaATexto(f));
      f.setDate(f.getDate() + 7);
    }
  }
  return lista;
}

/* ---------- Adaptadores ---------- */

// Fila de sp_est_platos → formato de las pantallas
function adaptarPlatoVendido(f) {
  return {
    id: f.id_item,
    codigo: f.codigo,
    nombre: f.nombre,
    categoria: f.letra,                 // letra, como en el resto de las pantallas
    categoria_nombre: f.categoria,
    cantidad: Number(f.cantidad || 0),
    importe: aImporte(f.importe),
    cantidad_sin_cargo: Number(f.cantidad_sin_cargo || 0)
  };
}

// Fila de sp_est_ingresos → formato de las pantallas.
// Si el período no tuvo cobros (f vacío), queda todo en 0.
function adaptarIngreso(periodo, f) {
  const x = f || {};
  return {
    periodo,
    efectivo: aImporte(x.efectivo),
    transferencia: aImporte(x.transferencia),
    cargo_habitacion: aImporte(x.cargo_habitacion), // 0 hasta habilitar RF-HAB
    total: aImporte(x.total),
    cantidad_cobros: Number(x.cantidad_cobros || 0),
    cantidad_sin_cargo: Number(x.cantidad_sin_cargo || 0),
    valor_sin_cargo: aImporte(x.valor_sin_cargo)
  };
}

/* ---------- Funciones públicas ---------- */

/* Ranking de platos vendidos (RF-EST-01), del más vendido al menos.
   desde, hasta: 'AAAA-MM-DD' (días incluidos)
   letraCategoria: 'A', 'B', 'D'... o vacío para todas
   Devuelve [{ id, codigo, nombre, categoria, categoria_nombre,
               cantidad, importe, cantidad_sin_cargo }] */
async function obtenerRankingPlatos(desde, hasta, letraCategoria) {
  if (USAR_MOCK) estSoloBackendReal();
  validarPeriodoEst(desde, hasta);

  // Las pantallas trabajan con la LETRA; la base, con id_categoria
  let idCategoria = 0; // 0 = todas
  const letra = String(letraCategoria || '').trim().toUpperCase();
  if (letra) {
    const categorias = await categoriasDelServidor();
    const c = categorias.find(x => x.letra === letra);
    if (!c) throw errorApi('La categoría no existe', 400);
    idCategoria = c.id_categoria;
  }

  const filas = await peticion('GET', '/estadisticas/platos' +
    '?desde=' + encodeURIComponent(desde) +
    '&hasta=' + encodeURIComponent(hasta) +
    '&categoria=' + idCategoria);
  return filas.map(adaptarPlatoVendido);
}

/* Ingresos por semana o por mes, por forma de pago (RF-EST-02).
   agrupar: 'semana' | 'mes'
   Devuelve UNA fila por período, TODOS los períodos del rango
   (los que no tuvieron cobros vienen en 0), del más viejo al más nuevo:
   [{ periodo, efectivo, transferencia, cargo_habitacion, total,
      cantidad_cobros, cantidad_sin_cargo, valor_sin_cargo }] */
async function obtenerIngresos(desde, hasta, agrupar) {
  if (USAR_MOCK) estSoloBackendReal();
  const { fd, fh } = validarPeriodoEst(desde, hasta);

  const modo = aMinuscula(String(agrupar || 'semana').trim());
  if (!AGRUPACIONES_EST.includes(modo)) {
    throw errorApi('Agrupar tiene que ser por semana o por mes', 400);
  }

  const filas = await peticion('GET', '/estadisticas/ingresos' +
    '?desde=' + encodeURIComponent(desde) +
    '&hasta=' + encodeURIComponent(hasta) +
    '&agrupar=' + modo.toUpperCase());

  // Map periodo → fila, para encontrar rápido cada período
  const porPeriodo = new Map(filas.map(f => [f.periodo, f]));
  return periodosEntre(fd, fh, modo).map(p => adaptarIngreso(p, porPeriodo.get(p)));
}

/* =========================================================
   USUARIOS — ABM (RF-USU-03)
   ---------------------------------------------------------
   Rutas /api/usuarios/... solo para el ENCARGADO (el backend
   responde 403 a los demás).

   Sin versión mock, igual que la caja: las reglas (no quedarse
   sin encargado, no desactivarse a uno mismo, usuarios que también
   son de reservas o stock) viven en usuarios.controller.js.

   La tabla "usuario" la comparten los tres sistemas: el backend
   solo devuelve y toca los usuarios con rol en el restaurante.
   Un usuario nunca se borra: se desactiva.
   ========================================================= */

const ROLES_USUARIO = ['encargado', 'mozo', 'cocina'];
// Las mismas reglas que el backend
const FORMATO_USUARIO_LOGIN = /^[a-zA-Z0-9._-]{3,50}$/;
const LARGO_MIN_CLAVE = 8;

function usuariosSoloBackendReal() {
  throw errorApi('Los usuarios funcionan solo con el backend real: poné USAR_MOCK = false en api.js', 501);
}

// Fila del backend → formato de las pantallas (rol en minúscula, como el login)
function adaptarUsuario(u) {
  return {
    id: u.id_usuario,
    nombre: u.nombre,
    usuario: u.usuario,
    rol: aMinuscula(u.rol),
    activo: aBooleano(u.activo),
    creado: u.creado,
    otros_sistemas: aBooleano(u.otros_sistemas) // true = también lo usa reservas o stock
  };
}

/* ---------- Validaciones (las mismas que el backend) ---------- */

function validarNombreUsuario(nombre) {
  if (nombre.length < 2 || nombre.length > 100) {
    throw errorApi('El nombre debe tener entre 2 y 100 letras', 400);
  }
}

function validarRolUsuario(rol) {
  if (!ROLES_USUARIO.includes(rol)) {
    throw errorApi('Elegí un rol: encargado, mozo o cocina', 400);
  }
}

function validarClaveUsuario(clave) {
  if (typeof clave !== 'string' || clave.length < LARGO_MIN_CLAVE) {
    throw errorApi('La contraseña debe tener al menos ' + LARGO_MIN_CLAVE + ' caracteres', 400);
  }
}

function validarIdUsuario(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) {
    throw errorApi('No se encontró el usuario. Actualizá la pantalla.', 400);
  }
  return n;
}

/* ---------- Funciones públicas ---------- */

// Lista de usuarios del restaurante (activos primero)
async function obtenerUsuarios() {
  if (USAR_MOCK) usuariosSoloBackendReal();
  const filas = await peticion('GET', '/usuarios');
  return filas.map(adaptarUsuario);
}

/* Alta. datos = { nombre, usuario, clave, rol: 'mozo' }
   409 si el usuario ya existe (puede ser de reservas o stock).
   Devuelve { id }. */
async function crearUsuario(datos) {
  if (USAR_MOCK) usuariosSoloBackendReal();

  const nombre = String(datos.nombre || '').trim();
  const usuario = String(datos.usuario || '').trim();
  const rol = aMinuscula(String(datos.rol || '').trim());
  const clave = datos.clave;

  validarNombreUsuario(nombre);
  if (!FORMATO_USUARIO_LOGIN.test(usuario)) {
    throw errorApi('El usuario debe tener de 3 a 50 caracteres: letras, números, punto, guion o guion bajo, sin espacios', 400);
  }
  validarClaveUsuario(clave);
  validarRolUsuario(rol);

  const r = await peticion('POST', '/usuarios', {
    nombre,
    usuario,
    clave,
    rol: rol.toUpperCase() // el backend usa MAYÚSCULA
  });
  return { id: r.id_usuario };
}

/* Editar nombre y rol. datos = { nombre, rol }
   El usuario del login no se cambia (propuesta).
   409 si es el último encargado o si se quita a sí mismo el rol. */
async function editarUsuario(idUsuario, datos) {
  if (USAR_MOCK) usuariosSoloBackendReal();

  const id = validarIdUsuario(idUsuario);
  const nombre = String(datos.nombre || '').trim();
  const rol = aMinuscula(String(datos.rol || '').trim());
  validarNombreUsuario(nombre);
  validarRolUsuario(rol);

  await peticion('PUT', '/usuarios/' + id, { nombre, rol: rol.toUpperCase() });
  return { id, nombre, rol };
}

/* Nueva contraseña (mínimo 8). Viaja una sola vez y el backend
   guarda solo el hash. Devuelve { otros_sistemas }: si es true,
   la contraseña también cambió en reservas o stock. */
async function cambiarClaveUsuario(idUsuario, clave) {
  if (USAR_MOCK) usuariosSoloBackendReal();

  const id = validarIdUsuario(idUsuario);
  validarClaveUsuario(clave);

  const r = await peticion('PATCH', '/usuarios/' + id + '/clave', { clave });
  return { otros_sistemas: r.otros_sistemas === true };
}

/* Activar (true) o desactivar (false).
   409: desactivarse a uno mismo, último encargado o usuario de otro sistema. */
async function cambiarActivoUsuario(idUsuario, activo) {
  if (USAR_MOCK) usuariosSoloBackendReal();

  const id = validarIdUsuario(idUsuario);
  if (typeof activo !== 'boolean') throw errorApi('Activo debe ser verdadero o falso', 400);

  await peticion('PATCH', '/usuarios/' + id + '/activo', { activo });
  return { id, activo };
}