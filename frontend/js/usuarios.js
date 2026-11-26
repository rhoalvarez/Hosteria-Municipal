/* =========================================================
   usuarios.js — Pantalla de usuarios (RF-USU-03)
   ---------------------------------------------------------
   Solo para el ENCARGADO. Permite:
   - Ver los usuarios del restaurante (activos primero)
   - Crear uno nuevo
   - Editar nombre y rol (el usuario del login no se cambia)
   - Cambiar la contraseña
   - Desactivar (dos toques) o volver a activar

   Las reglas importantes (no quedarse sin encargado, no
   desactivarse a uno mismo, usuarios de otros sistemas) las
   controla el BACKEND. Acá solo escondemos los botones que no
   corresponden, para que la pantalla sea clara.
   ========================================================= */

// Si no es encargado, exigirRol lo manda a su pantalla
const sesion = exigirRol(['encargado']);

// Nombres lindos para mostrar cada rol
const NOMBRE_ROL = {
  encargado: 'Encargado',
  mozo: 'Mozo',
  cocina: 'Cocina'
};

// Tiempo para dar el segundo toque de "Desactivar"
const MS_CONFIRMAR = 4000;

/* ---------- Elementos de la pantalla ---------- */
const elMensaje = document.getElementById('mensaje');
const elLista = document.getElementById('lista-usuarios');
const plantilla = document.getElementById('plantilla-usuario');

const btnNuevo = document.getElementById('btn-nuevo');
const formUsuario = document.getElementById('form-usuario');
const tituloForm = document.getElementById('titulo-form');
const inNombre = document.getElementById('usu-nombre');
const inUsuario = document.getElementById('usu-usuario');
const camposClaveAlta = document.getElementById('campos-clave-alta');
const inClave = document.getElementById('usu-clave');
const inClave2 = document.getElementById('usu-clave2');
const inRol = document.getElementById('usu-rol');
const errorUsuario = document.getElementById('error-usuario');
const btnGuardar = document.getElementById('btn-guardar');
const btnCancelar = document.getElementById('btn-cancelar');

const formClave = document.getElementById('form-clave');
const clavePara = document.getElementById('clave-para');
const inNuevaClave = document.getElementById('nueva-clave');
const inNuevaClave2 = document.getElementById('nueva-clave2');
const errorClave = document.getElementById('error-clave');
const btnGuardarClave = document.getElementById('btn-guardar-clave');
const btnCancelarClave = document.getElementById('btn-cancelar-clave');

/* ---------- Estado de la pantalla ---------- */
let usuarios = [];          // la última lista que mandó el servidor
let idEditando = null;      // null = el formulario está en modo "alta"
let idClave = null;         // usuario al que se le cambia la contraseña
let idConfirmando = null;   // usuario con "Desactivar" esperando el 2.º toque
let temporizador = null;

/* =========================================================
   Mensajes
   ========================================================= */

function mostrarMensaje(texto, esError) {
  elMensaje.textContent = texto;
  elMensaje.classList.toggle('mensaje--error', !!esError);
  elMensaje.hidden = !texto;
}

function mostrarError(elemento, texto) {
  elemento.textContent = texto;
  elemento.hidden = !texto;
}

/* Si el token venció (401), volvemos al login.
   Devuelve true si ya se ocupó del error. */
function manejarSesionVencida(error) {
  if (error.estado === 401) {
    cerrarSesion();
    location.href = '../index.html';
    return true;
  }
  return false;
}

/* =========================================================
   Lista de usuarios
   ========================================================= */

async function cargarUsuarios() {
  try {
    usuarios = await obtenerUsuarios();
    dibujarLista();
    mostrarMensaje(usuarios.length === 0 ? 'Todavía no hay usuarios.' : '');
  } catch (error) {
    if (manejarSesionVencida(error)) return;
    mostrarMensaje(error.message, true);
  }
}

