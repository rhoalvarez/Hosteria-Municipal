const { callProcedure } = require('../config/db');
// Auditoría best-effort: no debe ocultar el resultado de la operación principal.
async function audit(userId, action, table, recordId, detail = null) {
  try { await callProcedure('sp_auditoria_registrar', [userId || null, action, table, recordId || null, null, detail ? JSON.stringify(detail) : null]); }
  catch (error) { console.error('No se pudo registrar auditoría:', error.message); }
}
module.exports = audit;
