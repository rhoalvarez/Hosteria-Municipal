/* =========================================================
   menu.js — ABM del menú (pages/menu.html) — RF-MEN
   ---------------------------------------------------------
   Solo el ENCARGADO. Permite:
   - Alta y edición de platos (el mismo formulario)
   - Marcar agotado / disponible
   - Baja lógica, con confirmación en dos toques
   - Ver los dados de baja y reactivarlos

   Después de cada cambio volvemos a pedir la lista al servidor:
   la que manda es la base de datos, no lo que muestra la pantalla.
   Las reglas (FORMATO_CODIGO, PRECIO_MAXIMO...) vienen de api.js,
   así el formulario y el servidor validan lo mismo.
   ========================================================= */

const sesion = exigirRol(['encargado']);

// ---------- Estado de la pantalla ----------
let categorias = [];
let platosActivos = [];
let platosBaja = [];
let vista = 'activos';          // 'activos' | 'bajas'
let textoBusqueda = '';
let confirmandoBajaId = null;   // plato con el primer toque de "Dar de baja"
let temporizadorBaja = null;
let accionEnCurso = false;      // bloquea el doble toque en los botones de la lista
let editandoId = null;          // null = alta; un número = edición de ese plato
let guardando = false;          // bloquea el doble toque en "Guardar"
let codigoSugerido = '';        // último código que sugerimos (para no pisar lo que escribió)
let elementoAnterior = null;    // para devolver el foco al cerrar el panel
let platoAvisoId = null;        // plato del botón "Editar precio" del aviso

const TIEMPO_CONFIRMAR = 4000;  // ms: después se cancela solo el primer toque de la baja

// ---------- Elementos de la página ----------
const nombreUsuario = document.getElementById('nombre-usuario');
const btnSalir = document.getElementById('btn-salir');
const tabActivos = document.getElementById('tab-activos');
const tabBajas = document.getElementById('tab-bajas');
const buscador = document.getElementById('buscador');
const btnNuevo = document.getElementById('btn-nuevo');
const aviso = document.getElementById('aviso');
const avisoTexto = document.getElementById('aviso-texto');
const avisoEditar = document.getElementById('aviso-editar');
const mensaje = document.getElementById('mensaje');
const lista = document.getElementById('lista-platos');

const panelFondo = document.getElementById('panel-fondo');
const panelTitulo = document.getElementById('panel-titulo');
const form = document.getElementById('form-plato');
const errorForm = document.getElementById('error-form');
const btnGuardar = document.getElementById('btn-guardar');

// Cada campo del formulario con su mensaje de error
const campos = {
  categoria: { input: document.getElementById('input-categoria'), error: document.getElementById('error-categoria') },
  codigo:    { input: document.getElementById('input-codigo'),    error: document.getElementById('error-codigo') },
  nombre:    { input: document.getElementById('input-nombre'),    error: document.getElementById('error-nombre') },
  precio:    { input: document.getElementById('input-precio'),    error: document.getElementById('error-precio') }
};

// Si no tiene permiso, exigirRol ya lo mandó a otra página
if (sesion) iniciar();

function iniciar() {
  nombreUsuario.textContent = sesion.usuario.nombre;

  btnSalir.addEventListener('click', () => {
    cerrarSesion();
    location.href = '../index.html';
  });

  tabActivos.addEventListener('click', () => cambiarVista('activos'));
  tabBajas.addEventListener('click', () => cambiarVista('bajas'));

  buscador.addEventListener('input', () => {
    textoBusqueda = normalizar(buscador.value);
    dibujar();
  });

  btnNuevo.addEventListener('click', () => abrirFormulario(null));

  avisoEditar.addEventListener('click', () => {
    const plato = platosActivos.find(p => p.id === platoAvisoId);
    if (plato) abrirFormulario(plato);
  });

  // Delegación de eventos: un solo escuchador para todos los botones de la lista
  lista.addEventListener('click', alTocarLista);

  form.addEventListener('submit', guardar);
  campos.categoria.input.addEventListener('change', sugerirCodigo);

  // El panel se cierra con Cancelar, tocando el fondo o con Escape
  panelFondo.addEventListener('click', (evento) => {
    if (evento.target === panelFondo || evento.target.hasAttribute('data-cerrar')) {
      cerrarFormulario();
    }
  });
  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && !panelFondo.hidden) cerrarFormulario();
  });

  cargar(true);
}