function dibujarLista() {
  elLista.innerHTML = '';
  const miId = sesion.usuario.id;

  for (const u of usuarios) {
    // Copiamos la plantilla del HTML
    const li = plantilla.content.firstElementChild.cloneNode(true);
    li.dataset.id = u.id;
    li.classList.toggle('usu-item--inactivo', !u.activo);

    // textContent (y no innerHTML): si alguien escribe <script> en
    // el nombre, se muestra como texto y no se ejecuta
    li.querySelector('.usu-item__nombre').textContent =
      u.nombre + (u.id === miId ? ' (vos)' : '');
    li.querySelector('.usu-item__datos').textContent =
      u.usuario + ' · ' + (NOMBRE_ROL[u.rol] || u.rol);
    li.querySelector('.usu-item__estado').hidden = u.activo;
    li.querySelector('.usu-item__aviso').hidden = !u.otros_sistemas;

    const btnActivo = li.querySelector('[data-accion="activo"]');
    btnActivo.textContent = u.activo ? 'Desactivar' : 'Activar';

    // Escondemos "Desactivar" donde el backend igual lo rechazaría:
    // en uno mismo y en usuarios que también usa otro sistema
    if (u.activo && (u.id === miId || u.otros_sistemas)) {
      btnActivo.remove();
    }

    elLista.appendChild(li);
  }
}

// Un solo "escuchador" para todos los botones de la lista
// (delegación de eventos): sirve aunque la lista se vuelva a dibujar
elLista.addEventListener('click', (evento) => {
  const boton = evento.target.closest('button[data-accion]');
  if (!boton) return;

  const id = Number(boton.closest('li').dataset.id);
  const usuario = usuarios.find(u => u.id === id);
  if (!usuario) return;

  const accion = boton.dataset.accion;
  if (accion === 'editar') abrirEdicion(usuario);
  if (accion === 'clave') abrirCambioClave(usuario);
  if (accion === 'activo') tocarActivo(usuario, boton);
});

/* =========================================================
   Alta y edición (el mismo formulario)
   ========================================================= */

function cerrarFormularios() {
  formUsuario.hidden = true;
  formClave.hidden = true;
  btnNuevo.hidden = false;
  idEditando = null;
  idClave = null;
}

function abrirAlta() {
  cerrarFormularios();
  formUsuario.reset();
  tituloForm.textContent = 'Nuevo usuario';
  inUsuario.disabled = false;
  camposClaveAlta.hidden = false;
  mostrarError(errorUsuario, '');
  btnNuevo.hidden = true;
  formUsuario.hidden = false;
  inNombre.focus();
}

function abrirEdicion(u) {
  cerrarFormularios();
  idEditando = u.id;
  tituloForm.textContent = 'Editar usuario';
  inNombre.value = u.nombre;
  inUsuario.value = u.usuario;
  inUsuario.disabled = true;     // el usuario del login no se cambia (propuesta)
  camposClaveAlta.hidden = true; // la contraseña va por su propio formulario
  inClave.value = '';
  inClave2.value = '';
  inRol.value = u.rol;
  mostrarError(errorUsuario, '');
  btnNuevo.hidden = true;
  formUsuario.hidden = false;
  formUsuario.scrollIntoView({ behavior: 'smooth', block: 'start' });
  inNombre.focus();
}

formUsuario.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  mostrarError(errorUsuario, '');

  const datos = {
    nombre: inNombre.value,
    usuario: inUsuario.value,
    rol: inRol.value
  };

  // En el alta, las dos contraseñas tienen que coincidir
  if (idEditando === null) {
    if (inClave.value !== inClave2.value) {
      mostrarError(errorUsuario, 'Las contraseñas no coinciden');
      return;
    }
    datos.clave = inClave.value;
  }

  // Deshabilitamos el botón: evita guardar dos veces con doble toque
  btnGuardar.disabled = true;
  try {
    if (idEditando === null) {
      await crearUsuario(datos);
      mostrarMensaje('Usuario "' + datos.usuario.trim() + '" creado ✔');
    } else {
      await editarUsuario(idEditando, datos);
      mostrarMensaje('Usuario actualizado ✔');
    }
        const exito = elMensaje.textContent; // guardamos el "creado ✔"
    cerrarFormularios();
    await cargarUsuarios();              // esto borra el mensaje...
    mostrarMensaje(exito);               // ...así que lo volvemos a mostrar
  } catch (error) {
    if (manejarSesionVencida(error)) return;
    mostrarError(errorUsuario, error.message);
  } finally {
    btnGuardar.disabled = false;
  }
});

