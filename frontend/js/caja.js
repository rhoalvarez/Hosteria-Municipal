/* =========================================================
   caja.js — Pantalla de caja (RF-CAJ) — Incremento 3
   ---------------------------------------------------------
   Solo el ENCARGADO (en la hostería, las recepcionistas
   entran con ese rol).
   - Caja cerrada → abrir un turno con el efectivo del cajón,
                    ver el arqueo del último cierre y, si hace
                    falta, REABRIR ese último turno (con motivo).
   - Caja abierta → resumen del turno (efectivo, transferencias,
                    saldo total, mesas cobradas), movimientos,
                    movimiento manual (gastos) y cierre con arqueo.
   - Siempre      → historial de turnos (se carga con un botón)
                    y detalle de cada turno (solo lectura).
   Los cobros de las mesas se hacen desde Mesas (botón Cobrar).
   Las cuentas de la caja las hace la BASE (vista v_caja_resumen):
   la pantalla solo muestra lo que le llega. Así hay un solo
   lugar donde se calcula, igual para todas las pantallas.
   Los datos SIEMPRE se piden a api.js, nunca con fetch directo.
   ========================================================= */

// Cada cuánto se actualiza el resumen (en milisegundos).
// Mientras la caja está abierta, el encargado (u otra recepcionista)
// puede cobrar mesas desde otro dispositivo: así se ve sin recargar.
const INTERVALO_CAJA = 10000;

// Cuántos turnos muestra el historial (el backend permite hasta 100).
// 30 turnos alcanzan para ver un mes con un turno por día.
const CANTIDAD_HISTORIAL = 30;

// Largo mínimo del motivo de reapertura (igual que el backend)
const LARGO_MIN_MOTIVO = 5;

// Elementos de la página
const mensaje = document.getElementById('mensaje');
const vistaCerrada = document.getElementById('vista-cerrada');
const vistaAbierta = document.getElementById('vista-abierta');

// Caja cerrada
const formAbrir = document.getElementById('form-abrir');
const inputSaldoInicial = document.getElementById('input-saldo-inicial');
const sugerenciaSaldo = document.getElementById('sugerencia-saldo');
const errorAbrir = document.getElementById('error-abrir');
const btnAbrir = document.getElementById('btn-abrir');
const ultimoCierre = document.getElementById('ultimo-cierre');
const ultimoCierreInfo = document.getElementById('ultimo-cierre-info');
const ultimoCierreDatos = document.getElementById('ultimo-cierre-datos');
const btnReabrir = document.getElementById('btn-reabrir');

// Caja abierta
const turnoInfo = document.getElementById('turno-info');
const resEfectivo = document.getElementById('res-efectivo');
const resEfectivoDetalle = document.getElementById('res-efectivo-detalle');
const resTransferencias = document.getElementById('res-transferencias');
const resSaldo = document.getElementById('res-saldo');
const resCobros = document.getElementById('res-cobros');
const resSinCargo = document.getElementById('res-sin-cargo');
const btnMovimiento = document.getElementById('btn-movimiento');
const btnCerrarCaja = document.getElementById('btn-cerrar-caja');
const sinMovimientos = document.getElementById('sin-movimientos');
const tablaMovimientos = document.getElementById('tabla-movimientos');

// Historial de turnos
const btnHistorial = document.getElementById('btn-historial');
const mensajeHistorial = document.getElementById('mensaje-historial');
const historialContenedor = document.getElementById('historial-contenedor');
const tablaHistorial = document.getElementById('tabla-historial');

// Panel de movimiento manual
const panelMovimiento = document.getElementById('panel-movimiento');
const formMovimiento = document.getElementById('form-movimiento');
const movCodigo = document.getElementById('mov-codigo');
const movTipo = document.getElementById('mov-tipo');
const movForma = document.getElementById('mov-forma');
const movCampoMedio = document.getElementById('mov-campo-medio');
const movMedio = document.getElementById('mov-medio');
const movImporte = document.getElementById('mov-importe');
const movConcepto = document.getElementById('mov-concepto');
const movTipoComprobante = document.getElementById('mov-tipo-comprobante');
const movNroComprobante = document.getElementById('mov-nro-comprobante');
const movDniCuit = document.getElementById('mov-dni-cuit');
const movProveedor = document.getElementById('mov-proveedor');
const movDetalle = document.getElementById('mov-detalle');
const errorMovimiento = document.getElementById('error-movimiento');
const btnGuardarMovimiento = document.getElementById('btn-guardar-movimiento');

// Panel de cierre
const panelCierre = document.getElementById('panel-cierre');
const formCierre = document.getElementById('form-cierre');
const cierreEsperado = document.getElementById('cierre-esperado');
const cierreTransferencias = document.getElementById('cierre-transferencias');
const inputContado = document.getElementById('input-contado');
const cierreDiferencia = document.getElementById('cierre-diferencia');
const obsObligatorias = document.getElementById('obs-obligatorias');
const inputObservaciones = document.getElementById('input-observaciones');
const errorCierre = document.getElementById('error-cierre');
const btnConfirmarCierre = document.getElementById('btn-confirmar-cierre');

