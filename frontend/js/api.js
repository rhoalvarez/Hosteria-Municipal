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

   Necesita que sesion.js esté cargado antes (usa obtenerSesion).
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
    { id: 1, codigo: 'A01', nombre: 'Milanesa con papas fritas', categoria: 'A', precio: 9500, disponible: true, activo: true },
    { id: 2, codigo: 'A02', nombre: 'Empanadas (docena)',        categoria: 'A', precio: 12000, disponible: true, activo: true },
    { id: 3, codigo: 'A03', nombre: 'Locro',                     categoria: 'A', precio: 8000, disponible: true, activo: true },
    { id: 4, codigo: 'A04', nombre: 'Cabrito al horno',          categoria: 'A', precio: 15000, disponible: false, activo: true },
    { id: 5, codigo: 'B01', nombre: 'Agua mineral 500 ml',       categoria: 'B', precio: 1500, disponible: true, activo: true },
    { id: 6, codigo: 'B02', nombre: 'Gaseosa 500 ml',            categoria: 'B', precio: 2000, disponible: true, activo: true },
    { id: 7, codigo: 'B03', nombre: 'Vino tinto (copa)',         categoria: 'B', precio: 3000, disponible: true, activo: true },
    { id: 8, codigo: 'D01', nombre: 'Café con leche',            categoria: 'D', precio: 1800, disponible: true, activo: true },
    { id: 9, codigo: 'D02', nombre: 'Tostado de jamón y queso',  categoria: 'D', precio: 3500, disponible: true, activo: true }
  ],
  // 12 mesas, como en el Excel actual (a confirmar con la hostería)
  mesas: Array.from({ length: 12 }, (_, i) => ({ id: i + 1, numero: i + 1, estado: 'libre' })),
  pedidos: [],
  ultimoIdPedido: 0,
  ultimoIdPlato: 9
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
    if (texto) return JSON.parse(texto);
  } catch (e) { /* si falla, arrancamos de cero */ }
  const nueva = copiar(DATOS_INICIALES);
  guardarMock(nueva);
  return nueva;
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

// Usuario actual (para saber qué mozo hace el pedido)
function usuarioActual() {
  const sesion = obtenerSesion();
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

  const sesion = obtenerSesion();
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
let categoriasCache = null;

async function categoriasDelServidor() {
  if (!categoriasCache) {
    categoriasCache = await peticion('GET', '/categorias');
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

// { id_mesa, numero, estado: 'CUENTA_PEDIDA' } → { id, numero, estado: 'cuenta_pedida' }
function adaptarMesa(m) {
  return { id: m.id_mesa, numero: m.numero, estado: aMinuscula(m.estado) };
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

async function obtenerMesas() {
  if (!USAR_MOCK) {
    const mesas = await peticion('GET', '/mesas');
    return mesas
      .filter(m => aBooleano(m.activa)) // las mesas desactivadas no se muestran
      .map(adaptarMesa);
  }

  await esperar(DEMORA_MOCK);
  return leerMock().mesas;
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
// Estados: por_confirmar (solo QR) | pendiente | en_preparacion | listo

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

    /* ⚠️ Por ahora sp_cocina_pedidos NO devuelve el número de mesa
       (pendiente de Rosario: agregar m.numero AS mesa_numero).
       Mientras tanto mostramos "Mesa ?" en vez de "Mesa null".
       Cuando el backend lo mande, se usa solo, sin tocar nada más.
       No lo buscamos con otra consulta (GET /mesas) porque serían
       peticiones extra cada 10 s y cocina quizás no tiene permiso. */
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