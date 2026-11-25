// =============================================================
// qr.js – Pantalla del CLIENTE para pedir desde la mesa (Inc. 2 – RF-QR)
//
// URL:  qr.html?c=CODIGO   (CODIGO = rest_mesa.codigo_qr, impreso en el QR)
//
// Flujo: ver el menú → elegir platos (+ / −) → ver resumen →
//        observaciones → "Enviar al mozo" → confirmación.
//
// El pedido NO va directo a cocina: queda "por confirmar" hasta que
// el mozo lo revisa (RF-QR-05). El cliente no inicia sesión.
// =============================================================

// ---------- Límites (los mismos que valida api.js y el backend) ----------
// CANTIDAD_MAX_QR y LARGO_MAX_OBS_QR están definidos en api.js
const INTERVALO_MENU = 5000;   // ms: RNF-REN-02 pide ver un agotado en 5 s o menos

// ---------- Código de la mesa (viene en la URL del QR) ----------
const parametros = new URLSearchParams(window.location.search);
const codigo = String(parametros.get('c') || '').trim();
// Solo letras, números, guion y guion bajo: así nada raro llega a la URL de la API
const FORMATO_CODIGO_QR = /^[A-Za-z0-9_-]{4,64}$/;

// ---------- Estado de la pantalla ----------
let menu = [];               // platos activos (con su campo "disponible")
let categorias = [];
let categoriaElegida = 'todas';
let textoBusqueda = '';
let enviando = false;        // evita que un doble toque mande el pedido dos veces
let temporizador = null;     // actualización automática del menú
let sinConexion = false;     // si se está mostrando el aviso de wifi

// Pedido en armado: menu_id → { cantidad, observaciones }
// Map, como en la pantalla del mozo: guarda el orden en que se agregaron.
const pedido = new Map();

/* Identificador del envío. Se genera al tocar "Enviar" y se REUSA si
   el envío falla y el cliente reintenta SIN cambiar nada: si el primer
   intento sí había llegado (se cortó el wifi justo en la respuesta),
   el backend reconoce el uid y no lo guarda dos veces.
   Si el cliente CAMBIA el pedido, el uid se descarta: es otro pedido. */
let uidEnvio = null;

// Borrador en sessionStorage: si el celular recarga la página no se
// pierde lo elegido. Se borra al enviar o al cerrar la pestaña.
const CLAVE_BORRADOR = 'rest_qr_borrador_' + codigo;

// ---------- Elementos de la página ----------
const elTitulo = document.getElementById('titulo-mesa');
const elSubtitulo = document.getElementById('subtitulo');
const elAviso = document.getElementById('aviso');
const elZonaMenu = document.getElementById('zona-menu');
const elBuscar = document.getElementById('buscar');
const elCategorias = document.getElementById('categorias');
const elListaMenu = document.getElementById('lista-menu');
const elZonaEnviado = document.getElementById('zona-enviado');
const btnOtroPedido = document.getElementById('btn-otro-pedido');
const elBarra = document.getElementById('barra-pedido');
const btnVerPedido = document.getElementById('btn-ver-pedido');
const elFondoPanel = document.getElementById('fondo-panel');
const elListaResumen = document.getElementById('lista-resumen');
const elTotalResumen = document.getElementById('total-resumen');
const elErrorEnvio = document.getElementById('error-envio');
const btnSeguir = document.getElementById('btn-seguir');
const btnEnviar = document.getElementById('btn-enviar');