// Panel de reapertura
const panelReapertura = document.getElementById('panel-reapertura');
const formReapertura = document.getElementById('form-reapertura');
const reaperturaInfo = document.getElementById('reapertura-info');
const inputMotivoReapertura = document.getElementById('input-motivo-reapertura');
const errorReapertura = document.getElementById('error-reapertura');
const btnConfirmarReapertura = document.getElementById('btn-confirmar-reapertura');

// Panel de detalle de un turno (historial)
const panelTurno = document.getElementById('panel-turno');
const tituloTurno = document.getElementById('titulo-turno');
const turnoDetalleInfo = document.getElementById('turno-detalle-info');
const errorTurno = document.getElementById('error-turno');
const turnoDetalleDatos = document.getElementById('turno-detalle-datos');
const turnoSinMovimientos = document.getElementById('turno-sin-movimientos');
const turnoDetalleMovimientos = document.getElementById('turno-detalle-movimientos');

// Estado de la pantalla
let turnoActual = null;        // el turno abierto (null si la caja está cerrada)
let ultimoTurnoCerrado = null; // el que se muestra en "Último cierre" (el que se puede reabrir)
let vistaActual = '';          // 'abierta' | 'cerrada': para saber si cambió
let ultimoDibujo = '';         // los datos de la última vez, como texto
let codigosCaja = [];          // códigos para movimientos manuales (se piden una vez)
let guardando = false;         // true mientras se manda algo (evita doble envío)
let confirmandoCierre = false; // true después del primer toque en "Cerrar caja"
let confirmandoReapertura = false; // true después del primer toque en "Reabrir turno"
let esperadoCierre = 0;        // efectivo esperado que se mostró en el panel de cierre
let avisoPendiente = '';       // "Caja abierta ✔", se muestra en la próxima carga

// Historial
let historialCargado = false;  // true después de la primera carga (para refrescarlo)
let cargandoHistorial = false; // evita pedirlo dos veces a la vez
let numeroDetalle = 0;         // para descartar respuestas viejas del panel de detalle

// Actualización automática
let temporizador = null;
let actualizando = false;

// 1) Control de rol: la caja es SOLO del encargado.
//    Al mozo o a cocina, exigirRol los manda a su pantalla.
const sesion = exigirRol(['encargado']);

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

  // Medios de transferencia: salen de api.js (a confirmar con la hostería)
  for (const medio of MEDIOS_TRANSFERENCIA) {
    const opcion = document.createElement('option');
    opcion.value = medio;
    opcion.textContent = medio;
    movMedio.append(opcion);
  }

  formAbrir.addEventListener('submit', abrirTurno);

  btnMovimiento.addEventListener('click', abrirPanelMovimiento);
  movCodigo.addEventListener('change', mostrarTipoCodigo);
  movForma.addEventListener('change', alCambiarFormaMovimiento);
  formMovimiento.addEventListener('submit', guardarMovimiento);

  btnCerrarCaja.addEventListener('click', abrirPanelCierre);
  inputContado.addEventListener('input', alCambiarContado);
  inputObservaciones.addEventListener('input', reiniciarBotonCierre);
  formCierre.addEventListener('submit', confirmarCierre);

  // Reapertura
  btnReabrir.addEventListener('click', abrirPanelReapertura);
  inputMotivoReapertura.addEventListener('input', reiniciarBotonReapertura);
  formReapertura.addEventListener('submit', confirmarReapertura);

  // Historial: un solo "escuchador" en la tabla para todos los
  // botones "Ver" (delegación de eventos). Así no hay que agregar
  // uno por fila cada vez que se redibuja.
  btnHistorial.addEventListener('click', cargarHistorial);
  tablaHistorial.addEventListener('click', (evento) => {
    const boton = evento.target.closest('[data-ver-turno]');
    if (boton) verTurno(Number(boton.dataset.verTurno));
  });

  // Cerrar los paneles: botones con data-cerrar o tocar el fondo oscuro
  for (const panel of [panelMovimiento, panelCierre, panelReapertura, panelTurno]) {
    panel.addEventListener('click', (evento) => {
      if (evento.target === panel || evento.target.closest('[data-cerrar]')) {
        cerrarPaneles();
      }
    });
  }
  // ...o la tecla Escape
  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape') cerrarPaneles();
  });

  // Si cambia de pestaña, dejamos de pedir datos; al volver, actualizamos
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
   Actualización automática: setTimeout encadenado (como en
   mesas.js), así las peticiones no se amontonan si el wifi
   anda lento.
   --------------------------------------------------------- */
