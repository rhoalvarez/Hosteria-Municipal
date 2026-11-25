/* =========================================================
   mesas.js — Pantalla de mesas (RF-MES)
   ---------------------------------------------------------
   Muestra las mesas del salón con su estado (libre, ocupada,
   cuenta pedida). La usan el mozo, recepción y el encargado.
   Al tocar una mesa se abre un panel:
     - libre         → cuántas personas → pantalla de pedido
     - ocupada       → ver pedidos, agregar pedido, pedir cuenta
     - cuenta pedida → solo ver (el cobro es de Caja, Inc. 3)
   Los datos SIEMPRE se piden a api.js, nunca con fetch directo.
   ========================================================= */

// Texto que se muestra según el estado de la MESA
const TEXTO_ESTADO = {
  libre: 'Libre',
  ocupada: 'Ocupada',
  cuenta_pedida: 'Cuenta pedida'
};

// Texto que se muestra según el estado del PEDIDO
const TEXTO_ESTADO_PEDIDO = {
  por_confirmar: 'Por confirmar',
  pendiente: 'Pendiente',
  en_preparacion: 'En preparación',
  listo: 'Listo'
};

// Máximo de personas por mesa (a confirmar con la hostería)
const MAX_PERSONAS = 20;

// Cada cuánto se vuelven a pedir las mesas (en milisegundos).
// 10 s: (propuesta) ajustar en las pruebas en la hostería.
const INTERVALO_ACTUALIZACION = 10000;

// formatoPesos() y formatearHora() ahora están en formato.js,
// porque también las usa la pantalla de pedido (y después cocina y caja).

// Mensaje que deja la pantalla de pedido al enviar ("Pedido de la Mesa 3
// enviado a cocina ✔"). Se lee una sola vez y se borra.
let avisoPendiente = sessionStorage.getItem('rest_aviso_mesas');
sessionStorage.removeItem('rest_aviso_mesas');

// Elementos de la página que usamos varias veces
const grillaMesas = document.getElementById('grilla-mesas');
const mensaje = document.getElementById('mensaje');
const panelFondo = document.getElementById('panel-fondo');
const panelTitulo = document.getElementById('panel-titulo');

// Vista de mesa libre
const vistaLibre = document.getElementById('vista-libre');
const formPersonas = document.getElementById('form-personas');
const inputPersonas = document.getElementById('input-personas');
const errorPersonas = document.getElementById('error-personas');

// Vista de mesa ocupada / cuenta pedida
const vistaOcupada = document.getElementById('vista-ocupada');
const cargandoPedidos = document.getElementById('cargando-pedidos');
const listaPedidos = document.getElementById('lista-pedidos');
const totalMesa = document.getElementById('total-mesa');
const avisoCuenta = document.getElementById('aviso-cuenta');
const errorOcupada = document.getElementById('error-ocupada');
const btnAgregar = document.getElementById('btn-agregar');
const btnPedirCuenta = document.getElementById('btn-pedir-cuenta');

// Estado de la pantalla
let mesasActuales = [];       // última lista recibida de api.js
let mesaSeleccionada = null;  // la mesa del panel abierto
let confirmandoCuenta = false; // true después del primer toque en "Pedir cuenta"

// Actualización automática
let temporizador = null;    // el setTimeout de la próxima actualización
let actualizando = false;   // true mientras hay una petición en curso
let ultimoDibujo = '';      // las mesas de la última vez, como texto

// 1) Control de rol: si no tiene permiso, exigirRol lo redirige
//    y devuelve null. En ese caso no hacemos nada más.
const sesion = exigirRol(['encargado', 'mozo']);

if (sesion) {
  iniciarPantalla();
}

