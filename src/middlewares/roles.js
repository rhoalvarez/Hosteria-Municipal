module.exports = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.rol)) return res.status(403).json({ error: 'No tenés permisos para esta operación.' });
  next();
};