async function actualizar() {
  if (actualizando) return;
  actualizando = true;
  clearTimeout(temporizador);

  await cargarCaja();

  actualizando = false;
  if (!document.hidden) {
    temporizador = setTimeout(actualizar, INTERVALO_CAJA);
  }
}

/* Pide el estado de la caja y muestra la vista que corresponde:
   - abierta → resumen + movimientos del turno
   - cerrada → formulario para abrir + arqueo del último cierre */
async function cargarCaja() {
  try {
    const caja = await obtenerTurnoActual();
    let datos;

    if (caja.abierto) {
      const movimientos = await obtenerMovimientos(caja.turno.id);
      datos = { vista: 'abierta', turno: caja.turno, movimientos };
    } else {
      const turnos = await obtenerTurnos(1); // el último turno (cerrado)
      datos = { vista: 'cerrada', ultimo: turnos[0] || null };
    }

    // Solo redibujamos si algo cambió (que no "parpadee" cada 10 s)
    const texto = JSON.stringify(datos);
    if (texto !== ultimoDibujo) {
      if (datos.vista === 'abierta') {
        mostrarAbierta(datos.turno, datos.movimientos);
      } else {
        mostrarCerrada(datos.ultimo);
      }
      ultimoDibujo = texto;
    }

    if (avisoPendiente) {
      mostrarAviso(avisoPendiente);
      avisoPendiente = '';
    } else {
      ocultarMensaje();
    }
  } catch (error) {
    // Sin wifi: queda en pantalla lo último que se vio, con el aviso arriba
    manejarError(error, mostrarError);
  }
}

/* =========================================================
   CAJA CERRADA
   ========================================================= */
function mostrarCerrada(ultimo) {
  turnoActual = null;
  vistaAbierta.hidden = true;
  vistaCerrada.hidden = false;

  // Ayuda para el saldo inicial: lo que se contó en el último cierre.
  // NO lo cargamos solo en el campo: el encargado tiene que contar
  // el cajón de verdad (si lo pusiéramos, se aceptaría sin mirar).
  if (ultimo && ultimo.efectivo_contado !== null) {
    sugerenciaSaldo.textContent = 'En el último cierre se contaron ' +
      formatoPesos(ultimo.efectivo_contado) + ' en el cajón.';
    sugerenciaSaldo.hidden = false;
  } else {
    sugerenciaSaldo.hidden = true;
  }

  dibujarUltimoCierre(ultimo);

  // El foco va al campo solo al ENTRAR a esta vista, no en cada
  // actualización (si no, le saltaría el cursor mientras escribe)
  if (vistaActual !== 'cerrada') {
    vistaActual = 'cerrada';
    inputSaldoInicial.focus();
  }
}

// Arqueo del último cierre: lo que esperaba la base, lo que se
// contó y la diferencia, como el cierre del turno noche en el Excel.
// Es también el ÚNICO turno que se puede reabrir (regla del backend).
function dibujarUltimoCierre(turno) {
  if (!turno || turno.estado !== 'cerrado') {
    ultimoTurnoCerrado = null;
    ultimoCierre.hidden = true;
    return;
  }

  ultimoTurnoCerrado = turno;
  ultimoCierreInfo.textContent = textoCierre(turno);
  llenarArqueo(ultimoCierreDatos, turno);
  ultimoCierre.hidden = false;
}

// "Turno N° 3 · cerrado el 26/11 20:00 por Encargado"
function textoCierre(turno) {
  return 'Turno N° ' + turno.id + ' · cerrado el ' + fechaHora(turno.cierre) +
    (turno.usuario_cierre ? ' por ' + turno.usuario_cierre : '');
}

/* Llena una lista <dl> con el arqueo de un turno.
   La usan "Último cierre" y el detalle del historial: así los
   dos muestran lo mismo y, si hay que cambiar algo, se cambia
   en un solo lugar.
   - Turno cerrado → esperado, contado y diferencia (los guardó la base al cerrar)
   - Turno abierto → el efectivo que hay ahora (todavía no hay arqueo) */
function llenarArqueo(lista, turno) {
  lista.textContent = '';
  agregarDato(lista, 'Saldo inicial', formatoPesos(turno.saldo_inicial));

  if (turno.estado === 'cerrado') {
    agregarDato(lista, 'Efectivo esperado', formatoPesos(turno.efectivo_esperado));
    agregarDato(lista, 'Efectivo contado', formatoPesos(turno.efectivo_contado));
    const dif = textoDiferencia(turno.diferencia);
    agregarDato(lista, 'Diferencia', dif.texto, dif.clase);
  } else {
    agregarDato(lista, 'Efectivo en caja (ahora)', formatoPesos(turno.efectivo_en_caja));
  }

  // Al cerrar, la base guarda el total de transferencias; si el
  // turno sigue abierto, lo calculamos con lo que entró y salió.
  const transferencias = turno.estado === 'cerrado' && turno.total_transferencias !== null
    ? turno.total_transferencias
    : transferenciasNetas(turno);
  agregarDato(lista, 'Transferencias', formatoPesos(transferencias));
  agregarDato(lista, 'Saldo total', formatoPesos(turno.saldo_total));
  agregarDato(lista, 'Mesas cobradas', String(turno.cantidad_cobros) +
    (turno.cantidad_sin_cargo > 0 ? ' (' + turno.cantidad_sin_cargo + ' sin cargo)' : ''));
  if (turno.observaciones) {
    agregarDato(lista, 'Observaciones', turno.observaciones);
  }
}

