/* =========================================================
   cocina.js — Vista de cocina para la tablet (RF-COC)
   ---------------------------------------------------------
   Muestra los pedidos que faltan preparar, por orden de
   llegada (el más viejo primero). Una sola acción: "Listo",
   con confirmación en dos toques.
   - Se actualiza sola cada 10 s (igual que mesas).
   - Suena un aviso cuando entra un pedido nuevo (si se activó).
   - Marca en rojo los pedidos que esperan demasiado.
   La usan cocina y el encargado.
   Los datos SIEMPRE se piden a api.js, nunca con fetch directo.
   ========================================================= */

// Cada cuánto se vuelven a pedir los pedidos (ms). Igual que mesas.
// 10 s: (propuesta) ajustar en las pruebas en la hostería.
const INTERVALO_ACTUALIZACION = 10000;

// A partir de cuántos minutos un pedido se marca como demorado
// (propuesta: confirmar con la cocina de la hostería)
const MINUTOS_ALERTA = 20;

// Si después del primer toque en "Listo" no se confirma en este
// tiempo, el botón vuelve a la normalidad (ms)
const TIEMPO_CONFIRMACION = 4000;

// Elementos de la página
const grillaCocina = document.getElementById('grilla-cocina');
const mensaje = document.getElementById('mensaje');
const contador = document.getElementById('contador');
const sinPedidos = document.getElementById('sin-pedidos');
const btnSonido = document.getElementById('btn-sonido');

// Estado de la pantalla
let pedidosActuales = [];       // última lista que se dibujó
let cargaInicialHecha = false;  // para no "sonar" con los pedidos que ya estaban al entrar
let idsConocidos = new Set();   // ids de pedidos que ya vimos (para detectar los nuevos)
let idsParaResaltar = new Set(); // pedidos recién llegados (se dibujan con animación)

// Estado del botón "Listo"
let confirmandoId = null;           // pedido con el primer toque hecho
let temporizadorConfirmacion = null;
const enviando = new Set();         // pedidos que se están marcando ahora
const marcadosListos = new Set();   // pedidos ya marcados desde esta tablet

// Actualización automática (igual que mesas.js)
let temporizador = null;
let actualizando = false;
let ultimoDibujo = '';

// Sonido
let contextoAudio = null;
let sonidoActivo = false;

// 1) Control de rol
const sesion = exigirRol(['cocina', 'encargado']);

if (sesion) {
  iniciarPantalla();
}

function iniciarPantalla() {
  document.getElementById('nombre-usuario').textContent =
    sesion.usuario.nombre + ' (' + sesion.usuario.rol + ')';

  document.getElementById('btn-salir').addEventListener('click', () => {
    cerrarSesion();
    location.href = '../index.html';
  });

  btnSonido.addEventListener('click', alternarSonido);

  // UN solo escuchador para todos los botones "Listo" (delegación)
  grillaCocina.addEventListener('click', alTocarGrilla);

  // Pantalla oculta → dejamos de pedir datos; al volver, actualizamos
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearTimeout(temporizador);
    } else {
      actualizar();
    }
  });

  actualizar();
}

/* ---------------------------------------------------------
   Actualización automática con setTimeout encadenado
   (misma explicación que en mesas.js: así las peticiones
   no se amontonan si el wifi anda lento).
   --------------------------------------------------------- */
async function actualizar() {
  if (actualizando) return;
  actualizando = true;
  clearTimeout(temporizador);

  await cargarPedidos();

  actualizando = false;
  if (!document.hidden) {
    temporizador = setTimeout(actualizar, INTERVALO_ACTUALIZACION);
  }
}

async function cargarPedidos() {
  try {
    let pedidos = await obtenerPedidosCocina();

    /* Si marcamos un pedido como listo MIENTRAS esta consulta
       viajaba, la respuesta puede traerlo todavía como pendiente
       y "reaparecería" por 10 s. Por eso descartamos los que
       ya marcamos desde esta tablet. */
    pedidos = pedidos.filter(p => !marcadosListos.has(p.id));

    // Detectamos los pedidos que no estaban la vez anterior
    const nuevos = pedidos.filter(p => !idsConocidos.has(p.id));
    idsConocidos = new Set(pedidos.map(p => p.id));

    // La primera vez no avisamos: esos pedidos ya estaban
    if (cargaInicialHecha && nuevos.length > 0) {
      idsParaResaltar = new Set(nuevos.map(p => p.id));
      sonar();
    }
    cargaInicialHecha = true;

    pedidosActuales = pedidos;

    // Solo redibujamos si cambió algo. minutos_espera cambia cada
    // minuto, así que como mucho redibuja una vez por minuto.
    const texto = JSON.stringify(pedidos);
    if (texto !== ultimoDibujo) {
      dibujarPedidos();
      ultimoDibujo = texto;
    }
    idsParaResaltar.clear(); // la animación se muestra una sola vez

    ocultarMensaje();
  } catch (error) {
    // Si se corta el wifi, quedan los pedidos de la última vez
    // y arriba aparece el aviso
    manejarError(error, mostrarError);
  }
}

