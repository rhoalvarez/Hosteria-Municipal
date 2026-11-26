/* =========================================================
   estadisticas.js — Pantalla de estadísticas (RF-EST) — Inc. 3
   ---------------------------------------------------------
   Solo el ENCARGADO (en la hostería, las recepcionistas
   entran con ese rol).
   - Ingresos por semana o por mes, por forma de pago (RF-EST-02)
   - Ranking de platos más vendidos, con filtro por categoría (RF-EST-01)
   - Gráficos de barras propios, sin librerías (RF-EST-03)
   - Exportar a CSV para abrir con Excel (RF-EST-04)

   Qué cuenta (lo decide la BASE, 95_estadisticas.sql):
   solo las mesas COBRADAS, por la fecha del cobro. Los ítems
   anulados no cuentan. El "sin cargo" no suma a los ingresos.

   No se actualiza sola cada pocos segundos (como Mesas o Caja):
   las estadísticas se miran de vez en cuando y son consultas más
   pesadas. Se piden cuando el encargado elige un filtro.

   Los datos SIEMPRE se piden a api.js, nunca con fetch directo.
   ========================================================= */

// Nombres para mostrar fechas (getDay: domingo = 0)
const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const NOMBRES_MES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
                     'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// Elementos de la página
const mensaje = document.getElementById('mensaje');
const periodoInfo = document.getElementById('periodo-info');

// Filtros
const formFiltros = document.getElementById('form-filtros');
const filtroPeriodo = document.getElementById('filtro-periodo');
const camposFechas = document.getElementById('campos-fechas');
const filtroDesde = document.getElementById('filtro-desde');
const filtroHasta = document.getElementById('filtro-hasta');
const errorFiltros = document.getElementById('error-filtros');
const btnVer = document.getElementById('btn-ver');

// Ingresos
const secIngresos = document.getElementById('sec-ingresos');
const filtroAgrupar = document.getElementById('filtro-agrupar');
const resTotal = document.getElementById('res-total');
const resCobros = document.getElementById('res-cobros');
const resEfectivo = document.getElementById('res-efectivo');
const resTransferencia = document.getElementById('res-transferencia');
const resSinCargo = document.getElementById('res-sin-cargo');
const resSinCargoDetalle = document.getElementById('res-sin-cargo-detalle');
const sinIngresos = document.getElementById('sin-ingresos');
const graficoIngresos = document.getElementById('grafico-ingresos');
const tablaIngresos = document.getElementById('tabla-ingresos');
const btnCsvIngresos = document.getElementById('btn-csv-ingresos');
const plantillaIngreso = document.getElementById('plantilla-barra-ingreso');

// Platos
const secPlatos = document.getElementById('sec-platos');
const filtroCategoria = document.getElementById('filtro-categoria');
const sinPlatos = document.getElementById('sin-platos');
const graficoPlatos = document.getElementById('grafico-platos');
const btnCsvPlatos = document.getElementById('btn-csv-platos');
const plantillaPlato = document.getElementById('plantilla-barra-plato');

// Estado de la pantalla
let rangoActual = null;      // { desde, hasta } que se está mostrando
let ultimosIngresos = [];    // lo último que se dibujó (para exportar)
let ultimosPlatos = [];
let agruparMostrado = 'semana';
let categoriaMostrada = '';

/* Número de consulta: si el encargado cambia el filtro rápido, puede
   llegar PRIMERO la respuesta nueva y DESPUÉS la vieja (el wifi no
   garantiza el orden). Cada consulta guarda su número y, al volver,
   si ya hay una más nueva, se descarta. Así nunca queda en pantalla
   un filtro con datos de otro. */
let consultaIngresos = 0;
let consultaPlatos = 0;

// 1) Control de rol: las estadísticas son SOLO del encargado.
//    Al mozo o a cocina, exigirRol los manda a su pantalla.
const sesion = exigirRol(['encargado']);

if (sesion) {
  iniciarPantalla();
}

