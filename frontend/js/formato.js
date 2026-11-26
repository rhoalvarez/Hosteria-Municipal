/* =========================================================
   formato.js — Funciones de formato compartidas
   ---------------------------------------------------------
   Antes estaban dentro de mesas.js. Las pasamos acá porque
   también las usan pedido (y después cocina y caja): así no
   repetimos código y si hay que cambiar algo, se cambia en
   un solo lugar.
   Intl viene incluido en el navegador: no necesita internet.

   También está acá la exportación a CSV: la usan Estadísticas
   (RF-EST-04) y Caja (RF-CAJ-12). Antes vivía en estadisticas.js.
   ========================================================= */

// Se crea una sola vez y se reutiliza en cada llamada
const FORMATO_PESOS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0
});

// Hora SIEMPRE en 24 h ("18:26"), como en la comanda de papel.
// Si no lo indicamos, cada navegador decide: algunos muestran
// "06:26 p. m.", que en la cocina o el salón se puede confundir.
// hourCycle 'h23' = de 00 a 23. Usamos esto y no "hour12: false"
// porque en algunos navegadores "hour12: false" muestra la
// medianoche como "24:05" en lugar de "00:05".
const FORMATO_HORA = new Intl.DateTimeFormat('es-AR', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

// 35000 → "$ 35.000"
function formatoPesos(numero) {
  return FORMATO_PESOS.format(Number(numero) || 0);
}

// "2026-11-16T21:15:00.000Z" → "18:15" (hora local del dispositivo)
function formatearHora(fechaIso) {
  const fecha = new Date(fechaIso);
  if (isNaN(fecha)) return ''; // fecha inválida: no mostramos nada
  return FORMATO_HORA.format(fecha);
}

/* =========================================================
   EXPORTAR A CSV (RF-EST-04 y RF-CAJ-12)
   El archivo se arma en el navegador: no necesita internet ni
   ninguna librería. Se abre con Excel.
   ========================================================= */

/* Arma el CSV y lo descarga.
   - Separador ";" y decimales con coma: es lo que espera el Excel
     configurado en castellano (con "," pondría todo en una columna).
   - "\uFEFF" al principio (BOM): avisa a Excel que el texto es UTF-8,
     si no las tildes y la ñ salen como "Ã±". */
function descargarCsv(nombreArchivo, encabezados, filas) {
  const lineas = [encabezados, ...filas].map(fila => fila.map(celdaCsv).join(';'));
  const contenido = '\uFEFF' + lineas.join('\r\n');

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
  // FÓRMULA. Un concepto como "=HIPERVINCULO(...)" se ejecutaría al
  // abrir el archivo. Con un apóstrofo adelante, Excel lo muestra
  // como texto común.
  if (/^[=+\-@]/.test(texto)) texto = "'" + texto;
  // Si tiene ; comillas o saltos de línea, va entre comillas
  // (y las comillas de adentro se duplican)
  if (/[;"\r\n]/.test(texto)) texto = '"' + texto.replace(/"/g, '""') + '"';
  return texto;
}