// 401 → login; cualquier otro error → se muestra
function manejarError(error, mostrar) {
  if (error.estado === 401) {
    cerrarSesion();
    location.href = '../index.html';
    return;
  }
  mostrar(error.message);
}

/* ---------------------------------------------------------
   Dibuja todas las tarjetas a partir de pedidosActuales.
   El estado de cada botón (Listo / ¿Confirmar? / Enviando)
   sale de las variables confirmandoId y enviando: así, aunque
   llegue una actualización en medio, el botón no "se olvida"
   del primer toque.
   createElement + textContent, nunca innerHTML (XSS).
   --------------------------------------------------------- */
function dibujarPedidos() {
  grillaCocina.textContent = '';

  // Por orden de llegada; si llegan en el mismo momento, desempata el id
  const ordenados = [...pedidosActuales].sort((a, b) =>
    a.creado_en.localeCompare(b.creado_en) || a.id - b.id
  );

  for (const pedido of ordenados) {
    grillaCocina.append(crearTarjeta(pedido));
  }

  // Contador y mensaje de "no hay pedidos"
  const cantidad = ordenados.length;
  contador.textContent = cantidad === 1
    ? '1 pedido pendiente'
    : cantidad + ' pedidos pendientes';
  sinPedidos.hidden = cantidad > 0;
}

function crearTarjeta(pedido) {
  const tarjeta = document.createElement('article');
  tarjeta.className = 'pedido-cocina';
  if (pedido.minutos_espera >= MINUTOS_ALERTA) {
    tarjeta.classList.add('pedido-cocina--demorado');
  }
  if (idsParaResaltar.has(pedido.id)) {
    tarjeta.classList.add('pedido-cocina--nuevo');
  }

  // Cabecera: "Mesa 3"  ·  "21:15 · hace 5 min"
  const cabecera = document.createElement('header');
  cabecera.className = 'pedido-cocina__cabecera';

  const mesa = document.createElement('span');
  mesa.className = 'pedido-cocina__mesa';
  mesa.textContent = 'Mesa ' + pedido.mesa_numero;

  const tiempo = document.createElement('span');
  tiempo.className = 'pedido-cocina__tiempo';
  tiempo.textContent = formatearHora(pedido.creado_en) + ' · ' +
    textoEspera(pedido.minutos_espera);

  cabecera.append(mesa, tiempo);

  // "Pedido #4 · Mozo 1"
  const datos = document.createElement('p');
  datos.className = 'pedido-cocina__datos';
  datos.textContent = 'Pedido #' + pedido.id +
    (pedido.mozo_nombre ? ' · ' + pedido.mozo_nombre : '');

  // Ítems: cantidad grande + nombre, y las observaciones resaltadas
  const lista = document.createElement('ul');
  lista.className = 'pedido-cocina__items';

  for (const item of pedido.items) {
    const li = document.createElement('li');

    const cantidad = document.createElement('span');
    cantidad.className = 'pedido-cocina__cantidad';
    cantidad.textContent = item.cantidad + ' ×';

    const nombre = document.createElement('span');
    nombre.textContent = item.nombre;

    li.append(cantidad, nombre);

    if (item.observaciones) {
      const obs = document.createElement('span');
      obs.className = 'pedido-cocina__obs';
      obs.textContent = '⚠ ' + item.observaciones;
      li.append(obs);
    }
    lista.append(li);
  }

  // Botón "Listo": su texto depende del estado
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'boton boton--bloque pedido-cocina__listo';
  boton.dataset.id = pedido.id;

  if (enviando.has(pedido.id)) {
    boton.textContent = 'Enviando...';
    boton.disabled = true;
  } else if (confirmandoId === pedido.id) {
    boton.textContent = '¿Confirmar? Tocá de nuevo';
    boton.classList.add('pedido-cocina__listo--confirmando');
  } else {
    boton.textContent = 'Listo';
  }

  tarjeta.append(cabecera, datos, lista, boton);
  return tarjeta;
}

// 0 → "recién llegado", 5 → "hace 5 min", 75 → "hace 1 h 15 min"
function textoEspera(minutos) {
  if (!minutos || minutos < 1) return 'recién llegado';
  if (minutos < 60) return 'hace ' + minutos + ' min';
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return 'hace ' + horas + ' h' + (resto ? ' ' + resto + ' min' : '');
}