async function iniciarPantalla() {
  document.getElementById('nombre-usuario').textContent =
    sesion.usuario.nombre + ' (' + sesion.usuario.rol + ')';

  document.getElementById('btn-salir').addEventListener('click', () => {
    cerrarSesion();
    location.href = '../index.html';
  });

  // No tiene sentido elegir días que todavía no pasaron
  const hoy = fechaATexto(new Date());
  filtroDesde.max = hoy;
  filtroHasta.max = hoy;

  filtroPeriodo.addEventListener('change', alCambiarPeriodo);
  formFiltros.addEventListener('submit', (evento) => {
    evento.preventDefault();
    verEstadisticas();
  });
  // Cambiar "Agrupar" o "Categoría" vuelve a pedir SOLO esa sección
  filtroAgrupar.addEventListener('change', () => {
    if (rangoActual) recargarIngresos();
  });
  filtroCategoria.addEventListener('change', () => {
    if (rangoActual) recargarPlatos();
  });
  btnCsvIngresos.addEventListener('click', exportarIngresos);
  btnCsvPlatos.addEventListener('click', exportarPlatos);

  await llenarCategorias();

  // Al entrar: esta semana
  alCambiarPeriodo();
}

// Combo de categorías: "A – Comidas", "B – Bebidas"...
// Si falla, igual se puede ver el ranking con "Todas".
async function llenarCategorias() {
  try {
    const categorias = await obtenerCategorias();
    for (const c of categorias) {
      const opcion = document.createElement('option');
      opcion.value = c.codigo; // la letra
      opcion.textContent = c.codigo + ' – ' + c.nombre;
      filtroCategoria.append(opcion);
    }
  } catch (error) {
    manejarError(error, mostrarError);
  }
}

/* =========================================================
   FILTRO DE PERÍODO
   ========================================================= */

// Al elegir una opción: "Elegir fechas" muestra los calendarios
// y espera al botón; las otras opciones buscan enseguida.
function alCambiarPeriodo() {
  errorFiltros.hidden = true;
  const opcion = filtroPeriodo.value;

  if (opcion === 'elegir') {
    // Arrancamos con el período que se estaba viendo
    if (rangoActual) {
      filtroDesde.value = rangoActual.desde;
      filtroHasta.value = rangoActual.hasta;
    }
    camposFechas.hidden = false;
    filtroDesde.focus();
    return;
  }

  camposFechas.hidden = true;
  verEstadisticas();
}

/* Desde y hasta según la opción elegida. Las funciones de fechas
   (rangoSemana, rangoMes) están en api.js y usan la fecha LOCAL. */
function calcularRango() {
  const hoy = new Date();
  switch (filtroPeriodo.value) {
    case 'semana':
      return rangoSemana(hoy);
    case 'semana_anterior':
      return rangoSemana(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 7));
    case 'mes':
      return rangoMes(hoy);
    case 'mes_anterior':
      // Día 1 del mes anterior (enero - 1 = diciembre del año anterior: Date lo resuelve)
      return rangoMes(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1));
    default:
      return { desde: filtroDesde.value, hasta: filtroHasta.value };
  }
}

// "Ver estadísticas": pide las dos secciones al mismo tiempo
async function verEstadisticas() {
  errorFiltros.hidden = true;
  const rango = calcularRango();

  // Las mismas validaciones que el backend (api.js), para avisar antes
  try {
    validarPeriodoEst(rango.desde, rango.hasta);
  } catch (error) {
    errorFiltros.textContent = error.message;
    errorFiltros.hidden = false;
    return;
  }

  rangoActual = rango;
  periodoInfo.textContent = 'Del ' + fechaLarga(rango.desde) + ' al ' + fechaLarga(rango.hasta) +
    '. Cuentan solo las mesas cobradas.';

  btnVer.disabled = true;
  mostrarAviso('Cargando estadísticas...');

  // Promise.all: las dos consultas viajan juntas (no una después de la otra)
  const [okIngresos, okPlatos] = await Promise.all([cargarIngresos(), cargarPlatos()]);

  btnVer.disabled = false;
  if (okIngresos && okPlatos) ocultarMensaje();
}

async function recargarIngresos() {
  mostrarAviso('Cargando ingresos...');
  if (await cargarIngresos()) ocultarMensaje();
}

