/* =========================================================
   sesion.js — Manejo de la sesión del usuario en el navegador
   ---------------------------------------------------------
   Guarda quién inició sesión (token + datos del usuario) y
   decide a qué pantalla va cada rol.

   IMPORTANTE: esto NO es la seguridad del sistema. Cualquiera
   puede tocar el localStorage desde el navegador. La seguridad
   real la hace el backend, que debe verificar el token y el rol
   en CADA petición. Esto solo sirve para que la interfaz muestre
   la pantalla correcta.

   Roles (decidido 22/11): encargado, mozo y cocina.
   No hay rol "recepción": en la hostería las recepcionistas
   actúan como encargadas, así que entran con el rol encargado.
   ========================================================= */

// Nombre con el que guardamos la sesión (prefijo rest_ como las tablas)
const CLAVE_SESION = 'rest_sesion';

// Pantalla de inicio de cada rol (rutas desde la raíz de frontend/)
// Los roles llegan en minúscula: api.js los convierte, porque el
// backend los manda en mayúscula (ENCARGADO, MOZO, COCINA).
const PAGINA_POR_ROL = {
  encargado: 'pages/mesas.html', // en el Inc. 3 puede pasar a caja
  mozo:      'pages/mesas.html',
  cocina:    'pages/cocina.html'
};

// Guarda lo que devuelve el login: { token, usuario: { id, nombre, rol } }
function guardarSesion(datos) {
  try {
    localStorage.setItem(CLAVE_SESION, JSON.stringify(datos));
  } catch (e) {
    // Puede fallar en modo incógnito o con el almacenamiento lleno
    console.error('No se pudo guardar la sesión', e);
  }
}

// Devuelve la sesión guardada, o null si no hay
function obtenerSesion() {
  try {
    const texto = localStorage.getItem(CLAVE_SESION);
    return texto ? JSON.parse(texto) : null;
  } catch (e) {
    return null; // si el dato está corrupto, es como no tener sesión
  }
}

// Borra la sesión (botón "Salir")
function cerrarSesion() {
  try {
    localStorage.removeItem(CLAVE_SESION);
  } catch (e) { /* nada que hacer */ }
}

/* Se llama al principio de cada página de pages/.
   - Si no hay sesión, manda al login.
   - Si el rol no puede ver esta página, lo manda a la suya.
   - Si el rol no existe (por ejemplo, una sesión vieja con el
     rol "recepcion" que ya no usamos), cierra la sesión.
   Devuelve la sesión si puede quedarse. */
function exigirRol(rolesPermitidos) {
  const sesion = obtenerSesion();

  if (!sesion || !sesion.usuario) {
    location.href = '../index.html';
    return null;
  }

  const rol = sesion.usuario.rol;
  if (!rolesPermitidos.includes(rol)) {
    const destino = PAGINA_POR_ROL[rol];
    if (destino) {
      location.href = '../' + destino;
    } else {
      // Rol desconocido: por las dudas, cerramos la sesión
      cerrarSesion();
      location.href = '../index.html';
    }
    return null;
  }

  return sesion;
}