/* ---------- Datos ---------- */

async function cargar(primeraVez) {
  if (primeraVez) mostrarMensaje('Cargando menú...');
  try {
    // Las tres consultas a la vez (no una detrás de la otra): tarda menos
    const [cats, activos, bajas] = await Promise.all([
      obtenerCategorias(),
      obtenerMenu(),
      obtenerPlatosBaja()
    ]);
    categorias = cats;
    platosActivos = activos;
    platosBaja = bajas;
    dibujar();
  } catch (e) {
    if (esSesionVencida(e)) return;
    mostrarMensaje(e.message, true);
  }
}

/* ---------- Dibujo de la lista ---------- */

function dibujar() {
  // Las pestañas muestran cuántos hay en cada una
  tabActivos.textContent = 'Activos (' + platosActivos.length + ')';
  tabBajas.textContent = 'Dados de baja (' + platosBaja.length + ')';

  lista.textContent = ''; // borra lo dibujado antes

  const fuente = vista === 'activos' ? platosActivos : platosBaja;
  const visibles = fuente
    .filter(coincideBusqueda)
    .sort((a, b) => a.codigo.localeCompare(b.codigo));

  if (visibles.length === 0) {
    if (textoBusqueda) mostrarMensaje('No hay platos que coincidan con la búsqueda.');
    else if (vista === 'activos') mostrarMensaje('Todavía no hay platos cargados. Usá "+ Nuevo plato".');
    else mostrarMensaje('No hay platos dados de baja.');
    return;
  }
  mostrarMensaje('');

  // Un grupo por categoría, en el orden de la tabla de categorías
  for (const cat of categorias) {
    const delGrupo = visibles.filter(p => p.categoria === cat.codigo);
    if (delGrupo.length === 0) continue;

    const seccion = document.createElement('section');
    seccion.className = 'menu-grupo';

    const titulo = crearTexto('h2', 'menu-grupo__titulo',
      cat.codigo + ' · ' + cat.nombre + ' (' + delGrupo.length + ')');

    const ul = document.createElement('ul');
    ul.className = 'lista-menu';
    for (const plato of delGrupo) ul.appendChild(crearFila(plato));

    seccion.append(titulo, ul);
    lista.appendChild(seccion);
  }
}

function crearFila(plato) {
  const li = document.createElement('li');
  li.className = 'plato menu-plato';
  if (vista === 'activos' && !plato.disponible) li.classList.add('plato--agotado');
  if (vista === 'bajas') li.classList.add('menu-plato--baja');

  // Siempre textContent (nunca innerHTML con datos): prevención de XSS
  const info = document.createElement('div');
  info.className = 'plato-info';
  info.append(
    crearTexto('span', 'plato-codigo', plato.codigo),
    crearTexto('span', 'plato-nombre', plato.nombre),
    crearTexto('span', 'plato-precio', formatoPesos(plato.precio))
  );
  if (vista === 'activos') {
    // Color + texto: se entiende aunque alguien no distinga colores
    info.appendChild(crearTexto('span',
      'estado ' + (plato.disponible ? 'estado--libre' : 'estado--agotado'),
      plato.disponible ? 'Disponible' : 'Agotado'));
  }

  const acciones = document.createElement('div');
  acciones.className = 'menu-plato__acciones';

  if (vista === 'activos') {
    acciones.append(
      crearBoton('Editar', 'editar', plato, 'boton--secundario'),
      plato.disponible
        ? crearBoton('Marcar agotado', 'disponibilidad', plato, 'boton--secundario')
        : crearBoton('Marcar disponible', 'disponibilidad', plato, 'boton--exito'),
      // El texto del botón sale de la variable confirmandoBajaId, no del HTML:
      // así un redibujo no "olvida" el primer toque (igual que en cocina)
      confirmandoBajaId === plato.id
        ? crearBoton('¿Confirmar? Tocá de nuevo', 'baja', plato, 'menu-boton--confirmando')
        : crearBoton('Dar de baja', 'baja', plato, 'boton--peligro')
    );
  } else {
    acciones.appendChild(crearBoton('Reactivar', 'reactivar', plato, 'boton--exito'));
  }

  li.append(info, acciones);
  return li;
}