async function recargarPlatos() {
  mostrarAviso('Cargando platos...');
  if (await cargarPlatos()) ocultarMensaje();
}

/* =========================================================
   INGRESOS (RF-EST-02)
   ========================================================= */

// Devuelve true si salió bien (o si la respuesta ya no hacía falta)
async function cargarIngresos() {
  const numero = ++consultaIngresos;
  const agrupar = filtroAgrupar.value;
  try {
    const filas = await obtenerIngresos(rangoActual.desde, rangoActual.hasta, agrupar);
    if (numero !== consultaIngresos) return true; // llegó tarde: hay una más nueva
    ultimosIngresos = filas;
    agruparMostrado = agrupar;
    dibujarIngresos(filas);
    return true;
  } catch (error) {
    if (numero !== consultaIngresos) return true;
    manejarError(error, mostrarError);
    return false;
  }
}

function dibujarIngresos(filas) {
  secIngresos.hidden = false;

  // Totales del período. Se suma en CENTAVOS enteros (aCentavos,
  // de api.js): en JavaScript 0.1 + 0.2 no da 0.3 exacto.
  let efectivo = 0;
  let transferencia = 0;
  let total = 0;
  let valorSinCargo = 0;
  let cobros = 0;
  let sinCargo = 0;
  for (const f of filas) {
    efectivo += aCentavos(f.efectivo);
    transferencia += aCentavos(f.transferencia);
    total += aCentavos(f.total);
    valorSinCargo += aCentavos(f.valor_sin_cargo);
    cobros += f.cantidad_cobros;
    sinCargo += f.cantidad_sin_cargo;
  }

  resTotal.textContent = formatoPesos(total / 100);
  resCobros.textContent = cobros === 1 ? '1 mesa cobrada' : cobros + ' mesas cobradas';
  resEfectivo.textContent = formatoPesos(efectivo / 100);
  resTransferencia.textContent = formatoPesos(transferencia / 100);
  resSinCargo.textContent = String(sinCargo);
  resSinCargoDetalle.textContent = sinCargo > 0
    ? formatoPesos(valorSinCargo / 100) + ' que no se cobraron'
    : 'Ninguna mesa sin cargo';

  dibujarGraficoIngresos(filas);
  dibujarTablaIngresos(filas);
  btnCsvIngresos.disabled = filas.length === 0;
}

/* Gráfico: una barra por período. El período con más plata es el
   100% del ancho; los demás, proporcionales. Cada barra se parte
   en efectivo y transferencia. */
function dibujarGraficoIngresos(filas) {
  graficoIngresos.textContent = '';

  const maximo = Math.max(0, ...filas.map(f => f.total));
  sinIngresos.hidden = maximo > 0;
  graficoIngresos.hidden = maximo === 0;
  if (maximo === 0) return;

  for (const f of filas) {
    // Copia de la plantilla del HTML (<template>)
    const barra = plantillaIngreso.content.firstElementChild.cloneNode(true);
    barra.querySelector('.est-barra__etiqueta').textContent = etiquetaPeriodo(f.periodo, agruparMostrado);
    barra.querySelector('.est-barra__valor').textContent = formatoPesos(f.total);

    const parteEfectivo = barra.querySelector('.est-barra__parte--efectivo');
    const parteTransf = barra.querySelector('.est-barra__parte--transferencia');
    parteEfectivo.title = 'Efectivo ' + formatoPesos(f.efectivo);
    parteTransf.title = 'Transferencia ' + formatoPesos(f.transferencia);

    if (f.total === 0) barra.classList.add('est-barra--vacia');
    graficoIngresos.append(barra);

    // El ancho se pone DESPUÉS de agregarla, en el próximo cuadro,
    // para que la transición del CSS la haga crecer desde 0
    requestAnimationFrame(() => {
      parteEfectivo.style.width = porcentaje(f.efectivo, maximo);
      parteTransf.style.width = porcentaje(f.transferencia, maximo);
    });
  }
}

