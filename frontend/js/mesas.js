/* =========================================================
   mesas.js — Pantalla de mesas (RF-MES) + pedidos por QR (RF-QR)
              + cobro de la mesa (RF-CAJ-04/05)
   ---------------------------------------------------------
   Muestra las mesas del salón con su estado (libre, ocupada,
   cuenta pedida). La usan el mozo y el encargado.
   Al tocar una mesa se abre un panel:
     - con pedido QR esperando → revisarlo y enviarlo a cocina
                                 o descartarlo (Inc. 2)
     - libre         → cuántas personas → pantalla de pedido
     - ocupada       → ver pedidos, agregar pedido, pedir cuenta
     - cuenta pedida → solo ver
     - ocupada o cuenta pedida + ENCARGADO → botón "Cobrar" (Inc. 3):
       formas de pago (pago dividido) o sin cargo. Al cobrar, la
       comanda se cierra y la mesa queda libre.
       Formas: efectivo, transferencia (con foto del comprobante,
       RF-CAJ-13/14) y cargo a habitación (RF-HAB).
     - ocupada o cuenta pedida + ENCARGADO → botón "Anular" en cada
       plato ya enviado (RF-PED-06): motivo obligatorio y dos toques.
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
// 5 s: lo pide la ERS (RNF-REN-02: un agotado se ve en 5 s o menos).
// También hace que un pedido QR aparezca enseguida en el celular del mozo.
const INTERVALO_ACTUALIZACION = 5000;

// formatoPesos() y formatearHora() ahora están en formato.js,
// porque también las usa la pantalla de pedido (y después cocina y caja).

// Mensaje que deja la pantalla de pedido al enviar ("Pedido de la Mesa 3
// enviado a cocina ✔"). Se lee una sola vez y se borra.
let avisoPendiente = sessionStorage.getItem('rest_aviso_mesas');
sessionStorage.removeItem('rest_aviso_mesas');

// Elementos de la página que usamos varias veces
const grillaMesas = document.getElementById('grilla-mesas');
const mensaje = document.getElementById('mensaje');
const avisoQr = document.getElementById('aviso-qr');
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
const btnCobrar = document.getElementById('btn-cobrar');

// Vista de cobro (Inc. 3) — solo el encargado
const vistaCobro = document.getElementById('vista-cobro');
const formCobro = document.getElementById('form-cobro');
const cargandoCobro = document.getElementById('cargando-cobro');
const cobroContenido = document.getElementById('cobro-contenido');
const cobroComanda = document.getElementById('cobro-comanda');
const cobroTotal = document.getElementById('cobro-total');
const checkSinCargo = document.getElementById('check-sin-cargo');
const cobroPagos = document.getElementById('cobro-pagos');
const listaPagos = document.getElementById('lista-pagos');
const btnAgregarPago = document.getElementById('btn-agregar-pago');
const cobroResto = document.getElementById('cobro-resto');
const cobroSinCargo = document.getElementById('cobro-sin-cargo');
const inputMotivo = document.getElementById('input-motivo');
const errorCobro = document.getElementById('error-cobro');
const btnCobroVolver = document.getElementById('btn-cobro-volver');
const btnConfirmarCobro = document.getElementById('btn-confirmar-cobro');
const plantillaPago = document.getElementById('plantilla-pago');

// Vista de pedido por QR (Inc. 2)
const vistaQr = document.getElementById('vista-qr');
const formQr = document.getElementById('form-qr');
const qrHora = document.getElementById('qr-hora');
const cargandoQr = document.getElementById('cargando-qr');
const listaQr = document.getElementById('lista-qr');
const totalQr = document.getElementById('total-qr');
const qrPersonas = document.getElementById('qr-personas');
const inputQrPersonas = document.getElementById('input-qr-personas');
const errorQr = document.getElementById('error-qr');
const btnQrConfirmar = document.getElementById('btn-qr-confirmar');
const btnQrDescartar = document.getElementById('btn-qr-descartar');

// Estado de la pantalla
let mesasActuales = [];       // última lista recibida de api.js
let mesaSeleccionada = null;  // la mesa del panel abierto
let confirmandoCuenta = false; // true después del primer toque en "Pedir cuenta"

// Estado del pedido QR abierto en el panel
let pedidoQrAbierto = null;      // el pedido QR que se está revisando
let resolviendoQr = false;       // true mientras se confirma o descarta (evita doble toque)
let confirmandoDescarte = false; // true después del primer toque en "Descartar"

// Estado del cobro abierto en el panel (Inc. 3)
let cuentaCobro = null;        // { id_comanda, numero, total, ... } de obtenerCuentaMesa
let estadiasCobro = [];        // huéspedes alojados, para el cargo a habitación
let cobrando = false;          // true mientras se manda el cobro (evita doble cobro)
let confirmandoCobro = false;  // true después del primer toque en "Cobrar"

// Estado de la anulación de un plato (RF-PED-06) — solo el encargado
let anulando = false;           // true mientras se manda la anulación (evita doble toque)
let confirmandoAnular = false;  // true después del primer toque en "Confirmar anulación"

// Actualización automática
let temporizador = null;    // el setTimeout de la próxima actualización
let actualizando = false;   // true mientras hay una petición en curso
let ultimoDibujo = '';      // las mesas de la última vez, como texto

// 1) Control de rol: si no tiene permiso, exigirRol lo redirige
//    y devuelve null. En ese caso no hacemos nada más.
const sesion = exigirRol(['encargado', 'mozo']);

// Solo el encargado cobra (en la hostería las recepcionistas
// entran con este rol). Es solo para mostrar u ocultar botones:
// la seguridad real es el backend (rutas /api/caja → 403).
const esEncargado = sesion !== null && sesion.usuario.rol === 'encargado';

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
  // Lo mismo con la Caja (Inc. 3): caja.html usa exigirRol(['encargado'])
  // y las rutas /api/caja responden 403 a los otros roles.
    // Y con las Estadísticas (Inc. 3): estadisticas.html usa exigirRol(['encargado'])
  // y las rutas /api/estadisticas responden 403 a los otros roles.
  // Lo mismo con Usuarios (RF-USU-03): usuarios.html y /api/usuarios.
  if (esEncargado) {
    document.getElementById('enlace-menu').hidden = false;
    document.getElementById('enlace-caja').hidden = false;
    document.getElementById('enlace-estadisticas').hidden = false;
    document.getElementById('enlace-usuarios').hidden = false;
  }

  // UN solo "escuchador" para toda la grilla (delegación de eventos)
  grillaMesas.addEventListener('click', alTocarMesa);

  formPersonas.addEventListener('submit', tomarPedido);
  btnAgregar.addEventListener('click', agregarPedido);
  btnPedirCuenta.addEventListener('click', pedirCuenta);

  // Anular un plato (RF-PED-06): los botones "Anular" se crean y se
  // borran cada vez que se dibujan los pedidos, así que usamos
  // delegación: UN escuchador en la lista para todos.
  listaPedidos.addEventListener('click', alTocarListaPedidos);
  listaPedidos.addEventListener('input', alEscribirMotivoAnular);

  // Cobro (Inc. 3)
  btnCobrar.addEventListener('click', abrirVistaCobro);
  btnCobroVolver.addEventListener('click', volverDeCobro);
  formCobro.addEventListener('submit', confirmarCobro);
  checkSinCargo.addEventListener('change', alCambiarSinCargo);
  inputMotivo.addEventListener('input', reiniciarBotonCobro);
  btnAgregarPago.addEventListener('click', agregarOtroPago);
  // Delegación: UN escuchador para todas las filas de pago,
  // aunque se agreguen o quiten filas después
  listaPagos.addEventListener('input', alCambiarPago);
  listaPagos.addEventListener('change', alCambiarPago);
  listaPagos.addEventListener('click', alQuitarPago);

  // Pedido por QR: "Enviar a cocina" es el submit del formulario
  // (así también funciona la tecla Enter / "Ir" del teclado del celular)
  formQr.addEventListener('submit', confirmarQr);
  btnQrDescartar.addEventListener('click', descartarQr);

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
    // "parpadea" cada 5 segundos sin motivo.
    // (pedidos_qr viene dentro de cada mesa: si llega un pedido QR,
    //  el texto cambia y se redibuja con el aviso)
    const texto = JSON.stringify(mesas);
    if (texto !== ultimoDibujo) {
      dibujarMesas(mesas);
      ultimoDibujo = texto;
    }
    actualizarAvisoQr(mesas);

    // Si venimos de enviar un pedido, lo mostramos una vez.
    // Se va solo en la próxima actualización (5 s).
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

    // PEDIDO POR QR: aviso en la tarjeta (con texto, no solo color,
    // por accesibilidad: igual que en cocina)
    if (mesa.pedidos_qr > 0) {
      tarjeta.classList.add('mesa--qr');
      const qr = document.createElement('span');
      qr.className = 'mesa__qr';
      qr.textContent = '📱 Pedido QR';
      tarjeta.append(qr);
    }

    grillaMesas.append(tarjeta);
  }
}

/* ---------------------------------------------------------
   PEDIDO POR QR: franja arriba de la grilla con las mesas que
   tienen un pedido QR esperando. El mozo mira el celular rápido
   entre mesa y mesa: así no tiene que revisar las 12 tarjetas.
   --------------------------------------------------------- */
