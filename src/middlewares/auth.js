const jwt = require("jsonwebtoken");

module.exports = function auth(req, res, next) {
  // Obtener la ruta sin parámetros de consulta
  const ruta = req.path;

  // Rutas públicas para los clientes que escanean el QR
  const qrPublico =
    (req.method === "GET" &&
      ruta.includes("/qr/") &&
      ruta.endsWith("/menu")) ||
    (req.method === "POST" &&
      ruta.includes("/qr/") &&
      ruta.endsWith("/pedidos"));

  // Si es una ruta QR pública, no exigir token
  if (qrPublico) {
    return next();
  }

  // Autenticación para el resto de las rutas
  const header = req.headers.authorization || "";

  const token = header.startsWith("Bearer ")
    ? header.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({
      error: "Falta el token Bearer."
    });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch (error) {
    return res.status(401).json({
      error: "Token inválido o vencido."
    });
  }
};