const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { callProcedure } = require('../config/db');
const HttpError = require('../utils/httpError');

const ROLES_VALIDOS = ['ENCARGADO', 'MOZO', 'COCINA'];

exports.login = async (req, res) => {
  const { usuario, clave } = req.body || {};

  if (!usuario || !clave) {
    throw new HttpError(400, 'Ingresá usuario y contraseña.');
  }

  const rows = await callProcedure('sp_usuario_por_login', [usuario]);
  const user = rows[0];

  if (!user || !user.activo || !(await bcrypt.compare(clave, user.clave))) {
    throw new HttpError(401, 'Credenciales incorrectas.');
  }

  if (!ROLES_VALIDOS.includes(user.rol)) {
    throw new HttpError(403, 'El usuario no tiene un rol válido asignado.');
  }

  const token = jwt.sign(
    {
      id_usuario: user.id_usuario,
      usuario: user.usuario,
      nombre: user.nombre,
      rol: user.rol
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );

  res.json({
    token,
    usuario: {
      id_usuario: user.id_usuario,
      nombre: user.nombre,
      usuario: user.usuario,
      rol: user.rol
    }
  });
};

exports.setupAdmin = async (req, res) => {
  const countRows = await callProcedure('sp_usuario_contar');

  if (Number(countRows[0].total) !== 0) {
    throw new HttpError(403, 'La configuración inicial ya fue realizada.');
  }

  const { nombre, usuario, clave } = req.body || {};

  if (!nombre || !usuario || !clave || clave.length < 10) {
    throw new HttpError(
      400,
      'Completá nombre, usuario y una contraseña de al menos 10 caracteres.'
    );
  }
                          
  const hash = await bcrypt.hash(clave, 12);

  const result = await callProcedure(
    'sp_usuario_crear',
    [nombre, usuario, hash, 'ENCARGADO']
  );

  res.status(201).json({
    mensaje: 'Encargado inicial creado.',
    id_usuario: result[0].id_usuario
  });
};