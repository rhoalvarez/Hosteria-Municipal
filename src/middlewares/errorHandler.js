module.exports = (err, req, res, next) => {
  console.error(err);
  if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe un registro con esos datos.' });
  if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ error: 'La operación no puede completarse por una relación existente.' });
  if (err.sqlState === '45000') return res.status(400).json({ error: err.sqlMessage || err.message });
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Error interno del servidor.' });
};
