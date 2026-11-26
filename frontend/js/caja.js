/* =========================================================
   caja.js — Pantalla de caja (RF-CAJ) — Incremento 3
   ---------------------------------------------------------
   Solo el ENCARGADO (en la hostería, las recepcionistas
   entran con ese rol).
   - Caja cerrada → abrir un turno con el efectivo del cajón
                    y ver el arqueo del último cierre.
   - Caja abierta → resumen del turno (efectivo, transferencias,
                    saldo total, mesas cobradas), movimientos,
                    movimiento manual (gastos) y cierre con arqueo.
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

// Estado de la pantalla
let turnoActual = null;       // el turno abierto (null si la caja está cerrada)
let vistaActual = '';         // 'abierta' | 'cerrada': para saber si cambió
let ultimoDibujo = '';        // los datos de la última vez, como texto
let codigosCaja = [];         // códigos para movimientos manuales (se piden una vez)
let guardando = false;        // true mientras se manda algo (evita doble envío)
let confirmandoCierre = false; // true después del primer toque en "Cerrar caja"
let esperadoCierre = 0;       // efectivo esperado que se mostró en el panel de cierre
let avisoPendiente = '';      // "Caja abierta ✔", se muestra en la próxima carga

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

  // Cerrar los paneles: botones con data-cerrar o tocar el fondo oscuro
  for (const panel of [panelMovimiento, panelCierre]) {
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
// contó y la diferencia, como el cierre del turno noche en el Excel
function dibujarUltimoCierre(turno) {
  if (!turno || turno.estado !== 'cerrado') {
    ultimoCierre.hidden = true;
    return;
  }

  ultimoCierreInfo.textContent = 'Turno N° ' + turno.id + ' · cerrado el ' +
    fechaHora(turno.cierre) + (turno.usuario_cierre ? ' por ' + turno.usuario_cierre : '');

  ultimoCierreDatos.textContent = '';
  agregarDato(ultimoCierreDatos, 'Saldo inicial', formatoPesos(turno.saldo_inicial));
  agregarDato(ultimoCierreDatos, 'Efectivo esperado', formatoPesos(turno.efectivo_esperado));
  agregarDato(ultimoCierreDatos, 'Efectivo contado', formatoPesos(turno.efectivo_contado));
  const dif = textoDiferencia(turno.diferencia);
  agregarDato(ultimoCierreDatos, 'Diferencia', dif.texto, dif.clase);
  agregarDato(ultimoCierreDatos, 'Transferencias', formatoPesos(turno.total_transferencias));
  agregarDato(ultimoCierreDatos, 'Saldo total', formatoPesos(turno.saldo_total));
  agregarDato(ultimoCierreDatos, 'Mesas cobradas', String(turno.cantidad_cobros) +
    (turno.cantidad_sin_cargo > 0 ? ' (' + turno.cantidad_sin_cargo + ' sin cargo)' : ''));
  if (turno.observaciones) {
    agregarDato(ultimoCierreDatos, 'Observaciones', turno.observaciones);
  }
  ultimoCierre.hidden = false;
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
   CAJA ABIERTA
   ========================================================= */
function mostrarAbierta(turno, movimientos) {
  turnoActual = turno;
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

  dibujarMovimientos(movimientos);
}

// Transferencias que entraron menos las que salieron (pago a proveedor)
function transferenciasNetas(turno) {
  return (aCentavos(turno.ingresos_transferencia) - aCentavos(turno.egresos_transferencia)) / 100;
}

/* Tabla de movimientos. createElement + textContent (no innerHTML):
   el concepto o el proveedor los escribe una persona, y así nunca
   se interpretan como HTML (XSS). */
function dibujarMovimientos(movimientos) {
  tablaMovimientos.textContent = '';
  sinMovimientos.hidden = movimientos.length > 0;

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

    tablaMovimientos.append(fila);
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
    actualizar();
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
  reiniciarBotonCierre();
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