// =============================================================
// INICIO
// =============================================================
async function iniciar() {
  // 1) Validar el código antes de pedir nada a la API
  if (!FORMATO_CODIGO_QR.test(codigo)) {
    bloquear('Este código QR no es válido. Pedile ayuda al mozo.');
    return;
  }

  // 2) Traer la mesa, las categorías y el menú (una sola petición)
  try {
    const datos = await obtenerMenuQr(codigo);
    categorias = datos.categorias;
    menu = datos.menu;
    elTitulo.textContent = 'Mesa ' + datos.mesa.numero;
    document.title = 'Mesa ' + datos.mesa.numero + ' – Portal de la Luna';
  } catch (error) {
    if (error && error.estado === 404) {
      bloquear(error.message);
    } else {
      bloquear('No se pudo cargar el menú. Revisá que estés conectado al wifi de la hostería y recargá la página.');
    }
    return;
  }

  elSubtitulo.textContent = 'Portal de la Luna · Elegí tus platos';
  elZonaMenu.hidden = false;
  elBarra.hidden = false;

  recuperarBorrador();
  dibujarCategorias();
  dibujarMenu();
  actualizarBarra();
  programarActualizacion();
}


// =============================================================
// ACTUALIZACIÓN AUTOMÁTICA DEL MENÚ (cada 5 s)
// Igual que mesas y cocina: setTimeout encadenado (no setInterval),
// así nunca se pisan dos consultas si el wifi está lento.
// =============================================================

function programarActualizacion() {
  clearTimeout(temporizador);
  temporizador = setTimeout(actualizarMenu, INTERVALO_MENU);
}

async function actualizarMenu() {
  // Pantalla oculta o ya se envió el pedido: no consultamos.
  // Se reanuda al volver (visibilitychange) o con "Hacer otro pedido".
  if (document.hidden || elZonaMenu.hidden) return;

  try {
    const datos = await obtenerMenuQr(codigo);
    ocultarAvisoConexion();

    // Solo redibujamos si cambió algo (por ejemplo, un plato se agotó)
    if (JSON.stringify(datos.menu) !== JSON.stringify(menu)) {
      menu = datos.menu;
      dibujarMenu();
      actualizarBarra();
      // Si el resumen está abierto lo actualizamos, MENOS si el cliente
      // está escribiendo una observación (se le cerraría el teclado).
      // Si algo se agotó, igual lo frena el envío.
      if (!elFondoPanel.hidden && !estaEscribiendo()) dibujarResumen();
    }
  } catch (error) {
    if (error && error.estado === 404) {
      // El código dejó de existir (por ejemplo, desactivaron la mesa)
      bloquear(error.message);
      return;
    }
    mostrarAvisoConexion();
  }

  programarActualizacion();
}

function estaEscribiendo() {
  const activo = document.activeElement;
  return activo && activo.tagName === 'INPUT' && elListaResumen.contains(activo);
}


// =============================================================
// MENÚ: categorías, búsqueda y lista de platos
// =============================================================

