module.exports = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      error: 'Debés iniciar sesión para realizar esta operación.'
    });
  }

  if (!roles.includes(req.user.rol)) {
    return res.status(403).json({
      error: 'No tenés permisos para esta operación.'
    });
  }

  next();
};