/* =========================================================
   Cambio de contraseña
   ========================================================= */

function abrirCambioClave(u) {
  cerrarFormularios();
  idClave = u.id;
  formClave.reset();
  clavePara.textContent = 'De: ' + u.nombre + ' (' + u.usuario + ')';
  mostrarError(errorClave, '');
  btnNuevo.hidden = true;
  formClave.hidden = false;
  formClave.scrollIntoView({ behavior: 'smooth', block: 'start' });
  inNuevaClave.focus();
}

formClave.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  mostrarError(errorClave, '');

  if (inNuevaClave.value !== inNuevaClave2.value) {
    mostrarError(errorClave, 'Las contraseñas no coinciden');
    return;
  }

  btnGuardarClave.disabled = true;
  try {
    const r = await cambiarClaveUsuario(idClave, inNuevaClave.value);
    cerrarFormularios();
    mostrarMensaje(r.otros_sistemas
      ? 'Contraseña cambiada ✔ (también cambió en el otro sistema donde se usa este usuario)'
      : 'Contraseña cambiada ✔');
  } catch (error) {
    if (manejarSesionVencida(error)) return;
    mostrarError(errorClave, error.message);
  } finally {
    btnGuardarClave.disabled = false;
  }
});

/* =========================================================
   Activar / desactivar
   Desactivar pide DOS toques (como Anular y Cobrar):
   el primero cambia el texto del botón, el segundo confirma.
   Activar va directo: no hace daño.
   ========================================================= */

function cancelarConfirmacion() {
  clearTimeout(temporizador);
  idConfirmando = null;
}

async function tocarActivo(u, boton) {
  // Activar: directo
  if (!u.activo) {
    await guardarActivo(u, true);
    return;
  }

  // Desactivar, primer toque: pedimos confirmación
  if (idConfirmando !== u.id) {
    cancelarConfirmacion();
    dibujarLista(); // por si había otro botón esperando confirmación
    const nuevo = elLista.querySelector('li[data-id="' + u.id + '"] [data-accion="activo"]');
    nuevo.textContent = '¿Seguro? Tocá de nuevo';
    nuevo.classList.add('usu-confirmar');
    idConfirmando = u.id;
    // Si no confirma en 4 segundos, el botón vuelve a la normalidad
    temporizador = setTimeout(() => {
      cancelarConfirmacion();
      dibujarLista();
    }, MS_CONFIRMAR);
    return;
  }

  // Segundo toque: desactivamos
  cancelarConfirmacion();
  boton.disabled = true;
  await guardarActivo(u, false);
}

async function guardarActivo(u, activo) {
  try {
    await cambiarActivoUsuario(u.id, activo);
    await cargarUsuarios();
    mostrarMensaje(u.nombre + (activo ? ' fue activado ✔' : ' fue desactivado ✔ (ya no puede iniciar sesión)'));
  } catch (error) {
    if (manejarSesionVencida(error)) return;
    mostrarMensaje(error.message, true);
    dibujarLista();
  }
}

/* =========================================================
   Arranque
   ========================================================= */

if (sesion) {
  document.getElementById('nombre-usuario').textContent = sesion.usuario.nombre;

  document.getElementById('btn-salir').addEventListener('click', () => {
    cerrarSesion();
    location.href = '../index.html';
  });

  btnNuevo.addEventListener('click', abrirAlta);
  btnCancelar.addEventListener('click', cerrarFormularios);
  btnCancelarClave.addEventListener('click', cerrarFormularios);

  cargarUsuarios();
}