/* ---------------------------------------------------------
   "Listo" con confirmación en dos toques.
   En una cocina se toca la pantalla apurado o con las manos
   mojadas: un "Listo" por error haría desaparecer un pedido
   que nadie cocinó.
   --------------------------------------------------------- */
async function alTocarGrilla(evento) {
  const boton = evento.target.closest('.pedido-cocina__listo');
  if (!boton) return;

  const id = Number(boton.dataset.id);
  if (enviando.has(id)) return; // ya se está mandando

  // Primer toque: pedimos confirmación (solo un pedido a la vez)
  if (confirmandoId !== id) {
    confirmandoId = id;
    clearTimeout(temporizadorConfirmacion);
    temporizadorConfirmacion = setTimeout(() => {
      confirmandoId = null;
      dibujarPedidos();
    }, TIEMPO_CONFIRMACION);
    dibujarPedidos();
    return;
  }

  // Segundo toque: lo marcamos como listo
  confirmandoId = null;
  clearTimeout(temporizadorConfirmacion);
  enviando.add(id);
  dibujarPedidos(); // el botón pasa a "Enviando..." (bloquea el doble toque)

  try {
    await marcarPedidoListo(id);
    quitarPedido(id);
  } catch (error) {
    if (error.estado === 404 || error.estado === 409) {
      // Ya no existe o alguien ya lo marcó: lo importante es que
      // no hay que prepararlo, así que lo sacamos sin asustar a nadie
      quitarPedido(id);
    } else {
      manejarError(error, mostrarError);
    }
  } finally {
    enviando.delete(id);
    dibujarPedidos(); // si falló, el botón vuelve a "Listo"
  }
}

function quitarPedido(id) {
  marcadosListos.add(id);
  pedidosActuales = pedidosActuales.filter(p => p.id !== id);
  ultimoDibujo = ''; // la próxima actualización compara de nuevo
}

/* ---------------------------------------------------------
   Sonido con la Web Audio API: viene en el navegador, genera
   el pitido en el momento (no hace falta un archivo .mp3) y
   funciona sin internet.
   El navegador solo deja crear el audio después de que el
   usuario toca algo: por eso se activa con un botón.
   --------------------------------------------------------- */
function alternarSonido() {
  if (!contextoAudio) {
    const Contexto = window.AudioContext || window.webkitAudioContext;
    if (!Contexto) {
      mostrarError('Este navegador no permite reproducir sonido.');
      return;
    }
    contextoAudio = new Contexto();
  }

  sonidoActivo = !sonidoActivo;

  if (sonidoActivo) {
    contextoAudio.resume();
    sonar(); // pitido de prueba: así se comprueba el volumen
  }

  btnSonido.textContent = sonidoActivo ? '🔔 Sonido activado' : '🔇 Activar sonido';
  btnSonido.setAttribute('aria-pressed', sonidoActivo);
}

/* Dos pitidos cortos.
   Si el navegador "durmió" el audio, primero lo despertamos. */
async function sonar() {
  if (!sonidoActivo || !contextoAudio) return;

  if (contextoAudio.state !== 'running') {
    try {
      await contextoAudio.resume();
    } catch (e) {
      return; // si no se pudo, no sonamos (la tarjeta igual titila)
    }
  }

  pitido();
  setTimeout(pitido, 300); // segundo pitido
}

/* Un pitido de 150 ms.
   Lo arrancamos "ya" y lo cortamos con setTimeout (el reloj normal
   de la página), NO con el reloj interno del audio: ese reloj puede
   quedar atrasado cuando la pestaña vuelve de segundo plano, y el
   pitido se programaría en el pasado (no sonaría). */
function pitido() {
  const oscilador = contextoAudio.createOscillator(); // genera el tono
  const volumen = contextoAudio.createGain();          // controla el volumen
  oscilador.type = 'sine';
  oscilador.frequency.value = 880; // nota La (agudo, se oye entre el ruido)
  volumen.gain.value = 0.3;
  oscilador.connect(volumen);
  volumen.connect(contextoAudio.destination); // al parlante

  oscilador.start(); // sin parámetro = ahora mismo
  setTimeout(() => oscilador.stop(), 150);
}
/* ---------- Mensajes al usuario ---------- */
function mostrarError(texto) {
  mensaje.textContent = texto;
  mensaje.className = 'mensaje mensaje--error';
  mensaje.hidden = false;
}

function ocultarMensaje() {
  mensaje.hidden = true;
}