function iniciarPantalla() {
  // Nombre y rol en el encabezado
  document.getElementById('nombre-usuario').textContent =
    sesion.usuario.nombre + ' (' + sesion.usuario.rol + ')';

  // Botón Salir: borra la sesión y vuelve al login
  document.getElementById('btn-salir').addEventListener('click', () => {
    cerrarSesion();
    location.href = '../index.html';
  });

    // El ABM del menú es solo del encargado: a los demás no les mostramos el botón.
  // Ocultarlo es solo interfaz: igual menu.html usa exigirRol(['encargado'])
  // y el backend tiene que rechazar las rutas del menú para otros roles.
  if (sesion.usuario.rol === 'encargado') {
    document.getElementById('enlace-menu').hidden = false;
  }

  // UN solo "escuchador" para toda la grilla (delegación de eventos)
  grillaMesas.addEventListener('click', alTocarMesa);

  formPersonas.addEventListener('submit', tomarPedido);
  btnAgregar.addEventListener('click', agregarPedido);
  btnPedirCuenta.addEventListener('click', pedirCuenta);

  // Formas de cerrar el panel: botones con data-cerrar
  // o tocar el fondo oscuro de afuera
  panelFondo.addEventListener('click', (evento) => {
    if (evento.target === panelFondo || evento.target.closest('[data-cerrar]')) {
      cerrarPanel();
    }
  });

  // ...o la tecla Escape (PC de recepción / administración)
  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && !panelFondo.hidden) {
      cerrarPanel();
    }
  });

  // Si el mozo guarda el celular (o cambia de pestaña), dejamos de
  // pedir datos. Cuando vuelve, actualizamos en el momento.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearTimeout(temporizador);
    } else {
      actualizar();
    }
  });

  actualizar(); // primera carga + arranca la actualización automática
}

/* ---------------------------------------------------------
   Actualización automática ("polling").
   Usamos setTimeout encadenado y NO setInterval: la próxima
   actualización se programa recién cuando terminó la anterior.
   Con setInterval, si el wifi anda lento, las peticiones se
   podrían amontonar una encima de otra.
   --------------------------------------------------------- */
async function actualizar() {
  if (actualizando) return; // ya hay una en curso: no duplicamos
  actualizando = true;
  clearTimeout(temporizador);

  await cargarMesas();

  actualizando = false;
  // Solo programamos la próxima si la pantalla se está viendo
  if (!document.hidden) {
    temporizador = setTimeout(actualizar, INTERVALO_ACTUALIZACION);
  }
}

/* ---------------------------------------------------------
   Pide las mesas a api.js y las dibuja.
   async/await: esperamos la respuesta sin congelar la pantalla.
   --------------------------------------------------------- */
async function cargarMesas() {
  try {
    const mesas = await obtenerMesas();
    mesasActuales = mesas;

    // Solo redibujamos si algo cambió: así la pantalla no
    // "parpadea" cada 10 segundos sin motivo
    const texto = JSON.stringify(mesas);
    if (texto !== ultimoDibujo) {
      dibujarMesas(mesas);
      ultimoDibujo = texto;
    }

    // Si venimos de enviar un pedido, lo mostramos una vez.
    // Se va solo en la próxima actualización (10 s).
    if (avisoPendiente) {
      mostrarAviso(avisoPendiente);
      avisoPendiente = null;
    } else {
      ocultarMensaje();
    }
  } catch (error) {
    // Si se corta el wifi, las mesas de la última vez quedan
    // en pantalla y arriba aparece el aviso. En la próxima
    // actualización que funcione, el aviso desaparece solo.
    manejarError(error, mostrarError);
  }
}

/* ---------------------------------------------------------
   Si el error es 401 (token vencido o inválido, backend real),
   cerramos la sesión y vamos al login. Si es otro error, se
   lo mostramos al usuario con la función que nos pasen.
   --------------------------------------------------------- */
function manejarError(error, mostrar) {
  if (error.estado === 401) {
    cerrarSesion();
    location.href = '../index.html';
    return;
  }
  mostrar(error.message);
}

/* ---------------------------------------------------------
   Crea una tarjeta (<button>) por cada mesa.
   Usamos createElement + textContent y NO innerHTML:
   textContent nunca interpreta HTML, así que ningún dato de
   la base puede "inyectar" código en la página (XSS).
   --------------------------------------------------------- */
function dibujarMesas(mesas) {
  grillaMesas.textContent = ''; // borra lo que había antes

  // Ordenadas por número, por si el backend las manda desordenadas
  const ordenadas = [...mesas].sort((a, b) => a.numero - b.numero);

  for (const mesa of ordenadas) {
    const tarjeta = document.createElement('button');
    tarjeta.type = 'button';
    // La clase del color sale directo del estado: 'mesa--libre', etc.
    tarjeta.className = 'mesa mesa--' + mesa.estado;
    // Guardamos el id en el botón para saber qué mesa se tocó
    tarjeta.dataset.id = mesa.id;

    const numero = document.createElement('span');
    numero.className = 'mesa__numero';
    numero.textContent = mesa.numero;

    const estado = document.createElement('span');
    estado.className = 'mesa__estado';
    // Si llega un estado desconocido, mostramos el valor tal cual
    estado.textContent = TEXTO_ESTADO[mesa.estado] || mesa.estado;

    tarjeta.append(numero, estado);
    grillaMesas.append(tarjeta);
  }
}