// Agrega un par <dt>nombre</dt><dd>valor</dd> a una lista <dl>
function agregarDato(lista, nombre, valor, clase) {
  const dt = document.createElement('dt');
  dt.textContent = nombre;
  const dd = document.createElement('dd');
  dd.textContent = valor;
  if (clase) dd.className = clase;
  lista.append(dt, dd);
}

/* diferencia = contado − esperado (así la calcula la base)
   - negativa → falta plata en el cajón
   - positiva → sobra plata
   Texto Y color: el color solo no alcanza. */
function textoDiferencia(diferencia) {
  const centavos = aCentavos(diferencia || 0);
  if (centavos < 0) {
    return { texto: 'Falta ' + formatoPesos(-centavos / 100), clase: 'caja-dif--falta' };
  }
  if (centavos > 0) {
    return { texto: 'Sobra ' + formatoPesos(centavos / 100), clase: 'caja-dif--sobra' };
  }
  return { texto: '✔ Coincide', clase: 'caja-dif--ok' };
}

// "Abrir caja"
async function abrirTurno(evento) {
  evento.preventDefault();
  if (guardando) return;

  errorAbrir.hidden = true;
  guardando = true;
  btnAbrir.disabled = true;
  btnAbrir.textContent = 'Abriendo…';

  try {
    // abrirCaja valida el importe (api.js) y la base controla
    // que no haya otro turno abierto
    await abrirCaja(inputSaldoInicial.value);
    inputSaldoInicial.value = '';
    avisoPendiente = 'Caja abierta ✔';
    ultimoDibujo = ''; // que se redibuje sí o sí
    await actualizar();
    refrescarHistorial();
  } catch (error) {
    manejarError(error, (texto) => {
      errorAbrir.textContent = texto;
      errorAbrir.hidden = false;
      inputSaldoInicial.focus();
    });
  } finally {
    guardando = false;
    btnAbrir.disabled = false;
    btnAbrir.textContent = 'Abrir caja';
  }
}

/* =========================================================
   REAPERTURA DEL ÚLTIMO TURNO (RF-CAJ-11)
   Solo el último turno cerrado y con la caja cerrada (lo
   controla la base). Motivo obligatorio, queda auditado.
   Confirmación en dos toques: cambia un cierre ya hecho.
   ========================================================= */
function abrirPanelReapertura() {
  if (!ultimoTurnoCerrado) return;

  reaperturaInfo.textContent = textoCierre(ultimoTurnoCerrado);
  inputMotivoReapertura.value = '';
  errorReapertura.hidden = true;
  reiniciarBotonReapertura();
  panelReapertura.hidden = false;
  inputMotivoReapertura.focus();
}

async function confirmarReapertura(evento) {
  evento.preventDefault();
  if (guardando || !ultimoTurnoCerrado) return;

  const turno = ultimoTurnoCerrado;
  const motivo = inputMotivoReapertura.value.trim();

  if (!confirmandoReapertura) {
    // Validamos antes de pedir confirmación (la base vuelve a controlar)
    if (motivo.length < LARGO_MIN_MOTIVO) {
      mostrarErrorReapertura('Escribí el motivo de la reapertura (' +
        LARGO_MIN_MOTIVO + ' letras o más).');
      inputMotivoReapertura.focus();
      return;
    }
    errorReapertura.hidden = true;
    confirmandoReapertura = true;
    btnConfirmarReapertura.textContent = '¿Reabrir el turno N° ' + turno.id + '? Tocá de nuevo';
    return;
  }

  guardando = true;
  btnConfirmarReapertura.disabled = true;
  btnConfirmarReapertura.textContent = 'Reabriendo…';

  try {
    await reabrirCaja(turno.id, motivo);
    guardando = false;
    cerrarPaneles();
    avisoPendiente = 'Turno N° ' + turno.id +
      ' reabierto ✔ Cuando termines, cerralo de nuevo con el arqueo.';
    ultimoDibujo = ''; // que se redibuje sí o sí (pasa a "caja abierta")
    await actualizar();
    refrescarHistorial();
  } catch (error) {
    // Por ejemplo: otra recepcionista abrió un turno nuevo mientras
    // tanto. La base lo rechaza y mostramos su mensaje.
    guardando = false;
    reiniciarBotonReapertura();
    manejarError(error, mostrarErrorReapertura);
  }
}