function crearBoton(texto, accion, plato, clase) {
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'boton ' + clase;
  boton.textContent = texto;
  boton.dataset.accion = accion;
  boton.dataset.id = plato.id;
  // El lector de pantalla dice "Editar: Locro" y no solo "Editar"
  boton.setAttribute('aria-label', texto + ': ' + plato.nombre);
  boton.disabled = accionEnCurso;
  return boton;
}

function crearTexto(etiqueta, clase, texto) {
  const elemento = document.createElement(etiqueta);
  elemento.className = clase;
  elemento.textContent = texto;
  return elemento;
}

/* ---------- Acciones de la lista ---------- */

async function alTocarLista(evento) {
  const boton = evento.target.closest('button[data-accion]');
  if (!boton || accionEnCurso) return;

  const id = Number(boton.dataset.id);
  const accion = boton.dataset.accion;
  const plato = (vista === 'activos' ? platosActivos : platosBaja).find(p => p.id === id);
  if (!plato) return;

  if (accion === 'editar') {
    abrirFormulario(plato);
    return;
  }

  // "Dar de baja", primer toque: pedimos confirmación
  if (accion === 'baja' && confirmandoBajaId !== id) {
    pedirConfirmacionBaja(id);
    return;
  }
  cancelarConfirmacionBaja(false);

  accionEnCurso = true;
  dibujar(); // vuelve a dibujar con los botones deshabilitados mientras espera
  ocultarAviso();

  try {
    if (accion === 'disponibilidad') {
      await cambiarDisponibilidad(id, !plato.disponible);
      mostrarAviso(plato.codigo + ' ' + plato.nombre + (plato.disponible
        ? ' marcado como AGOTADO: los mozos lo ven tachado y no lo pueden pedir.'
        : ' vuelve a estar disponible.'));
    } else if (accion === 'baja') {
      await eliminarPlato(id);
      mostrarAviso(plato.codigo + ' ' + plato.nombre +
        ' dado de baja. Si fue un error, reactivalo desde "Dados de baja".');
    } else if (accion === 'reactivar') {
      await reactivarPlato(id);
      mostrarAviso(plato.codigo + ' ' + plato.nombre + ' reactivado. Revisá el precio (' +
        formatoPesos(plato.precio) + '): es el que tenía cuando se dio de baja.', false, id);
    }
  } catch (e) {
    if (esSesionVencida(e)) return;
    // 404 / 409: alguien lo cambió desde otra PC. Avisamos y recargamos.
    mostrarAviso(e.message, true);
  } finally {
    accionEnCurso = false;
  }

  await cargar(false);
}

function pedirConfirmacionBaja(id) {
  cancelarConfirmacionBaja(false);
  confirmandoBajaId = id;
  temporizadorBaja = setTimeout(() => cancelarConfirmacionBaja(true), TIEMPO_CONFIRMAR);
  dibujar();
  // El redibujo crea botones nuevos: devolvemos el foco (para quien usa teclado en la PC)
  const boton = lista.querySelector('button[data-accion="baja"][data-id="' + id + '"]');
  if (boton) boton.focus();
}

function cancelarConfirmacionBaja(redibujar) {
  clearTimeout(temporizadorBaja);
  temporizadorBaja = null;
  if (confirmandoBajaId === null) return;
  confirmandoBajaId = null;
  if (redibujar) dibujar();
}

