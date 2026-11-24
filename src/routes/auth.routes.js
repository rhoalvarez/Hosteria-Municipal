const router = require('express').Router();

const asyncHandler = require('../utils/asyncHandler');
const authController = require('../controllers/auth.controller');

// Inicio de sesión
router.post('/login', asyncHandler(authController.login));

// Crear el primer ENCARGADO del sistema
router.post('/setup/admin', asyncHandler(authController.setupAdmin));

module.exports = router;