function actualizarAvisoQr(mesas) {
  const conQr = mesas
    .filter(m => m.pedidos_qr > 0)
    .sort((a, b) => a.numero - b.numero)
    .map(m => 'Mesa ' + m.numero);

  if (conQr.length === 0) {
    avisoQr.hidden = true;
    avisoQr.textContent = '';
    return;
  }

  const texto = (conQr.length === 1
    ? '📱 Pedido por QR esperando: '
    : '📱 Pedidos por QR esperando: ') + conQr.join(', ');

  // Solo cambiamos el texto si es distinto (aria-live lo leería de nuevo)
  if (avisoQr.textContent !== texto) avisoQr.textContent = texto;
  avisoQr.hidden = false;
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

  // Mostramos solo la vista que corresponde
  vistaLibre.hidden = true;
  vistaOcupada.hidden = true;
  vistaQr.hidden = true;
  vistaCobro.hidden = true;
  panelFondo.hidden = false;

  // Si hay un pedido QR esperando, eso es lo primero: el cliente
  // está esperando que su pedido llegue a cocina
  if (mesa.pedidos_qr > 0) {
    abrirVistaQr(mesa);
  } else if (mesa.estado === 'libre') {
    abrirVistaLibre();
  } else {
    abrirVistaOcupada(mesa);
  }
}