function cambiarVista(nueva) {
  if (vista === nueva) return;
  vista = nueva;
  tabActivos.setAttribute('aria-pressed', String(nueva === 'activos'));
  tabBajas.setAttribute('aria-pressed', String(nueva === 'bajas'));
  btnNuevo.hidden = nueva === 'bajas'; // en "Dados de baja" no se crean platos
  cancelarConfirmacionBaja(false);
  dibujar();
}

/* ---------- Formulario (alta y edición) ---------- */

function abrirFormulario(plato) {
  cancelarConfirmacionBaja(true);
  ocultarAviso();
  elementoAnterior = document.activeElement;

  editandoId = plato ? plato.id : null;
  panelTitulo.textContent = plato ? 'Editar plato' : 'Nuevo plato';

  llenarCategorias(plato ? plato.categoria : '');
  campos.codigo.input.value = plato ? plato.codigo : '';
  campos.nombre.input.value = plato ? plato.nombre : '';
  campos.precio.input.value = plato ? String(plato.precio) : '';
  codigoSugerido = '';
  limpiarErrores();

  panelFondo.hidden = false;
  // Al editar, lo más común es cambiar el precio (cada 6 meses): foco ahí
  (plato ? campos.precio.input : campos.categoria.input).focus();
}

function cerrarFormulario(forzar) {
  if (guardando && !forzar) return; // no se cierra a mitad de un guardado
  panelFondo.hidden = true;
  editandoId = null;
  if (elementoAnterior && document.contains(elementoAnterior)) elementoAnterior.focus();
}

function llenarCategorias(seleccionada) {
  const select = campos.categoria.input;
  select.textContent = '';
  // new Option(texto, valor) pone el texto de forma segura (como textContent)
  select.appendChild(new Option('Elegí una categoría', ''));
  for (const cat of categorias) {
    select.appendChild(new Option(cat.codigo + ' · ' + cat.nombre, cat.codigo));
  }
  select.value = seleccionada;
}

/* Al elegir la categoría sugerimos el siguiente código libre.
   Solo si el campo está vacío o tiene nuestra sugerencia anterior:
   nunca pisamos un código que escribió el encargado. */
function sugerirCodigo() {
  const letra = campos.categoria.input.value;
  const actual = campos.codigo.input.value.trim().toUpperCase();
  if (!letra || (actual !== '' && actual !== codigoSugerido)) return;
  codigoSugerido = siguienteCodigo(letra);
  campos.codigo.input.value = codigoSugerido;
}

// Busca el número más alto de esa letra, contando TAMBIÉN los dados de baja
// (sus códigos siguen ocupados), y devuelve el siguiente: A04 → A05
function siguienteCodigo(letra) {
  let mayor = 0;
  for (const p of platosActivos.concat(platosBaja)) {
    if (p.codigo[0] === letra && FORMATO_CODIGO.test(p.codigo)) {
      mayor = Math.max(mayor, Number(p.codigo.slice(1)));
    }
  }
  const siguiente = mayor + 1;
  if (siguiente > 999) return '';
  return letra + String(siguiente).padStart(2, '0');
}

// Devuelve los datos listos para mandar, o null si hay errores
function leerYValidarFormulario() {
  limpiarErrores();
  const datos = {
    categoria: campos.categoria.input.value,
    codigo: campos.codigo.input.value.trim().toUpperCase(),
    nombre: campos.nombre.input.value.trim(),
    precio: campos.precio.input.value.trim()
  };
  let hayErrores = false;
  function marcar(campo, texto) {
    if (!hayErrores) campos[campo].input.focus(); // foco en el primer campo con error
    mostrarErrorCampo(campo, texto);
    hayErrores = true;
  }

  if (!datos.categoria) {
    marcar('categoria', 'Elegí una categoría.');
  }
  if (!FORMATO_CODIGO.test(datos.codigo)) {
    marcar('codigo', 'Una letra y 2 o 3 números (ej.: A05).');
  } else if (datos.categoria && datos.codigo[0] !== datos.categoria) {
    marcar('codigo', 'Tiene que empezar con ' + datos.categoria + ', la letra de la categoría.');
  }
  if (datos.nombre.length < LARGO_MIN_NOMBRE) {
    marcar('nombre', 'Escribí el nombre del plato.');
  }
  // Solo dígitos: "9.500" o "9500,50" no pasan
  if (!/^\d+$/.test(datos.precio) || Number(datos.precio) < 1 || Number(datos.precio) > PRECIO_MAXIMO) {
    marcar('precio', 'Precio en pesos, sin centavos ni puntos (ej.: 9500).');
  }

  if (hayErrores) return null;
  datos.precio = Number(datos.precio);
  return datos;
}