// Tabla con los números exactos (createElement + textContent, nunca innerHTML)
function dibujarTablaIngresos(filas) {
  tablaIngresos.textContent = '';
  for (const f of filas) {
    const fila = document.createElement('tr');
    agregarCelda(fila, etiquetaPeriodo(f.periodo, agruparMostrado));
    agregarCelda(fila, formatoPesos(f.efectivo), 'caja-num');
    agregarCelda(fila, formatoPesos(f.transferencia), 'caja-num');
    agregarCelda(fila, formatoPesos(f.total), 'caja-num');
    agregarCelda(fila, String(f.cantidad_cobros), 'caja-num');
    agregarCelda(fila, String(f.cantidad_sin_cargo), 'caja-num');
    agregarCelda(fila, formatoPesos(f.valor_sin_cargo), 'caja-num');
    tablaIngresos.append(fila);
  }
}

/* =========================================================
   PLATOS MÁS VENDIDOS (RF-EST-01)
   ========================================================= */

async function cargarPlatos() {
  const numero = ++consultaPlatos;
  const categoria = filtroCategoria.value;
  try {
    const platos = await obtenerRankingPlatos(rangoActual.desde, rangoActual.hasta, categoria);
    if (numero !== consultaPlatos) return true;
    ultimosPlatos = platos;
    categoriaMostrada = categoria;
    dibujarPlatos(platos);
    return true;
  } catch (error) {
    if (numero !== consultaPlatos) return true;
    manejarError(error, mostrarError);
    return false;
  }
}

// Ya vienen ordenados del más vendido al menos vendido (lo ordena la base)
function dibujarPlatos(platos) {
  secPlatos.hidden = false;
  graficoPlatos.textContent = '';
  sinPlatos.hidden = platos.length > 0;
  graficoPlatos.hidden = platos.length === 0;
  btnCsvPlatos.disabled = platos.length === 0;
  if (platos.length === 0) return;

  const maximo = platos[0].cantidad; // el primero es el más vendido

  for (const p of platos) {
    const barra = plantillaPlato.content.firstElementChild.cloneNode(true);
    barra.querySelector('.est-barra__nombre').textContent = p.nombre;

    // "A01 · Comidas · $ 19.000 · 1 sin cargo"
    const extras = [p.codigo, p.categoria_nombre, formatoPesos(p.importe)];
    if (p.cantidad_sin_cargo > 0) extras.push(p.cantidad_sin_cargo + ' sin cargo');
    barra.querySelector('.est-barra__extra').textContent = extras.join(' · ');

    barra.querySelector('.est-barra__valor').textContent = p.cantidad + ' u.';

    const parte = barra.querySelector('.est-barra__parte--plato');
    graficoPlatos.append(barra);
    requestAnimationFrame(() => {
      parte.style.width = porcentaje(p.cantidad, maximo);
    });
  }
}

/* =========================================================
   EXPORTAR A CSV (RF-EST-04)
   El archivo se arma en el navegador: no necesita internet ni
   ninguna librería. Se abre con Excel.
   ========================================================= */

function exportarIngresos() {
  if (!rangoActual || ultimosIngresos.length === 0) return;
  const encabezados = ['Período', 'Desde', 'Efectivo', 'Transferencia', 'Total',
                       'Mesas cobradas', 'Sin cargo', 'Valor sin cargo'];
  const filas = ultimosIngresos.map(f => [
    etiquetaPeriodo(f.periodo, agruparMostrado),
    f.periodo,
    f.efectivo,
    f.transferencia,
    f.total,
    f.cantidad_cobros,
    f.cantidad_sin_cargo,
    f.valor_sin_cargo
  ]);
  descargarCsv('ingresos_' + rangoActual.desde + '_a_' + rangoActual.hasta + '.csv', encabezados, filas);
}

function exportarPlatos() {
  if (!rangoActual || ultimosPlatos.length === 0) return;
  const encabezados = ['Puesto', 'Código', 'Plato', 'Categoría', 'Cantidad',
                       'Importe', 'Cantidad sin cargo'];
  const filas = ultimosPlatos.map((p, i) => [
    i + 1, p.codigo, p.nombre, p.categoria_nombre, p.cantidad, p.importe, p.cantidad_sin_cargo
  ]);
  const sufijo = categoriaMostrada ? '_categoria_' + categoriaMostrada : '';
  descargarCsv('platos_' + rangoActual.desde + '_a_' + rangoActual.hasta + sufijo + '.csv', encabezados, filas);
}

