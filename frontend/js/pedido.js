// =============================================================
// pedido.js – Pantalla de pedido del mozo (Inc. 1 – RF-PED)
//
// URL:  pedido.html?mesa=ID&personas=N  → primer pedido (mesa libre)
//       pedido.html?mesa=ID             → agregar pedido (mesa ocupada)
//
// Flujo: elegir platos (+ / −) → ver resumen → observaciones →
//        "Enviar a cocina" → vuelve a mesas.
// =============================================================

// Los mismos roles que la pantalla de mesas (si no, recepción vería el
// botón "Agregar pedido" y al tocarlo la sacaría del sistema).
// (a confirmar con la hostería) si recepción también puede tomar pedidos.
// Si no tiene permiso, exigirRol lo redirige y devuelve null.
const sesion = exigirRol(['encargado', 'mozo']);

// ---------- Límites (los mismos los tiene que validar el backend) ----------
const MAX_PERSONAS = 20;
const MAX_CANTIDAD = 50;        // por plato: evita errores de dedo (500 en vez de 5)
const MAX_OBSERVACIONES = 100;  // caracteres por línea

// ---------- Datos que vienen en la URL ----------
const parametros = new URLSearchParams(window.location.search);
const mesaId = Number(parametros.get('mesa'));
// Si no viene "personas" es porque se está agregando un pedido a una mesa ocupada
let personas = parametros.has('personas') ? Number(parametros.get('personas')) : null;

// ---------- Estado de la pantalla ----------
let mesa = null;
let menu = [];               // platos activos (con su campo "disponible")
let categorias = [];
let categoriaElegida = 'todas';
let textoBusqueda = '';
let enviando = false;        // evita que un doble toque mande el pedido dos veces

// Pedido en armado: menu_id → { cantidad, observaciones }
// Usamos Map porque guarda el orden en que el mozo fue agregando los platos.
const pedido = new Map();

// Borrador por mesa en sessionStorage: si el celular recarga la página
// no se pierde lo cargado. Se borra al enviar o al cerrar la pestaña.
const CLAVE_BORRADOR = 'rest_borrador_mesa_' + mesaId;

// ---------- Elementos de la página ----------
const elTitulo = document.getElementById('titulo-mesa');
const elSubtitulo = document.getElementById('subtitulo');
const elAviso = document.getElementById('aviso');
const elZonaMenu = document.getElementById('zona-menu');
const elBuscar = document.getElementById('buscar');
const elCategorias = document.getElementById('categorias');
const elListaMenu = document.getElementById('lista-menu');
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
  // 1) Validar la URL antes de pedir nada a la API
  if (!Number.isInteger(mesaId) || mesaId <= 0) {
    bloquear('No se indicó una mesa válida. Volvé a Mesas.');
    return;
  }
  if (personas !== null &&
      (!Number.isInteger(personas) || personas < 1 || personas > MAX_PERSONAS)) {
    bloquear('La cantidad de personas no es válida (1 a ' + MAX_PERSONAS + '). Volvé a Mesas.');
    return;
  }

  // 2) Traer mesas, categorías y menú al mismo tiempo (más rápido que de a uno)
  try {
    const respuestas = await Promise.all([obtenerMesas(), obtenerCategorias(), obtenerMenu()]);
    const mesas = respuestas[0];
    categorias = respuestas[1];
    menu = respuestas[2];

    mesa = mesas.find(function (m) { return Number(m.id) === mesaId; });
  } catch (error) {
    if (sesionVencida(error)) return;
    bloquear('No se pudo cargar el menú. Revisá la conexión al wifi y volvé a intentar.');
    return;
  }

  if (!mesa) {
    bloquear('La mesa no existe. Volvé a Mesas.');
    return;
  }

  elTitulo.textContent = 'Mesa ' + (mesa.numero || mesaId);

  // 3) Revisar el estado ACTUAL de la mesa: pudo cambiar desde que el mozo
  //    la tocó en la pantalla de mesas (otro mozo, o pidieron la cuenta).
  if (mesa.estado === 'cuenta_pedida') {
    bloquear('Esta mesa ya pidió la cuenta: no se pueden agregar pedidos.');
    return;
  }
  if (mesa.estado === 'libre' && personas === null) {
    bloquear('La mesa está libre. Volvé a Mesas e indicá la cantidad de personas.');
    return;
  }
  if (mesa.estado === 'ocupada' && personas !== null) {
    // Otro mozo la abrió mientras tanto: se agrega como pedido de una mesa ocupada
    personas = null;
    mostrarAviso('Esta mesa ya estaba ocupada: tu pedido se agrega a su cuenta.');
  }

  elSubtitulo.textContent = personas !== null
    ? 'Primer pedido · ' + personas + (personas === 1 ? ' persona' : ' personas')
    : 'Agregar pedido';

  recuperarBorrador();
  dibujarCategorias();
  dibujarMenu();
  actualizarBarra();
}


