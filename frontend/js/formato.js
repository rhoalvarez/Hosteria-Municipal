/* =========================================================
   formato.js — Funciones de formato compartidas
   ---------------------------------------------------------
   Antes estaban dentro de mesas.js. Las pasamos acá porque
   también las usan pedido (y después cocina y caja): así no
   repetimos código y si hay que cambiar algo, se cambia en
   un solo lugar.
   Intl viene incluido en el navegador: no necesita internet.
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