async function guardar(evento) {
  evento.preventDefault(); // que el formulario no recargue la página
  if (guardando) return;

  const datos = leerYValidarFormulario();
  if (!datos) return;

  const anterior = editandoId ? platosActivos.find(p => p.id === editandoId) : null;

  guardando = true;
  btnGuardar.disabled = true;
  btnGuardar.textContent = 'Guardando...';

  try {
    if (editandoId) await editarPlato(editandoId, datos);
    else await crearPlato(datos);

    cerrarFormulario(true);
    let texto = datos.codigo + ' ' + datos.nombre + ' guardado ✔';
    if (anterior && anterior.precio !== datos.precio) {
      // Para que el encargado no se asuste: los pedidos viejos no cambian
      texto += ' Los pedidos ya hechos mantienen el precio anterior (' + formatoPesos(anterior.precio) + ').';
    }
    mostrarAviso(texto);
    await cargar(false);
  } catch (e) {
    if (esSesionVencida(e)) return;
    if (e.estado === 409) {
      // Código repetido (activo o dado de baja): el error va debajo del código
      mostrarErrorCampo('codigo', e.message);
      campos.codigo.input.focus();
    } else if (e.estado === 404) {
      cerrarFormulario(true);
      mostrarAviso('Ese plato ya no existe o fue dado de baja desde otra PC.', true);
      await cargar(false);
    } else {
      // 400, sin wifi (0) o error del servidor: no se pierde lo escrito
      errorForm.textContent = e.message;
      errorForm.hidden = false;
    }
  } finally {
    guardando = false;
    btnGuardar.disabled = false;
    btnGuardar.textContent = 'Guardar';
  }
}

function mostrarErrorCampo(campo, texto) {
  campos[campo].error.textContent = texto;
  campos[campo].error.hidden = false;
  campos[campo].input.setAttribute('aria-invalid', 'true');
}

function limpiarErrores() {
  for (const nombre in campos) {
    campos[nombre].error.textContent = '';
    campos[nombre].error.hidden = true;
    campos[nombre].input.removeAttribute('aria-invalid');
  }
  errorForm.hidden = true;
}

/* ---------- Mensajes y utilidades ---------- */

function mostrarMensaje(texto, esError) {
  mensaje.textContent = texto;
  mensaje.classList.toggle('mensaje--error', Boolean(esError));
  mensaje.hidden = !texto;
}

// idEditar: si viene, muestra el botón "Editar precio" (después de reactivar)
function mostrarAviso(texto, esError, idEditar) {
  avisoTexto.textContent = texto;
  aviso.classList.toggle('alerta--error', Boolean(esError));
  aviso.classList.toggle('alerta--info', !esError);
  platoAvisoId = idEditar || null;
  avisoEditar.hidden = !idEditar;
  aviso.hidden = false;
}

function ocultarAviso() {
  aviso.hidden = true;
  platoAvisoId = null;
}

// 401 = sesión vencida: cerramos la sesión y vamos al login
function esSesionVencida(error) {
  if (error.estado !== 401) return false;
  cerrarSesion();
  location.href = '../index.html';
  return true;
}

// Para buscar sin importar acentos ni mayúsculas: "Café" → "cafe"
function normalizar(texto) {
  return String(texto).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function coincideBusqueda(plato) {
  if (!textoBusqueda) return true;
  return normalizar(plato.codigo).includes(textoBusqueda) ||
         normalizar(plato.nombre).includes(textoBusqueda);
}