// =============================================================
// MENÚ: categorías, búsqueda y lista de platos
// =============================================================

// Saca acentos y pasa a minúsculas: "Jamón" y "jamon" se encuentran igual
function normalizar(texto) {
  return String(texto).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function platosFiltrados() {
  const texto = normalizar(textoBusqueda.trim());

  return menu.filter(function (plato) {
    // Si el mozo escribe algo, se busca en TODAS las categorías
    // (así encuentra "B03" aunque esté parado en Comidas)
    if (texto !== '') {
      return normalizar(plato.nombre).includes(texto) ||
             normalizar(plato.codigo).includes(texto);
    }
    // plato.categoria guarda el CÓDIGO de la categoría ('A', 'B', 'D')
    return categoriaElegida === 'todas' || plato.categoria === categoriaElegida;
  });
}

function dibujarCategorias() {
  elCategorias.replaceChildren();

  // Las categorías se identifican por su código ('A', 'B', 'D'), como en el menú de la hostería
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

  // Datos del plato
  const info = document.createElement('div');
  info.className = 'plato-info';
  info.appendChild(crearTexto('span', 'plato-codigo', plato.codigo));
  info.appendChild(crearTexto('span', 'plato-nombre', plato.nombre));
  info.appendChild(crearTexto('span', 'plato-precio', formatoPesos(plato.precio)));
  li.appendChild(info);

  // Controles
  const controles = document.createElement('div');
  controles.className = 'controles';

  if (!plato.disponible) {
    controles.appendChild(crearTexto('span', 'etiqueta-agotado', 'Agotado'));
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
    linea.cantidad = Math.min(nueva, MAX_CANTIDAD);
    pedido.set(id, linea);
  }

  guardarBorrador();
  dibujarMenu();
  actualizarBarra();
  if (!elFondoPanel.hidden) dibujarResumen();
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
    btnVerPedido.textContent = 'Pedido vacío';
    btnVerPedido.disabled = true;
  } else {
    btnVerPedido.textContent = 'Ver pedido (' + totales.platos + ') · ' + formatoPesos(totales.total);
    btnVerPedido.disabled = false;
  }
}

// ---------- Borrador (sessionStorage) ----------
function guardarBorrador() {
  try {
    // Un Map no se puede pasar directo a JSON: se convierte en lista de pares
    sessionStorage.setItem(CLAVE_BORRADOR, JSON.stringify(Array.from(pedido)));
  } catch (error) {
    // Si el navegador no deja guardar, no es grave: el pedido sigue en memoria
  }
}

