/* =========================================================
   login.js — Lógica de la pantalla de ingreso (index.html)
   ---------------------------------------------------------
   El usuario NO elige su rol: escribe usuario y contraseña, y
   el rol viene del sistema. Si se pudiera elegir, un mozo
   podría entrar como encargado.
   ========================================================= */

// Si ya hay sesión abierta, vamos directo a la pantalla del rol
const sesionGuardada = obtenerSesion();
if (sesionGuardada && sesionGuardada.usuario) {
  irAPantallaDelRol(sesionGuardada.usuario.rol);
}

// Elementos de la página
const formLogin     = document.getElementById('form-login');
const inputUsuario  = document.getElementById('usuario');
const inputClave    = document.getElementById('clave');
const botonIngresar = document.getElementById('btn-ingresar');
const mensajeError  = document.getElementById('mensaje-error');
const avisoMock     = document.getElementById('aviso-mock');

// En modo prueba mostramos los usuarios de ejemplo.
// Además sirve de alarma: si esto aparece en la hostería, el
// sistema quedó instalado con datos simulados.
if (USAR_MOCK) {
  avisoMock.textContent =
    'Modo prueba (datos simulados). Usuarios: encargado, recepcion, mozo1, mozo2, cocina. Contraseña: 1234';
  avisoMock.hidden = false;
}

inputUsuario.focus();

formLogin.addEventListener('submit', async function (evento) {
  evento.preventDefault(); // que el formulario no recargue la página
  ocultarError();

  const usuario = inputUsuario.value.trim();
  const clave = inputClave.value; // la contraseña no se recorta

  if (usuario === '' || clave === '') {
    mostrarError('Completá usuario y contraseña.');
    return;
  }

  // Deshabilitamos el botón para evitar doble envío
  botonIngresar.disabled = true;
  botonIngresar.textContent = 'Ingresando…';

  try {
    const datos = await login(usuario, clave);
    guardarSesion(datos);
    irAPantallaDelRol(datos.usuario.rol);
  } catch (error) {
    mostrarError(error.message);
    inputClave.value = '';
    inputClave.focus();
  } finally {
    botonIngresar.disabled = false;
    botonIngresar.textContent = 'Ingresar';
  }
});

function irAPantallaDelRol(rol) {
  const destino = PAGINA_POR_ROL[rol];
  if (destino) {
    location.href = destino;
  } else {
    cerrarSesion();
    mostrarError('Tu usuario no tiene un rol válido. Consultá con el encargado.');
  }
}

// textContent (y no innerHTML) para que ningún texto se
// interprete como HTML: evita inyección de código (XSS)
function mostrarError(texto) {
  mensajeError.textContent = texto;
  mensajeError.hidden = false;
}

function ocultarError() {
  mensajeError.textContent = '';
  mensajeError.hidden = true;
}