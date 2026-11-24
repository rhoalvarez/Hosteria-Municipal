const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "hosteria",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: "utf8mb4"
});

async function callProcedure(name, params = []) {
  // Solo permite nombres de procedimientos SQL válidos.
  if (!/^sp_[a-zA-Z0-9_]+$/.test(name)) {
    throw new Error("Nombre de procedimiento SQL inválido.");
  }

  const placeholders = params.map(() => "?").join(",");
  const [sets] = await pool.query(
    `CALL ${name}(${placeholders})`,
    params
  );

  return Array.isArray(sets) ? sets[0] : sets;
}

module.exports = { pool, callProcedure };