module.exports = (err, req, res, next) => {
  console.error(err);

  // Código duplicado
  if (err.code === "ER_DUP_ENTRY") {
    return res.status(409).json({
      error:
        err.status === 409
          ? err.message
          : "Ya existe un registro con esos datos.",
    });
  }

  // Problemas con relaciones de la base de datos
  if (
    err.code === "ER_NO_REFERENCED_ROW_2" ||
    err.code === "ER_ROW_IS_REFERENCED_2"
  ) {
    return res.status(409).json({
      error:
        "La operación no puede completarse por una relación existente.",
    });
  }

  // Errores enviados desde procedimientos almacenados
  if (err.sqlState === "45000") {
    return res.status(400).json({
      error: err.sqlMessage || err.message,
    });
  }

  // Errores personalizados del backend
  res.status(err.status || 500).json({
    error: err.status
      ? err.message
      : "Error interno del servidor.",
  });
};