function reiniciarBotonReapertura() {
  confirmandoReapertura = false;
  if (guardando) return;
  btnConfirmarReapertura.disabled = false;
  btnConfirmarReapertura.textContent = 'Reabrir turno';
}

/* =========================================================
   CAJA ABIERTA
   ========================================================= */
function mostrarAbierta(turno, movimientos) {
  turnoActual = turno;
  ultimoTurnoCerrado = null; // con la caja abierta no se reabre nada
  vistaCerrada.hidden = true;
  vistaAbierta.hidden = false;
  vistaActual = 'abierta';

  turnoInfo.textContent = 'Turno N° ' + turno.id + ' · abierto el ' +
    fechaHora(turno.apertura) + ' por ' + turno.usuario_apertura;

  // Efectivo: lo único que se cuenta al cerrar
  resEfectivo.textContent = formatoPesos(turno.efectivo_en_caja);
  resEfectivoDetalle.textContent = 'Inicial ' + formatoPesos(turno.saldo_inicial) +
    ' + ingresos ' + formatoPesos(turno.ingresos_efectivo) +
    ' − egresos ' + formatoPesos(turno.egresos_efectivo);

  resTransferencias.textContent = formatoPesos(transferenciasNetas(turno));
  resSaldo.textContent = formatoPesos(turno.saldo_total);
  resCobros.textContent = String(turno.cantidad_cobros);
  resSinCargo.textContent = turno.cantidad_sin_cargo > 0
    ? 'Sin cargo: ' + turno.cantidad_sin_cargo
    : 'Ninguna sin cargo';

  dibujarMovimientos(movimientos, tablaMovimientos, sinMovimientos);
}

// Transferencias que entraron menos las que salieron (pago a proveedor)
function transferenciasNetas(turno) {
  return (aCentavos(turno.ingresos_transferencia) - aCentavos(turno.egresos_transferencia)) / 100;
}

/* Tabla de movimientos. Recibe DÓNDE dibujar (cuerpo de la tabla y
   aviso de "no hay movimientos"): la usan el turno abierto y el
   detalle del historial.
   createElement + textContent (no innerHTML): el concepto o el
   proveedor los escribe una persona, y así nunca se interpretan
   como HTML (XSS). */
function dibujarMovimientos(movimientos, cuerpoTabla, avisoVacio) {
  cuerpoTabla.textContent = '';
  avisoVacio.hidden = movimientos.length > 0;

  for (const m of movimientos) {
    const fila = document.createElement('tr');

    agregarCelda(fila, formatearHora(m.fecha));
    agregarCelda(fila, m.codigo);

    // Concepto + debajo, en chico, los datos del comprobante
    const concepto = agregarCelda(fila, m.concepto, 'caja-concepto');
    const extras = [
      [m.tipo_comprobante, m.nro_comprobante].filter(Boolean).join(' '),
      m.huesped_proveedor,
      m.dni_cuit ? 'DNI/CUIT ' + m.dni_cuit : ''
    ].filter(Boolean);
    if (extras.length > 0) {
      const extra = document.createElement('span');
      extra.className = 'caja-extra';
      extra.textContent = extras.join(' · ');
      concepto.append(extra);
    }

    agregarCelda(fila, m.forma === 'transferencia'
      ? 'Transferencia' + (m.medio ? ' (' + m.medio + ')' : '')
      : 'Efectivo');
    agregarCelda(fila, m.ingreso > 0 ? formatoPesos(m.ingreso) : '', 'caja-num');
    agregarCelda(fila, m.egreso > 0 ? formatoPesos(m.egreso) : '', 'caja-num caja-egreso');
    agregarCelda(fila, formatoPesos(m.saldo), 'caja-num');
    agregarCelda(fila, m.usuario);

    cuerpoTabla.append(fila);
  }
}

function agregarCelda(fila, texto, clase) {
  const td = document.createElement('td');
  td.textContent = texto;
  if (clase) td.className = clase;
  fila.append(td);
  return td;
}

/* =========================================================
   HISTORIAL DE TURNOS (RF-CAJ-11)
   Se carga con el botón, no cada 10 s: es una consulta de vez
   en cuando. Después de abrir, cerrar o reabrir la caja se
   refresca solo (si ya estaba a la vista), para que no quede
   mostrando datos viejos.
   ========================================================= */