/* ---------------------------------------------------------
   Al tocar una mesa.
   closest('.mesa') busca la tarjeta aunque se haya tocado
   el número o el texto que están adentro.
   --------------------------------------------------------- */
function alTocarMesa(evento) {
  const tarjeta = evento.target.closest('.mesa');
  if (!tarjeta) return; // tocó el espacio entre tarjetas

  // dataset siempre devuelve texto: lo pasamos a número
  const id = Number(tarjeta.dataset.id);
  const mesa = mesasActuales.find(m => m.id === id);
  if (!mesa) return;

  abrirPanel(mesa);
}

function abrirPanel(mesa) {
  mesaSeleccionada = mesa;
  panelTitulo.textContent = 'Mesa ' + mesa.numero + ' · ' +
    (TEXTO_ESTADO[mesa.estado] || mesa.estado);

  // Mostramos solo la vista que corresponde al estado
  vistaLibre.hidden = true;
  vistaOcupada.hidden = true;
  panelFondo.hidden = false;

  if (mesa.estado === 'libre') {
    abrirVistaLibre();
  } else {
    abrirVistaOcupada(mesa);
  }
}

function cerrarPanel() {
  panelFondo.hidden = true;
  vistaLibre.hidden = true;
  vistaOcupada.hidden = true;
  mesaSeleccionada = null;
  reiniciarBotonCuenta();
}

/* =========================================================
   MESA LIBRE
   ========================================================= */
function abrirVistaLibre() {
  // Limpiamos lo que haya quedado de la vez anterior
  inputPersonas.value = '';
  errorPersonas.hidden = true;

  vistaLibre.hidden = false;
  inputPersonas.focus(); // en el celular abre el teclado numérico
}

/* La mesa NO se marca ocupada acá: pasa a ocupada cuando se
   ENVÍA el primer pedido (lo hace crearPedido / el backend).
   Así, si el mozo se arrepiente, la mesa sigue libre. */
function tomarPedido(evento) {
  evento.preventDefault(); // que el formulario no recargue la página

  const personas = Number(inputPersonas.value);

  // Validamos en el frontend para avisar rápido al mozo.
  // El backend TIENE que validar lo mismo (el frontend se puede saltear).
  if (!Number.isInteger(personas) || personas < 1 || personas > MAX_PERSONAS) {
    errorPersonas.textContent = 'Ingresá un número entre 1 y ' + MAX_PERSONAS + '.';
    errorPersonas.hidden = false;
    inputPersonas.focus();
    return;
  }

  // La pantalla de pedido recibe la mesa y las personas por la URL
  location.href = 'pedido.html?mesa=' + mesaSeleccionada.id + '&personas=' + personas;
}

/* =========================================================
   MESA OCUPADA / CUENTA PEDIDA
   ========================================================= */
async function abrirVistaOcupada(mesa) {
  const esCuentaPedida = mesa.estado === 'cuenta_pedida';

  // Con la cuenta pedida ya no se agregan pedidos ni se pide de nuevo
  btnAgregar.hidden = esCuentaPedida;
  btnPedirCuenta.hidden = esCuentaPedida;
  avisoCuenta.hidden = !esCuentaPedida;

  // Mientras cargan los pedidos
  errorOcupada.hidden = true;
  listaPedidos.textContent = '';
  totalMesa.textContent = formatoPesos(0);
  cargandoPedidos.hidden = false;
  vistaOcupada.hidden = false;

  try {
    const pedidos = await obtenerPedidosMesa(mesa.id);

    // Mientras esperábamos, el mozo pudo cerrar el panel o tocar
    // OTRA mesa. Si es así, esta respuesta ya no sirve.
    if (!mesaSeleccionada || mesaSeleccionada.id !== mesa.id) return;

    dibujarPedidos(pedidos);
  } catch (error) {
    manejarError(error, mostrarErrorOcupada);
  } finally {
    // finally se ejecuta siempre: haya salido bien o mal
    cargandoPedidos.hidden = true;
  }
}

