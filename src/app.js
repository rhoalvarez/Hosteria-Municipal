require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const swaggerUi = require("swagger-ui-express");
const fs = require("fs");
const path = require("path");
const YAML = require("yaml");

const authRoutes = require("./routes/auth.routes");
const catalogRoutes = require("./routes/catalog.routes");
const restaurantRoutes = require("./routes/restaurant.routes");
const cashRoutes = require("./routes/cash.routes");
const statsRoutes = require("./routes/stats.routes");
const lodgingRoutes = require("./routes/lodging.routes");
const usuariosRoutes = require("./routes/usuarios.routes");
const avisosRoutes = require("./routes/avisos.routes");

const errorHandler = require("./middlewares/errorHandler");

const app = express();

// Seguridad
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        upgradeInsecureRequests: null
      }
    }
  })
);

// CORS
const origins = (process.env.CORS_ORIGIN || "http://localhost:5500")
  .split(",")
  .map((x) => x.trim());

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || origins.includes(origin)) {
        return cb(null, true);
      }

      return cb(null, false);
    },
    credentials: true
  })
);

// Lectura de datos
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

// Estado del servidor
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "hosteria-backend",
    timestamp: new Date().toISOString()
  });
});

// Rutas
app.use("/api/auth", authRoutes);
app.use("/api/usuarios", usuariosRoutes);
app.use("/api", catalogRoutes);
app.use("/api", restaurantRoutes);
app.use("/api/caja", cashRoutes);
// Estadísticas (Inc. 3): ranking de platos e ingresos, solo ENCARGADO
app.use("/api/estadisticas", statsRoutes);
// Avisos para el mozo (RF-PED-05): pedidos listos para llevar
app.use("/api/avisos", avisosRoutes);
app.use("/api", lodgingRoutes);

// Documentación Swagger
const spec = YAML.parse(
  fs.readFileSync(path.join(__dirname, "../docs/openapi.yaml"), "utf8")
);

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(spec));

// Frontend (pantallas del sistema)
// Node entrega también el HTML, CSS y JS de la carpeta frontend/.
// Así, en la hostería se entra con http://IP-DEL-SERVIDOR:3000 y la
// misma dirección sirve las pantallas y la API (/api): no hace falta
// Live Server ni CORS, y el QR de las mesas apunta a un solo lugar.
// Va DESPUÉS de las rutas /api (para que ningún archivo tape la API)
// y ANTES del 404 (si no, el 404 respondería antes y nunca llegaría acá).
// app.js está en src/, por eso se sube un nivel ("..") hasta frontend/.
// En "/" entrega automáticamente frontend/index.html (el login).
app.use(express.static(path.join(__dirname, "..", "frontend")));

// Error 404
app.use((req, res) => {
  res.status(404).json({ error: "Ruta no encontrada." });
});

// Manejo de errores
app.use(errorHandler);

module.exports = app;