async function cargarHistorial() {
  if (cargandoHistorial) return;
  cargandoHistorial = true;
  btnHistorial.disabled = true;
  btnHistorial.textContent = 'Cargando…';
  if (!historialCargado) {
    mostrarMensajeHistorial('Cargando historial…', false);
  }

  try {
    const turnos = await obtenerTurnos(CANTIDAD_HISTORIAL);
    dibujarHistorial(turnos);
    historialCargado = true;
  } catch (error) {
    manejarError(error, (texto) => mostrarMensajeHistorial(texto, true));
  } finally {
    cargandoHistorial = false;
    btnHistorial.disabled = false;
    btnHistorial.textContent = historialCargado ? 'Actualizar historial' : 'Ver historial';
  }
}

// Si el historial ya está a la vista, lo volvemos a pedir
function refrescarHistorial() {
  if (historialCargado) cargarHistorial();
}

/* Una fila por turno, del más nuevo al más viejo (así lo manda
   el backend). Las columnas del arqueo quedan con "—" mientras
   el turno sigue abierto: todavía no se contó el cajón. */
function dibujarHistorial(turnos) {
  tablaHistorial.textContent = '';

  if (turnos.length === 0) {
    historialContenedor.hidden = true;
    mostrarMensajeHistorial('Todavía no hay turnos de caja.', false);
    return;
  }

  for (const t of turnos) {
    const cerrado = t.estado === 'cerrado';
    const fila = document.createElement('tr');

    agregarCelda(fila, 'N° ' + t.id);
    agregarCelda(fila, fechaHora(t.apertura));
    agregarCelda(fila, cerrado ? fechaHora(t.cierre) : '—');
    agregarCelda(fila, formatoPesos(t.saldo_inicial), 'caja-num');
    agregarCelda(fila, cerrado ? formatoPesos(t.efectivo_esperado) : '—', 'caja-num');
    agregarCelda(fila, cerrado ? formatoPesos(t.efectivo_contado) : '—', 'caja-num');

    if (cerrado) {
      const dif = textoDiferencia(t.diferencia);
      agregarCelda(fila, dif.texto, dif.clase);
      agregarCelda(fila, 'Cerrado');
    } else {
      agregarCelda(fila, '—');
      agregarCelda(fila, 'Abierto', 'caja-estado--abierto');
    }

    // Botón "Ver": el número del turno va en data-ver-turno.
    // aria-label para que el lector de pantalla diga cuál turno es.
    const celdaBoton = document.createElement('td');
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'boton boton--secundario';
    boton.textContent = 'Ver';
    boton.dataset.verTurno = t.id;
    boton.setAttribute('aria-label', 'Ver turno N° ' + t.id);
    celdaBoton.append(boton);
    fila.append(celdaBoton);

    tablaHistorial.append(fila);
  }

  mensajeHistorial.hidden = true;
  historialContenedor.hidden = false;
}

/* Detalle de un turno (solo lectura): arqueo + movimientos.
   Pedimos las dos cosas A LA VEZ (Promise.all): tarda la mitad
   que pedir una y después la otra. */
async function verTurno(idTurno) {
  // Si el usuario toca "Ver" en otro turno antes de que llegue la
  // respuesta, la vieja se descarta (si no, podría mostrar el arqueo
  // de un turno con los movimientos de otro)
  numeroDetalle++;
  const esteDetalle = numeroDetalle;

  tituloTurno.textContent = 'Turno N° ' + idTurno;
  turnoDetalleInfo.textContent = 'Cargando…';
  turnoDetalleDatos.textContent = '';
  turnoDetalleMovimientos.textContent = '';
  turnoSinMovimientos.hidden = true;
  errorTurno.hidden = true;
  panelTurno.hidden = false;
  panelTurno.querySelector('[data-cerrar]').focus();

  try {
    const [turno, movimientos] = await Promise.all([
      obtenerTurno(idTurno),
      obtenerMovimientos(idTurno)
    ]);
    if (esteDetalle !== numeroDetalle) return; // llegó tarde: se descarta

    turnoDetalleInfo.textContent = 'Abierto el ' + fechaHora(turno.apertura) +
      (turno.usuario_apertura ? ' por ' + turno.usuario_apertura : '') +
      (turno.estado === 'cerrado'
        ? ' · cerrado el ' + fechaHora(turno.cierre) +
          (turno.usuario_cierre ? ' por ' + turno.usuario_cierre : '')
        : ' · todavía abierto');
    llenarArqueo(turnoDetalleDatos, turno);
    dibujarMovimientos(movimientos, turnoDetalleMovimientos, turnoSinMovimientos);
  } catch (error) {
    if (esteDetalle !== numeroDetalle) return;
    turnoDetalleInfo.textContent = '';
    manejarError(error, (texto) => {
      errorTurno.textContent = texto;
      errorTurno.hidden = false;
    });
  }
}

/* =========================================================
   MOVIMIENTO MANUAL (RF-CAJ-07)
   ========================================================= */