/* Dibuja los pedidos de la mesa y calcula el total.
   El total se calcula con precio_unitario, que es el precio
   GUARDADO en el pedido (el del momento en que se pidió). */
function dibujarPedidos(pedidos) {
  listaPedidos.textContent = '';

  if (pedidos.length === 0) {
    const vacio = document.createElement('li');
    vacio.className = 'mensaje';
    vacio.textContent = 'Todavía no hay pedidos en esta mesa.';
    listaPedidos.append(vacio);
    totalMesa.textContent = formatoPesos(0);
    return;
  }

  let total = 0;

  for (const pedido of pedidos) {
    const li = document.createElement('li');
    li.className = 'pedido';

    // Cabecera: "Pedido #3 · 21:15" + etiqueta de estado
    const cabecera = document.createElement('div');
    cabecera.className = 'pedido__cabecera';

    const titulo = document.createElement('span');
    titulo.textContent = 'Pedido #' + pedido.id + ' · ' + formatearHora(pedido.creado_en);

    const etiqueta = document.createElement('span');
    // Reutilizamos las etiquetas .estado--pendiente, .estado--listo, etc.
    etiqueta.className = 'estado estado--' + pedido.estado;
    etiqueta.textContent = TEXTO_ESTADO_PEDIDO[pedido.estado] || pedido.estado;

    cabecera.append(titulo, etiqueta);

    // Ítems: "2 × Milanesa con papas fritas — $ 19.000"
    const ul = document.createElement('ul');
    ul.className = 'pedido__items';

    for (const item of pedido.items) {
      const subtotal = item.cantidad * item.precio_unitario;
      total += subtotal;

      const liItem = document.createElement('li');
      liItem.textContent = item.cantidad + ' × ' + item.nombre +
        ' — ' + formatoPesos(subtotal);

      if (item.observaciones) {
        const obs = document.createElement('span');
        obs.className = 'pedido__obs';
        obs.textContent = item.observaciones;
        liItem.append(obs);
      }

      ul.append(liItem);
    }

    li.append(cabecera, ul);
    listaPedidos.append(li);
  }

  totalMesa.textContent = formatoPesos(total);
}

// "Agregar pedido": a la pantalla de pedido, sin personas
// (las personas ya se cargaron con el primer pedido)
function agregarPedido() {
  location.href = 'pedido.html?mesa=' + mesaSeleccionada.id;
}

/* ---------------------------------------------------------
   "Pedir cuenta" con confirmación en dos toques.
   No usamos confirm() del navegador: bloquea la página y se
   ve distinto en cada celular.
   --------------------------------------------------------- */
async function pedirCuenta() {
  // Primer toque: pedimos confirmación
  if (!confirmandoCuenta) {
    confirmandoCuenta = true;
    btnPedirCuenta.textContent = '¿Seguro? Tocá de nuevo para confirmar';
    return;
  }

  // Segundo toque: cambiamos el estado de la mesa.
  // Deshabilitamos el botón para que un doble toque no lo mande dos veces.
  btnPedirCuenta.disabled = true;
  errorOcupada.hidden = true;

  try {
    await cambiarEstadoMesa(mesaSeleccionada.id, 'cuenta_pedida');
    cerrarPanel();
    actualizar(); // la mesa pasa a rojo en la grilla, sin esperar 10 s
  } catch (error) {
    manejarError(error, mostrarErrorOcupada);
    reiniciarBotonCuenta();
  }
}

// Deja el botón "Pedir cuenta" como al principio
function reiniciarBotonCuenta() {
  confirmandoCuenta = false;
  btnPedirCuenta.disabled = false;
  btnPedirCuenta.textContent = 'Pedir cuenta';
}

/* ---------- Mensajes al usuario ---------- */
function mostrarError(texto) {
  mensaje.textContent = texto;
  mensaje.className = 'mensaje mensaje--error';
  mensaje.hidden = false;
}

// Mensaje informativo (no es error): "Pedido enviado a cocina ✔"
function mostrarAviso(texto) {
  mensaje.textContent = texto;
  mensaje.className = 'mensaje';
  mensaje.hidden = false;
}

function ocultarMensaje() {
  mensaje.hidden = true;
}

function mostrarErrorOcupada(texto) {
  errorOcupada.textContent = texto;
  errorOcupada.hidden = false;
}