/* Arma el CSV y lo descarga.
   - Separador ";" y decimales con coma: es lo que espera el Excel
     configurado en castellano (con "," pondría todo en una columna).
   - "﻿" al principio (BOM): avisa a Excel que el texto es UTF-8,
     si no las tildes y la ñ salen como "Ã±". */
function descargarCsv(nombreArchivo, encabezados, filas) {
  const lineas = [encabezados, ...filas].map(fila => fila.map(celdaCsv).join(';'));
  const contenido = '﻿' + lineas.join('\r\n');

  // Blob = un "archivo" en memoria. El enlace temporal lo descarga.
  const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombreArchivo;
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  // Liberamos la memoria un rato después (algunos navegadores la
  // necesitan un momento más para terminar la descarga)
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Una celda del CSV
function celdaCsv(valor) {
  // Números: sin separador de miles y con coma decimal (17000,5)
  if (typeof valor === 'number') {
    return String(valor).replace('.', ',');
  }
  let texto = String(valor ?? '');
  // Seguridad: si un texto empieza con = + - @, Excel lo toma como
  // FÓRMULA. Un nombre de plato como "=HIPERVINCULO(...)" se
  // ejecutaría al abrir el archivo. Con un apóstrofo adelante, Excel
  // lo muestra como texto común.
  if (/^[=+\-@]/.test(texto)) texto = "'" + texto;
  // Si tiene ; comillas o saltos de línea, va entre comillas
  // (y las comillas de adentro se duplican)
  if (/[;"\r\n]/.test(texto)) texto = '"' + texto.replace(/"/g, '""') + '"';
  return texto;
}

/* =========================================================
   Utilidades
   ========================================================= */

// Ancho de una barra: valor / máximo, en % (con un decimal)
function porcentaje(valor, maximo) {
  if (!maximo || maximo <= 0) return '0%';
  return Math.round((valor / maximo) * 1000) / 10 + '%';
}

// "2026-11-23" → "lunes 23/11/2026"
function fechaLarga(texto) {
  const f = textoAFecha(texto);
  if (!f) return texto;
  return DIAS_SEMANA[f.getDay()] + ' ' + diaMes(f) + '/' + f.getFullYear();
}

// Date → "23/11"
function diaMes(f) {
  return String(f.getDate()).padStart(2, '0') + '/' + String(f.getMonth() + 1).padStart(2, '0');
}

/* Nombre del período para mostrar:
   semana '2026-11-23' → "Semana del 23/11"
   mes    '2026-11'    → "Noviembre 2026"
   Si el período elegido corta la semana (o el mes) por la mitad,
   lo aclara: "Semana del 26/10 (desde 01/11)". Si no, parecería que
   se cuenta la semana entera cuando solo entran algunos días. */
function etiquetaPeriodo(periodo, agrupar) {
  let inicio;
  let fin;
  let texto;

  if (agrupar === 'mes') {
    const [anio, mes] = periodo.split('-').map(Number);
    inicio = new Date(anio, mes - 1, 1);
    fin = new Date(anio, mes, 0); // último día del mes
    texto = NOMBRES_MES[mes - 1] + ' ' + anio;
  } else {
    inicio = textoAFecha(periodo);
    if (!inicio) return periodo;
    fin = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + 6);
    texto = 'Semana del ' + diaMes(inicio);
  }

  if (rangoActual) {
    const desde = textoAFecha(rangoActual.desde);
    const hasta = textoAFecha(rangoActual.hasta);
    const aclaraciones = [];
    if (desde && inicio < desde) aclaraciones.push('desde ' + diaMes(desde));
    if (hasta && fin > hasta) aclaraciones.push('hasta ' + diaMes(hasta));
    if (aclaraciones.length > 0) texto += ' (' + aclaraciones.join(', ') + ')';
  }
  return texto;
}

function agregarCelda(fila, texto, clase) {
  const td = document.createElement('td');
  td.textContent = texto;
  if (clase) td.className = clase;
  fila.append(td);
  return td;
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