async function abrirPanelMovimiento() {
  if (!turnoActual) return;

  // Formulario limpio
  movForma.value = 'efectivo';
  movMedio.value = '';
  movCampoMedio.hidden = true;
  for (const campo of [movImporte, movConcepto, movTipoComprobante,
                       movNroComprobante, movDniCuit, movProveedor, movDetalle]) {
    campo.value = '';
  }
  errorMovimiento.hidden = true;
  panelMovimiento.hidden = false;

  // Los códigos casi no cambian: los pedimos la primera vez
  if (codigosCaja.length === 0) {
    btnGuardarMovimiento.disabled = true;
    try {
      codigosCaja = await obtenerCodigosCaja();
      llenarCodigos();
    } catch (error) {
      manejarError(error, mostrarErrorMovimiento);
      return;
    } finally {
      btnGuardarMovimiento.disabled = false;
    }
  }

  // Por defecto el primer EGRESO (lo más común: un gasto)
  const primerEgreso = codigosCaja.find(c => c.tipo === 'egreso');
  if (primerEgreso) movCodigo.value = primerEgreso.codigo;
  mostrarTipoCodigo();
  movImporte.focus();
}

// "GASTO – Gastos varios (resta)"
function llenarCodigos() {
  movCodigo.textContent = '';
  for (const c of codigosCaja) {
    const opcion = document.createElement('option');
    opcion.value = c.codigo;
    opcion.textContent = c.codigo + ' – ' + c.concepto +
      (c.tipo === 'egreso' ? ' (resta)' : ' (suma)');
    movCodigo.append(opcion);
  }
}

// Aclara si el código elegido suma o resta. Lo decide la base
// según el tipo del código: el usuario no puede cambiarlo.
function mostrarTipoCodigo() {
  const codigo = codigosCaja.find(c => c.codigo === movCodigo.value);
  if (!codigo) {
    movTipo.textContent = '';
    return;
  }
  movTipo.textContent = (codigo.tipo === 'egreso'
    ? 'Este código RESTA de la caja.'
    : 'Este código SUMA a la caja.') +
    ' Si no escribís un concepto, se usa "' + codigo.concepto + '".';
}

function alCambiarFormaMovimiento() {
  movCampoMedio.hidden = movForma.value !== 'transferencia';
  if (movCampoMedio.hidden) movMedio.value = '';
}

async function guardarMovimiento(evento) {
  evento.preventDefault();
  if (guardando) return;

  errorMovimiento.hidden = true;
  guardando = true;
  btnGuardarMovimiento.disabled = true;
  btnGuardarMovimiento.textContent = 'Guardando…';

  try {
    // registrarMovimiento valida (api.js) y la base vuelve a controlar
    // (por ejemplo, que no se saque más efectivo del que hay)
    await registrarMovimiento({
      codigo: movCodigo.value,
      forma: movForma.value,
      medio: movMedio.value,
      importe: movImporte.value,
      concepto: movConcepto.value,
      tipo_comprobante: movTipoComprobante.value,
      nro_comprobante: movNroComprobante.value,
      dni_cuit: movDniCuit.value,
      huesped_proveedor: movProveedor.value,
      detalle: movDetalle.value
    });
    guardando = false;
    cerrarPaneles();
    avisoPendiente = 'Movimiento registrado ✔';
    actualizar();
  } catch (error) {
    guardando = false;
    manejarError(error, mostrarErrorMovimiento);
  } finally {
    btnGuardarMovimiento.disabled = false;
    btnGuardarMovimiento.textContent = 'Guardar';
  }
}

/* =========================================================
   CIERRE CON ARQUEO (RF-CAJ-09)
   El encargado cuenta el EFECTIVO del cajón. La base calcula
   lo esperado y la diferencia, y guarda todo en el turno.
   ========================================================= */
async function abrirPanelCierre() {
  if (!turnoActual) return;

  inputContado.value = '';
  inputObservaciones.value = '';
  cierreDiferencia.textContent = '';
  obsObligatorias.textContent = '(opcional)';
  errorCierre.hidden = true;
  reiniciarBotonCierre();
  btnConfirmarCierre.disabled = true; // hasta tener el turno actualizado
  panelCierre.hidden = false;

  try {
    // Pedimos el turno de nuevo: pudo haber un cobro hace segundos
    const turno = await obtenerTurno(turnoActual.id);
    esperadoCierre = turno.efectivo_en_caja;
    cierreEsperado.textContent = formatoPesos(esperadoCierre);
    cierreTransferencias.textContent = formatoPesos(transferenciasNetas(turno));
    btnConfirmarCierre.disabled = false;
    inputContado.focus();
  } catch (error) {
    manejarError(error, mostrarErrorCierre);
  }
}