// Saca acentos y pasa a minúsculas: "Café" y "cafe" se encuentran igual
function normalizar(texto) {
  return String(texto).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function platosFiltrados() {
  const texto = normalizar(textoBusqueda.trim());

  return menu.filter(function (plato) {
    // Si el cliente escribe algo, se busca en TODAS las categorías
    if (texto !== '') {
      return normalizar(plato.nombre).includes(texto) ||
             normalizar(plato.descripcion).includes(texto);
    }
    // plato.categoria guarda la LETRA de la categoría ('A', 'B', 'D')
    return categoriaElegida === 'todas' || plato.categoria === categoriaElegida;
  });
}

function dibujarCategorias() {
  elCategorias.replaceChildren();

  const opciones = [{ codigo: 'todas', nombre: 'Todas' }].concat(categorias);

  for (const categoria of opciones) {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'pedido-categoria';
    boton.textContent = categoria.nombre;
    boton.dataset.categoria = categoria.codigo;
    // aria-pressed indica cuál está elegida (y el CSS lo usa para pintarla)
    boton.setAttribute('aria-pressed', String(categoria.codigo === categoriaElegida));
    elCategorias.appendChild(boton);
  }
}

function dibujarMenu() {
  const platos = platosFiltrados();
  elListaMenu.replaceChildren();

  if (platos.length === 0) {
    const vacio = document.createElement('li');
    vacio.className = 'plato-vacio';
    vacio.textContent = 'No hay platos que coincidan.';
    elListaMenu.appendChild(vacio);
    return;
  }

  for (const plato of platos) {
    elListaMenu.appendChild(crearItemMenu(plato));
  }
}

function crearItemMenu(plato) {
  const li = document.createElement('li');
  li.className = plato.disponible ? 'plato' : 'plato plato--agotado';

  // Datos del plato. El cliente no ve el código interno (A01, B02...):
  // ve nombre, descripción y precio (RF-QR-02)
  const info = document.createElement('div');
  info.className = 'plato-info';
  info.appendChild(crearTexto('span', 'plato-nombre', plato.nombre));
  if (plato.descripcion) {
    info.appendChild(crearTexto('span', 'plato-descripcion', plato.descripcion));
  }
  info.appendChild(crearTexto('span', 'plato-precio', formatoPesos(plato.precio)));
  li.appendChild(info);

  // Controles
  const controles = document.createElement('div');
  controles.className = 'controles';

  if (!plato.disponible) {
    controles.appendChild(crearTexto('span', 'etiqueta-agotado', 'No disponible'));
  } else {
    const cantidad = pedido.has(plato.id) ? pedido.get(plato.id).cantidad : 0;

    if (cantidad === 0) {
      controles.appendChild(crearBoton('Agregar', 'sumar', plato.id, 'boton-agregar',
        'Agregar ' + plato.nombre));
    } else {
      controles.appendChild(crearBoton('−', 'restar', plato.id, 'boton-cantidad',
        'Quitar uno de ' + plato.nombre));
      controles.appendChild(crearTexto('span', 'cantidad', String(cantidad)));
      controles.appendChild(crearBoton('+', 'sumar', plato.id, 'boton-cantidad',
        'Agregar uno de ' + plato.nombre));
    }
  }

  li.appendChild(controles);
  return li;
}


// =============================================================
// PEDIDO EN ARMADO
// =============================================================

function buscarPlato(id) {
  return menu.find(function (plato) { return plato.id === id; });
}

function cambiarCantidad(id, diferencia) {
  const linea = pedido.get(id) || { cantidad: 0, observaciones: '' };
  const nueva = linea.cantidad + diferencia;

  if (nueva <= 0) {
    pedido.delete(id);
  } else {
    linea.cantidad = Math.min(nueva, CANTIDAD_MAX_QR);
    pedido.set(id, linea);
  }

  pedidoCambiado();
  dibujarMenu();
  actualizarBarra();
  if (!elFondoPanel.hidden) dibujarResumen();
}

// Cualquier cambio en el pedido: es OTRO pedido → uid nuevo al enviar
function pedidoCambiado() {
  uidEnvio = null;
  guardarBorrador();
}

function calcularTotales() {
  let platos = 0;
  let total = 0;

  pedido.forEach(function (linea, id) {
    const plato = buscarPlato(id);
    platos += linea.cantidad;
    if (plato) total += plato.precio * linea.cantidad;
  });

  return { platos: platos, total: total };
}

function actualizarBarra() {
  const totales = calcularTotales();

  if (totales.platos === 0) {
    btnVerPedido.textContent = 'Elegí tus platos';
    btnVerPedido.disabled = true;
  } else {
    btnVerPedido.textContent = 'Ver mi pedido (' + totales.platos + ') · ' + formatoPesos(totales.total);
    btnVerPedido.disabled = false;
  }
}

// ---------- Borrador (sessionStorage) ----------
// Se guardan los platos Y el uid del envío pendiente (si hubo un intento)
function guardarBorrador() {
  try {
    sessionStorage.setItem(CLAVE_BORRADOR, JSON.stringify({
      items: Array.from(pedido),   // un Map no pasa directo a JSON: lista de pares
      uid: uidEnvio
    }));
  } catch (error) {
    // Si el navegador no deja guardar, no es grave: el pedido sigue en memoria
  }
}

function recuperarBorrador() {
  try {
    const guardado = JSON.parse(sessionStorage.getItem(CLAVE_BORRADOR));
    if (!guardado || !Array.isArray(guardado.items)) return;

    for (const par of guardado.items) {
      const id = par[0];
      const linea = par[1];
      // Solo platos que siguen en el menú (si alguno se agotó, el resumen lo avisa)
      if (buscarPlato(id) && linea && linea.cantidad > 0) {
        pedido.set(id, {
          cantidad: Math.min(linea.cantidad, CANTIDAD_MAX_QR),
          observaciones: String(linea.observaciones || '').slice(0, LARGO_MAX_OBS_QR)
        });
      }
    }
    if (typeof guardado.uid === 'string') uidEnvio = guardado.uid;
  } catch (error) {
    // Borrador roto: se ignora
  }
}

function borrarBorrador() {
  try {
    sessionStorage.removeItem(CLAVE_BORRADOR);
  } catch (error) { /* nada */ }
}


// =============================================================
// PANEL DE RESUMEN
// =============================================================

function abrirResumen() {
  ocultarErrorEnvio();
  dibujarResumen();
  elFondoPanel.hidden = false;
  btnSeguir.focus();
}

function cerrarResumen() {
  if (enviando) return;   // no cerrar a mitad del envío
  elFondoPanel.hidden = true;
  btnVerPedido.focus();
}

function dibujarResumen() {
  elListaResumen.replaceChildren();
  let hayAgotados = false;

  pedido.forEach(function (linea, id) {
    const plato = buscarPlato(id);
    const agotado = !plato || !plato.disponible;
    if (agotado) hayAgotados = true;

    const li = document.createElement('li');
    li.className = agotado ? 'linea linea--agotada' : 'linea';

    // Fila 1: nombre y subtotal
    const cabecera = document.createElement('div');
    cabecera.className = 'linea-cabecera';
    cabecera.appendChild(crearTexto('span', 'linea-nombre',
      plato ? plato.nombre : 'Plato que ya no está en el menú'));
    cabecera.appendChild(crearTexto('span', 'linea-subtotal',
      plato ? formatoPesos(plato.precio * linea.cantidad) : ''));
    li.appendChild(cabecera);

    if (agotado) {
      li.appendChild(crearTexto('p', 'linea-aviso', 'Se terminó: quitalo para poder enviar.'));
    }

    // Fila 2: cantidad y quitar
    const controles = document.createElement('div');
    controles.className = 'controles';
    if (!agotado) {
      controles.appendChild(crearBoton('−', 'restar', id, 'boton-cantidad', 'Quitar uno'));
      controles.appendChild(crearTexto('span', 'cantidad', String(linea.cantidad)));
      controles.appendChild(crearBoton('+', 'sumar', id, 'boton-cantidad', 'Agregar uno'));
    }
    controles.appendChild(crearBoton('Quitar', 'quitar', id, 'boton-quitar',
      'Quitar del pedido'));
    li.appendChild(controles);

    // Fila 3: observaciones ("sin sal", "sin hielo", "bien cocida")
    if (!agotado) {
      const etiqueta = document.createElement('label');
      etiqueta.className = 'linea-observaciones';
      etiqueta.textContent = 'Aclaraciones para la cocina';

      const campo = document.createElement('input');
      campo.type = 'text';
      campo.maxLength = LARGO_MAX_OBS_QR;
      campo.placeholder = 'Ej: sin sal';
      campo.value = linea.observaciones;
      campo.dataset.id = String(id);

      etiqueta.appendChild(campo);
      li.appendChild(etiqueta);
    }

    elListaResumen.appendChild(li);
  });

  // Si se vació desde el resumen, se cierra el panel
  if (pedido.size === 0) {
    elFondoPanel.hidden = true;
    return;
  }

  elTotalResumen.textContent = formatoPesos(calcularTotales().total);
  btnEnviar.disabled = hayAgotados || enviando;
}


// =============================================================
// ENVÍO
// =============================================================

async function enviarPedido() {
  if (enviando || pedido.size === 0) return;

  enviando = true;
  btnEnviar.disabled = true;
  btnSeguir.disabled = true;
  btnEnviar.textContent = 'Enviando…';
  ocultarErrorEnvio();

  // Primer intento de ESTE pedido: uid nuevo. Reintento sin cambios: el mismo.
  if (!uidEnvio) {
    uidEnvio = generarUid();
    guardarBorrador();
  }

  // Solo se manda menu_id, cantidad y observaciones: el PRECIO lo pone
  // el backend desde el menú cuando el mozo confirma
  const items = [];
  pedido.forEach(function (linea, id) {
    items.push({
      menu_id: id,
      cantidad: linea.cantidad,
      observaciones: linea.observaciones.trim()
    });
  });

  try {
    await enviarPedidoQr(codigo, { uid: uidEnvio, items: items });
    mostrarEnviado();

  } catch (error) {
    if (error && error.estado === 404) {
      enviando = false;
      bloquear(error.message);
      return;
    }

    // estado 0 = no llegó al servidor (wifi). El pedido NO se pierde.
    const mensaje = error && error.estado === 0
      ? 'No se pudo enviar porque se cortó la conexión. Tu pedido sigue acá: revisá el wifi y tocá "Enviar al mozo" de nuevo.'
      : (error && error.message) || 'No se pudo enviar. Tu pedido sigue acá: probá de nuevo.';
    mostrarErrorEnvio(mensaje);

    // Puede haber fallado porque algo se agotó: se vuelve a traer el menú
    try {
      menu = (await obtenerMenuQr(codigo)).menu;
    } catch (e) {
      // Sin conexión: se deja el menú que había
    }

    enviando = false;
    btnSeguir.disabled = false;
    btnEnviar.textContent = 'Enviar al mozo';
    dibujarMenu();
    dibujarResumen();
    actualizarBarra();
  }
}

// Pedido recibido: se limpia todo y se muestra la confirmación grande
function mostrarEnviado() {
  pedido.clear();
  uidEnvio = null;
  borrarBorrador();
  clearTimeout(temporizador);   // con el menú oculto no hace falta consultar

  enviando = false;
  btnSeguir.disabled = false;
  btnEnviar.textContent = 'Enviar al mozo';

  elFondoPanel.hidden = true;
  elZonaMenu.hidden = true;
  elBarra.hidden = true;
  elZonaEnviado.hidden = false;
  window.scrollTo(0, 0);
  btnOtroPedido.focus();
}

// "Hacer otro pedido": vuelve el menú (vacío) y se reanuda la actualización
function volverAlMenu() {
  elZonaEnviado.hidden = true;
  elZonaMenu.hidden = false;
  elBarra.hidden = false;
  dibujarMenu();
  actualizarBarra();
  window.scrollTo(0, 0);
  actualizarMenu();   // trae el menú al día y vuelve a programar cada 5 s
}


// =============================================================
// AYUDAS
// =============================================================

// Siempre textContent, nunca innerHTML con datos (prevención de XSS)
function crearTexto(etiqueta, clase, texto) {
  const elemento = document.createElement(etiqueta);
  elemento.className = clase;
  elemento.textContent = texto;
  return elemento;
}

function crearBoton(texto, accion, id, clase, descripcion) {
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = clase;
  boton.textContent = texto;
  boton.dataset.accion = accion;
  boton.dataset.id = String(id);
  if (descripcion) boton.setAttribute('aria-label', descripcion);
  return boton;
}

function mostrarAviso(mensaje) {
  elAviso.textContent = mensaje;
  elAviso.hidden = false;
}

// Aviso de wifi: se muestra si falla la actualización y se va solo al volver
function mostrarAvisoConexion() {
  sinConexion = true;
  mostrarAviso('Sin conexión con el restaurante. Revisá que sigas conectado al wifi de la hostería.');
}

function ocultarAvisoConexion() {
  if (!sinConexion) return;
  sinConexion = false;
  elAviso.hidden = true;
  elAviso.textContent = '';
}

// Deja solo el aviso: no se puede pedir nada (código inválido, sin wifi al abrir...)
function bloquear(mensaje) {
  clearTimeout(temporizador);
  mostrarAviso(mensaje);
  elAviso.classList.add('pedido-aviso--error');
  elZonaMenu.hidden = true;
  elBarra.hidden = true;
  elFondoPanel.hidden = true;
  elZonaEnviado.hidden = true;
  elSubtitulo.textContent = '';
}

function mostrarErrorEnvio(mensaje) {
  elErrorEnvio.textContent = mensaje;
  elErrorEnvio.hidden = false;
}

function ocultarErrorEnvio() {
  elErrorEnvio.hidden = true;
  elErrorEnvio.textContent = '';
}

// Lee la acción de un botón (delegación de eventos, como en pedido.js)
function accionDeBoton(evento) {
  const boton = evento.target.closest('button[data-accion]');
  if (!boton) return null;
  return { accion: boton.dataset.accion, id: Number(boton.dataset.id) };
}


// =============================================================
// EVENTOS (un escuchador por zona: delegación)
// =============================================================

elBuscar.addEventListener('input', function () {
  textoBusqueda = elBuscar.value;
  dibujarMenu();
});

elCategorias.addEventListener('click', function (evento) {
  const boton = evento.target.closest('button[data-categoria]');
  if (!boton) return;
  categoriaElegida = boton.dataset.categoria;
  // Al elegir categoría se limpia la búsqueda para no confundir
  textoBusqueda = '';
  elBuscar.value = '';
  dibujarCategorias();
  dibujarMenu();
});

elListaMenu.addEventListener('click', function (evento) {
  const datos = accionDeBoton(evento);
  if (!datos) return;
  if (datos.accion === 'sumar') cambiarCantidad(datos.id, 1);
  if (datos.accion === 'restar') cambiarCantidad(datos.id, -1);
});

elListaResumen.addEventListener('click', function (evento) {
  const datos = accionDeBoton(evento);
  if (!datos || enviando) return;
  if (datos.accion === 'sumar') cambiarCantidad(datos.id, 1);
  if (datos.accion === 'restar') cambiarCantidad(datos.id, -1);
  if (datos.accion === 'quitar') cambiarCantidad(datos.id, -CANTIDAD_MAX_QR);
});

// Observaciones: se guardan mientras se escribe, SIN redibujar
// (si se redibujara, el campo perdería el foco y el teclado se cerraría)
elListaResumen.addEventListener('input', function (evento) {
  const campo = evento.target;
  if (!campo.dataset.id) return;
  const linea = pedido.get(Number(campo.dataset.id));
  if (linea) {
    linea.observaciones = campo.value.slice(0, LARGO_MAX_OBS_QR);
    pedidoCambiado();
  }
});

btnVerPedido.addEventListener('click', abrirResumen);
btnSeguir.addEventListener('click', cerrarResumen);
btnEnviar.addEventListener('click', enviarPedido);
btnOtroPedido.addEventListener('click', volverAlMenu);

// Cerrar tocando el fondo oscuro o con Escape (igual que en pedido.js)
elFondoPanel.addEventListener('click', function (evento) {
  if (evento.target === elFondoPanel) cerrarResumen();
});
document.addEventListener('keydown', function (evento) {
  if (evento.key === 'Escape' && !elFondoPanel.hidden) cerrarResumen();
});

// Pantalla oculta (celular bloqueado, otra app): se pausa la actualización.
// Al volver, se consulta enseguida.
document.addEventListener('visibilitychange', function () {
  if (!document.hidden && !elZonaMenu.hidden) {
    clearTimeout(temporizador);
    actualizarMenu();
  }
});

iniciar();