function cerrarPanel() {
  // Mientras se confirma o descarta un pedido QR no se cierra:
  // así el mozo siempre ve cómo terminó
  // Lo mismo mientras se está cobrando: que no quede la duda
  // de si el cobro se hizo o no
  // Y mientras se está anulando un plato, por lo mismo
  if (resolviendoQr || cobrando || anulando) return;

  panelFondo.hidden = true;
  vistaLibre.hidden = true;
  vistaOcupada.hidden = true;
  vistaQr.hidden = true;
  vistaCobro.hidden = true;
  mesaSeleccionada = null;
  pedidoQrAbierto = null;
  cuentaCobro = null;
  confirmandoAnular = false;
  reiniciarBotonCuenta();
  reiniciarBotonDescartar();
  reiniciarBotonCobro();
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
  // "Cobrar": solo el encargado, con la mesa ocupada o la cuenta pedida
  // (en un bar a veces se cobra sin que el mozo haya pedido la cuenta)
  btnCobrar.hidden = !esEncargado;

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
   GUARDADO en el pedido (el del momento en que se pidió).
   Los platos anulados NO llegan (sp_mesa_pedidos filtra anulado = 0),
   así que el total coincide con rest_comanda.total, que es con el
   que se cobra. */
function dibujarPedidos(pedidos) {
  listaPedidos.textContent = '';
  confirmandoAnular = false;

  // Un pedido al que se le anularon TODOS los platos llega sin ítems:
  // no lo mostramos (sería una tarjeta vacía).
  const visibles = pedidos.filter(p => p.items.length > 0);

  if (visibles.length === 0) {
    const vacio = document.createElement('li');
    vacio.className = 'mensaje';
    vacio.textContent = pedidos.length === 0
      ? 'Todavía no hay pedidos en esta mesa.'
      : 'No quedan platos en esta mesa (se anularon todos).';
    listaPedidos.append(vacio);
    totalMesa.textContent = formatoPesos(0);
    return;
  }

  let total = 0;

  for (const pedido of visibles) {
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
      liItem.className = 'item-mesa';

      const texto = document.createElement('span');
      texto.className = 'item-mesa__texto';
      texto.textContent = item.cantidad + ' × ' + item.nombre +
        ' — ' + formatoPesos(subtotal);

      if (item.observaciones) {
        const obs = document.createElement('span');
        obs.className = 'pedido__obs';
        obs.textContent = item.observaciones;
        texto.append(obs);
      }
      liItem.append(texto);

      // "Anular": solo el encargado, y solo si sabemos qué renglón es.
      // Ocultarlo es solo interfaz: el backend responde 403 a otros roles.
      if (esEncargado && item.id_pedido_item) {
        const descripcion = item.cantidad + ' × ' + item.nombre;
        const botonAnular = document.createElement('button');
        botonAnular.type = 'button';
        botonAnular.className = 'boton boton--secundario item-mesa__anular';
        botonAnular.textContent = 'Anular';
        botonAnular.setAttribute('aria-label', 'Anular ' + descripcion);
        // Guardamos en el botón qué renglón es y cómo se llama
        botonAnular.dataset.id = item.id_pedido_item;
        botonAnular.dataset.descripcion = descripcion;
        liItem.append(botonAnular);
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
    actualizar(); // la mesa pasa a rojo en la grilla, sin esperar 5 s
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

/* =========================================================
   ANULAR UN PLATO YA ENVIADO (RF-PED-06) — solo el encargado
   ---------------------------------------------------------
   1. "Anular" en un plato → debajo aparece el motivo con
      "Cancelar" y "Confirmar anulación". Uno solo abierto a la vez.
   2. "Confirmar anulación" en dos toques (como "Pedir cuenta"):
      el primer toque revisa el motivo, el segundo anula.
   3. La base (sp_item_anular) marca el plato, recalcula el total
      de la comanda y guarda la auditoría, todo junto.
   4. Se vuelven a traer los pedidos: el plato desaparece y el
      total baja. Cocina deja de verlo sola en su próxima
      actualización.
   El formulario se arma con createElement (no innerHTML), igual
   que el resto de la pantalla.
   LARGO_MIN_MOTIVO_ANULAR y LARGO_MAX_MOTIVO_ANULAR están en api.js:
   son las mismas reglas que usa anularItem.
   ========================================================= */

// Un solo escuchador para todos los botones de la lista (delegación)
function alTocarListaPedidos(evento) {
  const botonAnular = evento.target.closest('.item-mesa__anular');
  if (botonAnular) {
    abrirFormAnular(botonAnular);
    return;
  }
  if (evento.target.closest('.anular__cancelar')) {
    cerrarFormAnular();
    return;
  }
  const botonConfirmar = evento.target.closest('.anular__confirmar');
  if (botonConfirmar) {
    confirmarAnulacion(botonConfirmar.closest('.anular'));
  }
}

// Arma el formulario del motivo debajo del plato
function abrirFormAnular(botonAnular) {
  if (anulando) return;
  cerrarFormAnular(); // si había otro abierto, lo cerramos

  const liItem = botonAnular.closest('.item-mesa');

  const form = document.createElement('div');
  form.className = 'anular';
  form.dataset.id = botonAnular.dataset.id;
  form.dataset.descripcion = botonAnular.dataset.descripcion;

  const campo = document.createElement('div');
  campo.className = 'campo';

  const etiqueta = document.createElement('label');
  etiqueta.htmlFor = 'input-motivo-anular';
  etiqueta.textContent = 'Motivo para anular ' + botonAnular.dataset.descripcion;

  const motivo = document.createElement('textarea');
  motivo.id = 'input-motivo-anular';
  motivo.className = 'anular__motivo';
  motivo.rows = 2;
  motivo.maxLength = LARGO_MAX_MOTIVO_ANULAR;
  motivo.placeholder = 'Ej.: el cliente no lo quiso / se cargó por error';

  campo.append(etiqueta, motivo);

  const error = document.createElement('p');
  error.className = 'mensaje mensaje--error anular__error';
  error.setAttribute('role', 'alert');
  error.hidden = true;

  const acciones = document.createElement('div');
  acciones.className = 'panel__acciones';

  const cancelar = document.createElement('button');
  cancelar.type = 'button';
  cancelar.className = 'boton boton--secundario anular__cancelar';
  cancelar.textContent = 'Cancelar';

  const confirmar = document.createElement('button');
  confirmar.type = 'button';
  confirmar.className = 'boton boton--peligro anular__confirmar';
  confirmar.textContent = 'Confirmar anulación';

  acciones.append(cancelar, confirmar);
  form.append(campo, error, acciones);
  liItem.append(form);

  botonAnular.hidden = true; // mientras está abierto, no hace falta
  confirmandoAnular = false;
  motivo.focus();
}

// Cierra el formulario abierto (si hay) y vuelve a mostrar su "Anular"
function cerrarFormAnular() {
  if (anulando) return;
  const abierto = listaPedidos.querySelector('.anular');
  if (!abierto) return;

  const liItem = abierto.closest('.item-mesa');
  abierto.remove();
  const botonAnular = liItem ? liItem.querySelector('.item-mesa__anular') : null;
  if (botonAnular) botonAnular.hidden = false;
  confirmandoAnular = false;
}

// Si cambia el motivo, hay que volver a confirmar
function alEscribirMotivoAnular(evento) {
  if (evento.target.classList.contains('anular__motivo')) {
    reiniciarBotonAnular(evento.target.closest('.anular'));
  }
}

// Deja el botón "Confirmar anulación" como al principio
function reiniciarBotonAnular(form) {
  confirmandoAnular = false;
  if (!form) return;
  const boton = form.querySelector('.anular__confirmar');
  boton.disabled = false;
  boton.textContent = 'Confirmar anulación';
}

async function confirmarAnulacion(form) {
  if (anulando || !form || !mesaSeleccionada) return;

  const motivo = form.querySelector('.anular__motivo').value.trim();
  const error = form.querySelector('.anular__error');
  const botonConfirmar = form.querySelector('.anular__confirmar');
  const botonCancelar = form.querySelector('.anular__cancelar');
  const descripcion = form.dataset.descripcion;

  // Primer toque: revisamos el motivo y pedimos confirmación
  if (!confirmandoAnular) {
    if (motivo.length < LARGO_MIN_MOTIVO_ANULAR) {
      error.textContent = 'Escribí el motivo (mínimo ' + LARGO_MIN_MOTIVO_ANULAR + ' letras).';
      error.hidden = false;
      form.querySelector('.anular__motivo').focus();
      return;
    }
    error.hidden = true;
    confirmandoAnular = true;
    botonConfirmar.textContent = '¿Anular ' + descripcion + '? Tocá de nuevo';
    return;
  }

  // Segundo toque: se anula. Bloqueamos los botones (doble toque).
  const mesa = mesaSeleccionada;
  anulando = true;
  botonConfirmar.disabled = true;
  botonCancelar.disabled = true;
  botonConfirmar.textContent = 'Anulando…';

  try {
    const r = await anularItem(Number(form.dataset.id), motivo);
    anulando = false;
    confirmandoAnular = false;

    // Si mientras tanto cerró el panel o tocó otra mesa, no redibujamos
    if (!mesaSeleccionada || mesaSeleccionada.id !== mesa.id) return;

    // Volvemos a traer los pedidos: el plato ya no viene y el total baja
    await abrirVistaOcupada(mesa);
    mostrarAvisoOcupada('Anulado: ' + descripcion + ' ✔ · Total nuevo: ' + formatoPesos(r.total));
    actualizar();
  } catch (e) {
    anulando = false;
    confirmandoAnular = false;

    if (e.estado === 401) {
      manejarError(e, mostrarErrorOcupada);
      return;
    }

    // 404 / 409: otro encargado ya lo anuló, o la mesa se cobró.
    // Mostramos cómo está la mesa AHORA, con el mensaje del servidor.
    if (e.estado === 404 || e.estado === 409) {
      if (mesaSeleccionada && mesaSeleccionada.id === mesa.id) {
        await abrirVistaOcupada(mesa);
        mostrarErrorOcupada(e.message);
      }
      actualizar();
      return;
    }

    // Otro error (motivo, sin conexión): queda abierto para reintentar
    botonCancelar.disabled = false;
    reiniciarBotonAnular(form);
    error.textContent = e.message;
    error.hidden = false;
  }
}

/* =========================================================
   PEDIDO POR QR (Inc. 2 – RF-QR-05)
   El pedido del cliente llega primero al mozo: lo revisa y lo
   envía a cocina (si la mesa está libre, carga las personas y
   ahí se abre la mesa) o lo descarta.
   ========================================================= */
async function abrirVistaQr(mesa) {
  panelTitulo.textContent = 'Mesa ' + mesa.numero + ' · Pedido por QR';

  // Limpiamos lo que haya quedado de la vez anterior
  pedidoQrAbierto = null;
  qrHora.textContent = '';
  listaQr.textContent = '';
  totalQr.textContent = formatoPesos(0);
  inputQrPersonas.value = '';
  qrPersonas.hidden = true;
  errorQr.hidden = true;
  btnQrConfirmar.hidden = false;
  btnQrConfirmar.disabled = true;   // hasta que cargue el pedido
  btnQrDescartar.disabled = true;
  reiniciarBotonDescartar();
  cargandoQr.hidden = false;
  vistaQr.hidden = false;

  try {
    const pedidosQr = await obtenerPedidosQr();

    // El mozo pudo cerrar el panel o tocar otra mesa mientras esperábamos
    if (!mesaSeleccionada || mesaSeleccionada.id !== mesa.id) return;

    const pedidoQr = pedidosQr.find(p => p.mesa_id === mesa.id);
    if (!pedidoQr) {
      // Otro mozo lo confirmó o descartó hace un momento
      cerrarPanel();
      avisoPendiente = 'El pedido QR de la Mesa ' + mesa.numero + ' ya lo resolvió otro mozo.';
      actualizar();
      return;
    }

    mostrarPedidoQr(pedidoQr);
  } catch (error) {
    manejarError(error, mostrarErrorQr);
  } finally {
    cargandoQr.hidden = true;
  }
}

/* Dibuja el pedido QR en el panel.
   El total es ESTIMADO: usa el precio actual del menú. El precio
   definitivo lo guarda el backend al confirmar (RF-MEN-04). */
function mostrarPedidoQr(pedidoQr) {
  pedidoQrAbierto = pedidoQr;
  qrHora.textContent = 'Llegó a las ' + formatearHora(pedidoQr.creado_en);

  listaQr.textContent = '';
  const li = document.createElement('li');
  li.className = 'pedido';
  const ul = document.createElement('ul');
  ul.className = 'pedido__items';

  let total = 0;
  for (const item of pedidoQr.items) {
    const subtotal = item.cantidad * item.precio;
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
  li.append(ul);
  listaQr.append(li);
  totalQr.textContent = formatoPesos(total);

  // Mesa libre: hay que cargar las personas (al confirmar se abre la mesa)
  qrPersonas.hidden = !pedidoQr.mesa_libre;

  // Si la mesa ya pidió la cuenta, el pedido solo se puede descartar
  const mesa = mesasActuales.find(m => m.id === pedidoQr.mesa_id);
  if (mesa && mesa.estado === 'cuenta_pedida') {
    btnQrConfirmar.hidden = true;
    mostrarErrorQr('Esta mesa ya pidió la cuenta: el pedido no se puede enviar a cocina. Descartalo y, si hace falta, hablá con el encargado.');
  }

  btnQrConfirmar.disabled = false;
  btnQrDescartar.disabled = false;

  if (pedidoQr.mesa_libre) inputQrPersonas.focus(); // teclado numérico en el celular
}

// "Enviar a cocina"
async function confirmarQr(evento) {
  evento.preventDefault(); // que el formulario no recargue la página
  if (resolviendoQr || !pedidoQrAbierto) return;

  const pedidoQr = pedidoQrAbierto;
  let personas;

  // Las personas solo se piden si la mesa está libre.
  // El backend valida lo mismo (el frontend se puede saltear).
  if (pedidoQr.mesa_libre) {
    personas = Number(inputQrPersonas.value);
    if (!Number.isInteger(personas) || personas < 1 || personas > MAX_PERSONAS) {
      mostrarErrorQr('Ingresá cuántas personas hay en la mesa (entre 1 y ' + MAX_PERSONAS + ').');
      inputQrPersonas.focus();
      return;
    }
  }

  resolviendoQr = true;
  errorQr.hidden = true;
  btnQrConfirmar.disabled = true;
  btnQrDescartar.disabled = true;
  btnQrConfirmar.textContent = 'Enviando…';

  try {
    await confirmarPedidoQr(pedidoQr.id, personas);
    resolviendoQr = false;
    btnQrConfirmar.textContent = 'Enviar a cocina';
    terminarQr('Pedido QR de la Mesa ' + pedidoQr.mesa_numero + ' enviado a cocina ✔');
  } catch (error) {
    resolviendoQr = false;
    btnQrConfirmar.textContent = 'Enviar a cocina';
    await revisarErrorQr(error);
  }
}

/* "Descartar pedido" con confirmación en dos toques (como "Pedir cuenta"):
   no se puede deshacer y el cliente tendría que volver a pedir. */
async function descartarQr() {
  if (resolviendoQr || !pedidoQrAbierto) return;

  if (!confirmandoDescarte) {
    confirmandoDescarte = true;
    btnQrDescartar.textContent = '¿Seguro? Tocá de nuevo para descartar';
    return;
  }

  const pedidoQr = pedidoQrAbierto;
  resolviendoQr = true;
  errorQr.hidden = true;
  btnQrConfirmar.disabled = true;
  btnQrDescartar.disabled = true;

  try {
    await descartarPedidoQr(pedidoQr.id);
    resolviendoQr = false;
    terminarQr('Pedido QR de la Mesa ' + pedidoQr.mesa_numero + ' descartado');
  } catch (error) {
    resolviendoQr = false;
    reiniciarBotonDescartar();
    await revisarErrorQr(error);
  }
}

// Confirmado o descartado: cerramos y actualizamos la grilla ya
// (sin esperar 5 s). El aviso se muestra en la próxima carga.
function terminarQr(textoAviso) {
  cerrarPanel();
  avisoPendiente = textoAviso;
  actualizar();
}

/* Si falló confirmar o descartar, nos fijamos si el pedido SIGUE
   en la bandeja:
   - Ya no está → lo resolvió otro mozo: cerramos con un aviso.
   - Sigue      → mostramos el error (por ejemplo, un plato agotado)
                  y dejamos el pedido abierto para que decida. */
async function revisarErrorQr(error) {
  if (error.estado === 401) {
    manejarError(error, mostrarErrorQr);
    return;
  }

  let sigue = null;
  try {
    const pedidosQr = await obtenerPedidosQr();
    sigue = pedidosQr.find(p => pedidoQrAbierto && p.id === pedidoQrAbierto.id) || null;
  } catch (e) {
    // Sin conexión: no sabemos. Dejamos el pedido abierto con el error.
    sigue = pedidoQrAbierto;
  }

  if (!sigue) {
    const numero = pedidoQrAbierto ? pedidoQrAbierto.mesa_numero : '';
    terminarQr('El pedido QR de la Mesa ' + numero + ' ya lo resolvió otro mozo.');
    return;
  }

  mostrarPedidoQr(sigue);   // por si cambió algo (por ejemplo, la mesa ya no está libre)
  mostrarErrorQr(error.message);
}

// Deja el botón "Descartar pedido" como al principio
function reiniciarBotonDescartar() {
  confirmandoDescarte = false;
  btnQrDescartar.disabled = false;
  btnQrDescartar.textContent = 'Descartar pedido';
}

/* =========================================================
   COBRO DE LA MESA (Inc. 3 – RF-CAJ-04/05) — solo el encargado
   ---------------------------------------------------------
   1. Se piden a la vez el turno de caja y la cuenta de la mesa.
      Si la caja está cerrada, no se puede cobrar.
   2. El total sale de la BASE (rest_comanda.total), no de sumar
      los ítems en pantalla: es el mismo con el que el backend
      compara el cobro.
   3. Formas de pago: hasta MAX_PAGOS filas (pago dividido).
      Tienen que sumar justo el total. O "Sin cargo" con motivo.
   4. "Cobrar" se confirma con dos toques, como "Pedir cuenta".
   5. Al cobrar, el backend cierra la comanda: la mesa queda libre.
   MAX_PAGOS, MEDIOS_TRANSFERENCIA, aCentavos, limpiarPagos y
   validarCobro están en api.js: son LAS MISMAS reglas que usa
   cobrarComanda, así no hay dos versiones distintas.
   ========================================================= */
async function abrirVistaCobro() {
  const mesa = mesaSeleccionada;
  if (!mesa || !esEncargado) return;

  panelTitulo.textContent = 'Mesa ' + mesa.numero + ' · Cobrar';
  vistaOcupada.hidden = true;

  // Limpiamos lo que haya quedado de la vez anterior
  cuentaCobro = null;
  reiniciarBotonCobro();
  btnConfirmarCobro.disabled = true;  // hasta que cargue la cuenta
  errorCobro.hidden = true;
  cobroContenido.hidden = true;
  checkSinCargo.checked = false;
  inputMotivo.value = '';
  listaPagos.textContent = '';
  cobroResto.textContent = '';
  cargandoCobro.hidden = false;
  vistaCobro.hidden = false;

  try {
    // Las dos consultas A LA VEZ (Promise.all): tarda lo que la más
    // lenta, no la suma de las dos
    // Los huéspedes alojados también: si esa consulta falla, igual se
    // puede cobrar en efectivo o transferencia (por eso el .catch).
    const [caja, cuenta, estadias] = await Promise.all([
      obtenerTurnoActual(),
      obtenerCuentaMesa(mesa.id),
      obtenerEstadiasActivas().catch(() => [])
    ]);

    // Mientras esperábamos, pudo cerrar el panel, volver o tocar otra mesa
    if (!mesaSeleccionada || mesaSeleccionada.id !== mesa.id || vistaCobro.hidden) return;

    if (!caja.abierto) {
      mostrarErrorCobro('La caja está cerrada. Abrila desde el botón Caja (arriba) y volvé a cobrar.');
      return;
    }
    if (!cuenta) {
      // Otro encargado la cobró hace un momento (o se cerró la comanda)
      mostrarErrorCobro('Esta mesa ya no tiene una cuenta abierta. Puede que ya se haya cobrado.');
      actualizar();
      return;
    }

    cuentaCobro = cuenta;
    estadiasCobro = estadias;
    cobroComanda.textContent = 'Comanda N° ' + cuenta.numero + ' · ' +
      cuenta.personas + (Number(cuenta.personas) === 1 ? ' persona' : ' personas') +
      (cuenta.mozo ? ' · Mozo: ' + cuenta.mozo : '');
    cobroTotal.textContent = formatoPesos(cuenta.total);

    // Arranca con UNA fila: efectivo por el total (lo más común).
    // Si la cuenta está en $ 0 (no se pidió nada), se cierra sin pagos.
    if (cuenta.total > 0) {
      agregarFilaPago('efectivo', cuenta.total);
    }
    actualizarFilasPago();
    alCambiarSinCargo();

    cobroContenido.hidden = false;
    btnConfirmarCobro.disabled = false;
  } catch (error) {
    manejarError(error, mostrarErrorCobro);
  } finally {
    cargandoCobro.hidden = true;
  }
}

// "Volver": a la vista de la mesa (pedidos y total)
function volverDeCobro() {
  if (cobrando || !mesaSeleccionada) return;
  vistaCobro.hidden = true;
  cuentaCobro = null;
  reiniciarBotonCobro();
  const mesa = mesaSeleccionada;
  panelTitulo.textContent = 'Mesa ' + mesa.numero + ' · ' +
    (TEXTO_ESTADO[mesa.estado] || mesa.estado);
  abrirVistaOcupada(mesa);
}

/* Agrega una fila de pago copiando la <template> de mesas.html.
   cloneNode(true) copia la fila con todo lo que tiene adentro. */
function agregarFilaPago(forma, importe) {
  if (listaPagos.children.length >= MAX_PAGOS) return null;

  const fila = plantillaPago.content.firstElementChild.cloneNode(true);
  const selectForma = fila.querySelector('.pago__forma');
  const inputImporte = fila.querySelector('.pago__importe');
  const selectMedio = fila.querySelector('.pago__medio');

  // Los medios salen de api.js (BNA+, Mercado Pago...): a confirmar
  // con la hostería, y si cambian se tocan en UN solo lugar
  for (const medio of MEDIOS_TRANSFERENCIA) {
    const opcion = document.createElement('option');
    opcion.value = medio;
    opcion.textContent = medio;
    selectMedio.append(opcion);
  }

  // Huéspedes alojados para el cargo a habitación: "Hab. 5 – Gómez, María".
  // Si no hay ninguno, la opción queda deshabilitada y lo dice.
  const selectEstadia = fila.querySelector('.pago__estadia');
  for (const e of estadiasCobro) {
    const opcion = document.createElement('option');
    opcion.value = e.id;
    opcion.textContent = 'Hab. ' + e.habitacion + ' – ' + e.huesped;
    selectEstadia.append(opcion);
  }
  if (estadiasCobro.length === 0) {
    const opcionCargo = selectForma.querySelector('option[value="cargo_habitacion"]');
    opcionCargo.disabled = true;
    opcionCargo.textContent = 'Cargo a habitación (no hay huéspedes alojados)';
  }

  selectForma.value = forma;
  inputImporte.value = importe > 0 ? importe : '';
  mostrarCamposPago(fila);

  listaPagos.append(fila);
  return fila;
}

/* Muestra en la fila solo los campos de la forma elegida:
   - transferencia    → medio + foto del comprobante
   - cargo_habitacion → habitación
   - efectivo         → nada más */
function mostrarCamposPago(fila) {
  const forma = fila.querySelector('.pago__forma').value;
  fila.querySelector('.pago__medio').hidden = forma !== 'transferencia';
  fila.querySelector('.pago__comprobante').hidden = forma !== 'transferencia';
  fila.querySelector('.pago__estadia').hidden = forma !== 'cargo_habitacion';
}

/* "+ Agregar otra forma de pago": la fila nueva viene con lo que
   FALTA para llegar al total. Si el cliente paga una parte en
   efectivo, el encargado corrige el importe de la primera fila y
   en la nueva ya aparece el resto. Por defecto, transferencia
   (lo más común como segundo pago). */
function agregarOtroPago() {
  if (!cuentaCobro) return;
  const falta = (aCentavos(cuentaCobro.total) - sumaPagosCentavos()) / 100;
  const fila = agregarFilaPago('transferencia', falta > 0 ? falta : 0);
  if (!fila) return;
  actualizarFilasPago();
  reiniciarBotonCobro();
  // En transferencia lo primero que falta elegir es el medio
  fila.querySelector('.pago__medio').focus();
}

// Tocar ✕ en una fila (delegación de eventos)
function alQuitarPago(evento) {
  const boton = evento.target.closest('.pago__quitar');
  if (!boton || boton.disabled) return;
  boton.closest('.pago').remove();
  actualizarFilasPago();
  reiniciarBotonCobro();
}

// Cambió la forma, el importe o el medio de alguna fila
function alCambiarPago(evento) {
  const fila = evento.target.closest('.pago');
  if (!fila) return;

  // Eligió una foto: se procesa una sola vez (el input de archivo
  // dispara "input" y "change": usamos solo "change")
  if (evento.target.classList.contains('pago__foto')) {
    if (evento.type === 'change') cargarFotoComprobante(fila, evento.target);
    return;
  }

  // Si cambió la forma: mostramos sus campos y borramos los de las otras
  if (evento.target.classList.contains('pago__forma')) {
    mostrarCamposPago(fila);
    const forma = evento.target.value;
    if (forma !== 'transferencia') {
      fila.querySelector('.pago__medio').value = '';
      borrarFoto(fila);
    }
    if (forma !== 'cargo_habitacion') {
      fila.querySelector('.pago__estadia').value = '';
    }
  }

  actualizarResto();
  reiniciarBotonCobro(); // si cambió algo, hay que volver a confirmar
}

/* Habilita o deshabilita los botones según cuántas filas hay:
   - no se puede agregar más de MAX_PAGOS
   - no se puede quitar la ÚLTIMA fila (si la cuenta es mayor a $ 0) */
function actualizarFilasPago() {
  const filas = listaPagos.querySelectorAll('.pago');
  btnAgregarPago.disabled = filas.length >= MAX_PAGOS || !cuentaCobro || cuentaCobro.total === 0;
  filas.forEach(f => {
    f.querySelector('.pago__quitar').disabled = filas.length === 1;
  });
  actualizarResto();
}

// Lee las filas de pago tal como están en pantalla
function leerPagos() {
  return Array.from(listaPagos.querySelectorAll('.pago')).map(fila => ({
    forma: fila.querySelector('.pago__forma').value,
    importe: fila.querySelector('.pago__importe').value,
    medio: fila.querySelector('.pago__medio').value,
    id_estadia: fila.querySelector('.pago__estadia').value,
    // Nombre de la foto ya subida (lo guarda cargarFotoComprobante)
    comprobante: fila.dataset.comprobante || ''
  }));
}

// Suma de los importes en CENTAVOS (ver aCentavos en api.js).
// Un importe vacío o mal escrito cuenta como 0.
function sumaPagosCentavos() {
  return leerPagos().reduce((suma, p) => {
    const n = Number(p.importe);
    return suma + (Number.isFinite(n) && n > 0 ? aCentavos(n) : 0);
  }, 0);
}

/* Renglón "Falta / Sobra / ✔": se actualiza mientras escribe.
   Ojo: se carga lo que se COBRA, no con cuánto paga el cliente.
   Si paga $ 20.000 una cuenta de $ 17.000, se cargan $ 17.000
   (el vuelto no entra en la caja). */
function actualizarResto() {
  if (!cuentaCobro || checkSinCargo.checked) {
    cobroResto.textContent = '';
    return;
  }
  const diferencia = aCentavos(cuentaCobro.total) - sumaPagosCentavos();

  if (diferencia > 0) {
    cobroResto.textContent = 'Falta ' + formatoPesos(diferencia / 100);
    cobroResto.className = 'cobro-resto cobro-resto--falta';
  } else if (diferencia < 0) {
    cobroResto.textContent = 'Sobra ' + formatoPesos(-diferencia / 100) +
      ': cargá lo que se cobra, no con cuánto paga el cliente';
    cobroResto.className = 'cobro-resto cobro-resto--sobra';
  } else {
    cobroResto.textContent = '✔ Los pagos suman el total';
    cobroResto.className = 'cobro-resto cobro-resto--ok';
  }
}

// "Sin cargo": se ocultan los pagos y se pide el motivo
function alCambiarSinCargo() {
  const sinCargo = checkSinCargo.checked;
  cobroPagos.hidden = sinCargo;
  cobroSinCargo.hidden = !sinCargo;
  errorCobro.hidden = true;
  reiniciarBotonCobro();
  actualizarResto();
  if (sinCargo) inputMotivo.focus();
}

/* "Cobrar" con confirmación en dos toques.
   Primer toque: validamos (mismas reglas que api.js) y pedimos
   confirmación mostrando el importe. Segundo toque: se cobra. */
async function confirmarCobro(evento) {
  evento.preventDefault(); // que el formulario no recargue la página
  if (cobrando || !cuentaCobro) return;

  const sinCargo = checkSinCargo.checked;
  const datos = {
    total: cuentaCobro.total,          // el total que se MOSTRÓ
    sin_cargo: sinCargo,
    motivo: inputMotivo.value.trim(),
    pagos: sinCargo ? [] : leerPagos()
  };

  // Si una foto se está subiendo, esperamos: si no, el cobro saldría sin ella
  if (listaPagos.querySelector('.pago[data-subiendo="1"]')) {
    mostrarErrorCobro('Esperá a que termine de subir la foto del comprobante.');
    return;
  }

  if (!confirmandoCobro) {
    // Validamos antes de pedir confirmación, así el error aparece
    // al primer toque. limpiarPagos hace una COPIA: no toca la pantalla.
    try {
      validarCobro(datos.total, sinCargo ? [] : limpiarPagos(datos.pagos), sinCargo, datos.motivo);
    } catch (error) {
      mostrarErrorCobro(error.message);
      if (sinCargo) inputMotivo.focus();
      return;
    }
    errorCobro.hidden = true;
    confirmandoCobro = true;
    btnConfirmarCobro.textContent = sinCargo
      ? '¿Sin cargo? Tocá de nuevo'
      : '¿Cobrar ' + formatoPesos(datos.total) + '? Tocá de nuevo';
    return;
  }

  // Segundo toque: se cobra. Bloqueamos todo para que un doble
  // toque no mande dos cobros (igual el backend rechaza el segundo:
  // la comanda ya quedó cerrada).
  const mesa = mesaSeleccionada;
  const cuenta = cuentaCobro;
  cobrando = true;
  btnConfirmarCobro.disabled = true;
  btnCobroVolver.disabled = true;
  btnConfirmarCobro.textContent = 'Cobrando…';

  try {
    await cobrarComanda(cuenta.id_comanda, datos);
    cobrando = false;
    btnCobroVolver.disabled = false;
    cerrarPanel();
    // Si una parte fue a la cuenta de una habitación, lo decimos
    const cargos = sinCargo ? [] : datos.pagos.filter(p => p.forma === 'cargo_habitacion');
    const textoCargo = cargos.map(p => {
      const e = estadiasCobro.find(x => String(x.id) === String(p.id_estadia));
      return formatoPesos(p.importe) + ' a la Hab. ' + (e ? e.habitacion : '?');
    }).join(', ');
    avisoPendiente = sinCargo
      ? 'Mesa ' + mesa.numero + ' cerrada sin cargo ✔ (Comanda N° ' + cuenta.numero + ')'
      : 'Mesa ' + mesa.numero + ' cobrada ✔ ' + formatoPesos(cuenta.total) +
        ' (Comanda N° ' + cuenta.numero + ')' +
        (textoCargo ? ' · Cargado ' + textoCargo + ': lo cobra recepción' : '');
    actualizar(); // la mesa pasa a libre en la grilla, sin esperar 5 s
  } catch (error) {
    cobrando = false;
    btnCobroVolver.disabled = false;
    reiniciarBotonCobro();

    // Si el mozo agregó algo mientras se cobraba, el backend avisa que
    // el total cambió: volvemos a traer la cuenta y mostramos el aviso
    if (/total de la cuenta cambi/i.test(error.message)) {
      await abrirVistaCobro();
      mostrarErrorCobro('La cuenta cambió (se agregó o anuló algo). Revisá el total nuevo y volvé a cobrar.');
      return;
    }
    manejarError(error, mostrarErrorCobro);
  }
}

/* =========================================================
   FOTO DEL COMPROBANTE DE TRANSFERENCIA (RF-CAJ-13/14)
   ---------------------------------------------------------
   1. El encargado toca "📷 Foto del comprobante": el celular abre
      la cámara o la galería.
   2. Achicamos la foto en el navegador con un <canvas> (sin
      librerías): una foto de celular pesa 3–5 MB, achicada queda en
      unos 200 KB. Así sube rápido por el wifi y ocupa poco en el
      servidor.
   3. La subimos enseguida (subirComprobante, api.js) y guardamos en
      la fila el nombre que nos devuelve el servidor.
   4. Al cobrar, ese nombre viaja con el pago.
   Es OPCIONAL (propuesta): en la caja se ve qué transferencias
   quedaron "sin comprobante", para controlarlas.
   ========================================================= */
const FOTO_LADO_MAXIMO = 1280; // px: se lee bien un comprobante
const FOTO_CALIDAD = 0.7;      // calidad JPG (0 a 1)

async function cargarFotoComprobante(fila, input) {
  const archivo = input.files && input.files[0];
  input.value = ''; // así se puede volver a elegir la misma foto
  if (!archivo) return;

  const estado = fila.querySelector('.pago__foto-estado');
  const vista = fila.querySelector('.pago__foto-vista');

  borrarFoto(fila);
  fila.dataset.subiendo = '1';
  reiniciarBotonCobro();
  mostrarEstadoFoto(estado, 'Subiendo foto…', '');

  try {
    const imagen = await achicarFoto(archivo);
    const nombre = await subirComprobante(imagen);
    fila.dataset.comprobante = nombre;
    vista.src = imagen;   // la misma foto achicada, sin volver a pedirla
    vista.hidden = false;
    mostrarEstadoFoto(estado, '✔ Foto cargada', 'ok');
  } catch (error) {
    if (error.estado === 401) {
      manejarError(error, mostrarErrorCobro);
      return;
    }
    mostrarEstadoFoto(estado, error.message + ' Probá de nuevo.', 'error');
  } finally {
    delete fila.dataset.subiendo;
  }
}

// Saca la foto de la fila (cambió de forma de pago o eligió otra)
function borrarFoto(fila) {
  delete fila.dataset.comprobante;
  const vista = fila.querySelector('.pago__foto-vista');
  vista.hidden = true;
  vista.removeAttribute('src');
  mostrarEstadoFoto(fila.querySelector('.pago__foto-estado'), 'Opcional', '');
}

function mostrarEstadoFoto(elemento, texto, tipo) {
  elemento.textContent = texto;
  elemento.className = 'pago__foto-estado' + (tipo ? ' pago__foto-estado--' + tipo : '');
}

/* Achica una foto y la devuelve como texto "data:image/jpeg;base64,...".
   Pasos: archivo → FileReader (texto data:) → <img> → <canvas> más
   chico → JPG. Usamos data: y no URL.createObjectURL porque la
   seguridad de la página (helmet) solo deja mostrar imágenes "data:". */
function achicarFoto(archivo) {
  return new Promise((resolver, rechazar) => {
    if (!archivo.type || !archivo.type.startsWith('image/')) {
      rechazar(new Error('El archivo no es una foto.'));
      return;
    }

    const lector = new FileReader();
    lector.onerror = () => rechazar(new Error('No se pudo leer la foto.'));
    lector.onload = () => {
      const img = new Image();
      img.onerror = () => rechazar(new Error('No se pudo abrir la foto.'));
      img.onload = () => {
        // Escala para que el lado más largo mida como máximo FOTO_LADO_MAXIMO
        const escala = Math.min(1, FOTO_LADO_MAXIMO / Math.max(img.width, img.height));
        const lienzo = document.createElement('canvas');
        lienzo.width = Math.round(img.width * escala);
        lienzo.height = Math.round(img.height * escala);
        const ctx = lienzo.getContext('2d');
        ctx.fillStyle = '#fff'; // fondo blanco (un PNG transparente no queda negro)
        ctx.fillRect(0, 0, lienzo.width, lienzo.height);
        ctx.drawImage(img, 0, 0, lienzo.width, lienzo.height);
        resolver(lienzo.toDataURL('image/jpeg', FOTO_CALIDAD));
      };
      img.src = lector.result;
    };
    lector.readAsDataURL(archivo);
  });
}

// Deja el botón "Cobrar" como al principio
function reiniciarBotonCobro() {
  confirmandoCobro = false;
  if (cobrando) return;
  btnConfirmarCobro.disabled = false;
  btnConfirmarCobro.textContent = checkSinCargo.checked ? 'Cerrar sin cargo' : 'Cobrar';
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
  errorOcupada.className = 'mensaje mensaje--error';
  errorOcupada.hidden = false;
}

// Mensaje informativo en el panel de la mesa (no es error):
// "Anulado: 1 × Vino tinto (copa) ✔". Usa el mismo lugar que el error.
function mostrarAvisoOcupada(texto) {
  errorOcupada.textContent = texto;
  errorOcupada.className = 'mensaje';
  errorOcupada.hidden = false;
}

function mostrarErrorQr(texto) {
  errorQr.textContent = texto;
  errorQr.hidden = false;
}

function mostrarErrorCobro(texto) {
  errorCobro.textContent = texto;
  errorCobro.hidden = false;
}