// Mientras escribe lo contado, mostramos la diferencia
function alCambiarContado() {
  reiniciarBotonCierre();
  const valor = inputContado.value;
  if (valor === '' || !Number.isFinite(Number(valor))) {
    cierreDiferencia.textContent = '';
    obsObligatorias.textContent = '(opcional)';
    return;
  }

  const diferencia = (aCentavos(valor) - aCentavos(esperadoCierre)) / 100;
  const dif = textoDiferencia(diferencia);
  cierreDiferencia.textContent = diferencia === 0 ? dif.texto : 'Diferencia: ' + dif.texto.toLowerCase();
  cierreDiferencia.className = 'cobro-resto ' +
    (diferencia === 0 ? 'cobro-resto--ok' : 'cobro-resto--falta');

  // (propuesta) Con diferencia, hay que explicar el motivo.
  // La base controla lo mismo: esto es para avisar antes.
  obsObligatorias.textContent = diferencia === 0 ? '(opcional)' : '(obligatorias: hay diferencia)';
}

/* "Cerrar caja" con confirmación en dos toques: después de
   cerrar ya no se puede cobrar hasta abrir otro turno. */
async function confirmarCierre(evento) {
  evento.preventDefault();
  if (guardando || !turnoActual) return;

  const contado = inputContado.value;
  const observaciones = inputObservaciones.value.trim();

  if (!confirmandoCierre) {
    // Validamos antes de pedir confirmación
    let importe;
    try {
      importe = validarImporte(contado, 'Efectivo contado', false);
    } catch (error) {
      mostrarErrorCierre(error.message);
      inputContado.focus();
      return;
    }
    if (aCentavos(importe) !== aCentavos(esperadoCierre) && !observaciones) {
      mostrarErrorCierre('Hay diferencia entre lo contado y lo esperado: escribí el motivo en observaciones.');
      inputObservaciones.focus();
      return;
    }
    errorCierre.hidden = true;
    confirmandoCierre = true;
    btnConfirmarCierre.textContent = '¿Cerrar la caja? Tocá de nuevo';
    return;
  }

  guardando = true;
  btnConfirmarCierre.disabled = true;
  btnConfirmarCierre.textContent = 'Cerrando…';

  try {
    await cerrarCaja(turnoActual.id, contado, observaciones);
    guardando = false;
    cerrarPaneles();
    avisoPendiente = 'Caja cerrada ✔ Revisá el arqueo abajo.';
    ultimoDibujo = '';
    await actualizar();
    refrescarHistorial();
  } catch (error) {
    guardando = false;
    reiniciarBotonCierre();
    manejarError(error, mostrarErrorCierre);
  }
}

function reiniciarBotonCierre() {
  confirmandoCierre = false;
  if (guardando) return;
  btnConfirmarCierre.disabled = false;
  btnConfirmarCierre.textContent = 'Cerrar caja';
}

/* ---------- Paneles ---------- */
function cerrarPaneles() {
  // Mientras se guarda algo no se cierra: así siempre se ve cómo terminó
  if (guardando) return;
  panelMovimiento.hidden = true;
  panelCierre.hidden = true;
  panelReapertura.hidden = true;
  panelTurno.hidden = true;
  numeroDetalle++; // si el detalle estaba cargando, su respuesta se descarta
  reiniciarBotonCierre();
  reiniciarBotonReapertura();
}

/* ---------- Utilidades ---------- */

// "2026-11-26T17:00:40.000Z" → "26/11 14:00" (hora local, 24 h).
// La base manda las fechas en UTC: toLocaleString las pasa a la
// hora de la compu. NO cortamos el texto (daría la hora UTC).
function fechaHora(fechaIso) {
  if (!fechaIso) return '';
  const fecha = new Date(fechaIso);
  if (isNaN(fecha)) return '';
  return fecha.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
}

// 401 = sesión vencida → al login. Otro error → se muestra.
function manejarError(error, mostrar) {
  if (error.estado === 401) {
    cerrarSesion();
    location.href = '../index.html';
    return;
  }
  mostrar(error.message);
}

/* ---------- Mensajes al usuario ---------- */
function mostrarError(texto) {
  mensaje.textContent = texto;
  mensaje.className = 'mensaje mensaje--error';
  mensaje.hidden = false;
}

function mostrarAviso(texto) {
  mensaje.textContent = texto;
  mensaje.className = 'mensaje';
  mensaje.hidden = false;
}

function ocultarMensaje() {
  mensaje.hidden = true;
}

function mostrarErrorMovimiento(texto) {
  errorMovimiento.textContent = texto;
  errorMovimiento.hidden = false;
}

function mostrarErrorCierre(texto) {
  errorCierre.textContent = texto;
  errorCierre.hidden = false;
}

function mostrarErrorReapertura(texto) {
  errorReapertura.textContent = texto;
  errorReapertura.hidden = false;
}

// Mensaje del historial (aviso normal o error en rojo)
function mostrarMensajeHistorial(texto, esError) {
  mensajeHistorial.textContent = texto;
  mensajeHistorial.className = esError ? 'mensaje mensaje--error' : 'mensaje';
  mensajeHistorial.hidden = false;
}