function recuperarBorrador() {
  try {
    const guardado = JSON.parse(sessionStorage.getItem(CLAVE_BORRADOR));
    if (!Array.isArray(guardado)) return;

    for (const par of guardado) {
      const id = par[0];
      const linea = par[1];
      // Solo platos que siguen en el menú (si alguno se agotó, el resumen lo avisa)
      if (buscarPlato(id) && linea && linea.cantidad > 0) {
        pedido.set(id, {
          cantidad: Math.min(linea.cantidad, MAX_CANTIDAD),
          observaciones: String(linea.observaciones || '').slice(0, MAX_OBSERVACIONES)
        });
      }
    }
  } catch (error) {
    // Borrador roto: se ignora
  }
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
      plato ? plato.codigo + ' · ' + plato.nombre : 'Plato ya no disponible'));
    cabecera.appendChild(crearTexto('span', 'linea-subtotal',
      plato ? formatoPesos(plato.precio * linea.cantidad) : ''));
    li.appendChild(cabecera);

    if (agotado) {
      li.appendChild(crearTexto('p', 'linea-aviso', 'Se agotó: quitalo para poder enviar.'));
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

    // Fila 3: observaciones ("sin sal", "1 sin cebolla", "bien cocida")
    if (!agotado) {
      const etiqueta = document.createElement('label');
      etiqueta.className = 'linea-observaciones';
      etiqueta.textContent = 'Observaciones';

      const campo = document.createElement('input');
      campo.type = 'text';
      campo.maxLength = MAX_OBSERVACIONES;
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

  // Solo se manda menu_id y cantidad: el PRECIO lo pone el backend desde el menú
  const items = [];
  pedido.forEach(function (linea, id) {
    items.push({
      menu_id: id,
      cantidad: linea.cantidad,
      observaciones: linea.observaciones.trim() || null
    });
  });

  const datos = { mesa_id: mesaId, items: items };
  if (personas !== null) datos.personas = personas;   // solo en el primer pedido

  try {
    await crearPedido(datos);

    sessionStorage.removeItem(CLAVE_BORRADOR);
    // Mensaje para que lo muestre la pantalla de mesas al volver
    sessionStorage.setItem('rest_aviso_mesas',
      'Pedido de la Mesa ' + (mesa.numero || mesaId) + ' enviado a cocina ✔');
    window.location.href = 'mesas.html';

  } catch (error) {
    if (sesionVencida(error)) return;
    mostrarErrorEnvio((error && error.message) ||
      'No se pudo enviar. El pedido sigue cargado: probá de nuevo.');

    // Puede haber fallado porque algo se agotó: se vuelve a traer el menú
    try {
      menu = await obtenerMenu();
    } catch (e) {
      // Sin conexión: se deja el menú que había
    }

    enviando = false;
    btnSeguir.disabled = false;
    btnEnviar.textContent = 'Enviar a cocina';
    dibujarMenu();
    dibujarResumen();
    actualizarBarra();
  }
}


// =============================================================
// AYUDAS
// =============================================================

// Error 401 = token vencido o inválido (backend real): igual que en mesas,
// se cierra la sesión y se vuelve al login. El borrador queda guardado.
function sesionVencida(error) {
  if (error && error.estado === 401) {
    cerrarSesion();
    window.location.href = '../index.html';
    return true;
  }
  return false;
}

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

// Deja solo el aviso y el botón "← Mesas": no se puede cargar nada
function bloquear(mensaje) {
  mostrarAviso(mensaje);
  elAviso.classList.add('pedido-aviso--error');
  elZonaMenu.hidden = true;
  elBarra.hidden = true;
  if (elSubtitulo.textContent === 'Cargando…') elSubtitulo.textContent = '';
}

function mostrarErrorEnvio(mensaje) {
  elErrorEnvio.textContent = mensaje;
  elErrorEnvio.hidden = false;
}

function ocultarErrorEnvio() {
  elErrorEnvio.hidden = true;
  elErrorEnvio.textContent = '';
}

// Lee la acción de un botón (delegación de eventos, como en mesas)
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
  if (datos.accion === 'quitar') cambiarCantidad(datos.id, -MAX_CANTIDAD);
});

// Observaciones: se guardan mientras se escribe, SIN redibujar
// (si se redibujara, el campo perdería el foco y el teclado se cerraría)
elListaResumen.addEventListener('input', function (evento) {
  const campo = evento.target;
  if (!campo.dataset.id) return;
  const linea = pedido.get(Number(campo.dataset.id));
  if (linea) {
    linea.observaciones = campo.value.slice(0, MAX_OBSERVACIONES);
    guardarBorrador();
  }
});

btnVerPedido.addEventListener('click', abrirResumen);
btnSeguir.addEventListener('click', cerrarResumen);
btnEnviar.addEventListener('click', enviarPedido);

// Cerrar tocando el fondo oscuro o con Escape (igual que en mesas)
elFondoPanel.addEventListener('click', function (evento) {
  if (evento.target === elFondoPanel) cerrarResumen();
});
document.addEventListener('keydown', function (evento) {
  if (evento.key === 'Escape' && !elFondoPanel.hidden) cerrarResumen();
});

// Solo arrancamos si tiene permiso (si no, exigirRol ya lo redirigió)
if (sesion) {
  iniciar();
}