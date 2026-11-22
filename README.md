# Backend – Hostería Municipal

API REST en JavaScript (Node.js + Express) con MariaDB. La base se administra con HeidiSQL y puede ejecutarse localmente con el servicio MySQL/MariaDB de XAMPP. No utiliza PHP.

## Decisiones de diseño

- Se crea **una sola base de datos** llamada `hosteria`.
- `rest_comanda` existe **una sola vez** y es compartida por pedidos y cobros.
- Las tablas de comandas/restaurante y las de caja/hospedaje son módulos de la misma base, no bases separadas.
- El backend llama procedimientos almacenados (`CALL sp_...`) mediante `mysql2`; las consultas de negocio no se escriben directamente en los controladores.
- Se usan claves foráneas, índices, restricciones, transacciones en operaciones compuestas y borrado lógico cuando corresponde.
- Las contraseñas se guardan con hash bcrypt. No se incluye un usuario administrador con contraseña conocida.

## Requisitos

- Node.js 20 o superior y npm.
- XAMPP con MySQL/MariaDB iniciado (puerto habitual 3306).
- HeidiSQL (opcional, recomendado para importar y revisar SQL).

> En XAMPP, el módulo se llama habitualmente **MySQL**, aunque las versiones actuales suelen distribuir MariaDB. Comprobá el motor y puerto real en tu instalación.

## 1. Crear la base de datos

1. Iniciá MySQL desde XAMPP.
2. Abrí HeidiSQL y conectate al servidor local (normalmente `127.0.0.1`, puerto `3306`, usuario `root`).
3. Abrí y ejecutá `database/00_schema.sql`.
4. Luego ejecutá `database/10_procedures.sql`.
5. Finalmente ejecutá `database/20_seed.sql`.

Los scripts son reejecutables en una instalación nueva. `00_schema.sql` elimina y vuelve a crear la base `hosteria`: **no lo ejecutes sobre una base que ya tenga datos que quieras conservar**.

## 2. Configurar backend

Desde la carpeta `backend`:

```bash
npm install
```

Copiá `.env.example` como `.env` y ajustá host, puerto, usuario, contraseña y nombre de la base. Cambiá obligatoriamente `JWT_SECRET` por una cadena aleatoria larga (mínimo 32 caracteres).

## 3. Crear el primer usuario administrador

No se crea una contraseña por defecto. Con el servidor iniciado, usá el endpoint protegido de configuración inicial solo cuando no existan usuarios:

`POST /api/setup/admin`

```json
{
  "nombre": "Administrador",
  "usuario": "admin",
  "clave": "UnaClaveSegura123!"
}
```

Este endpoint deja de estar disponible cuando ya existe al menos un usuario. Después iniciá sesión en `POST /api/auth/login` y enviá el token como `Authorization: Bearer TOKEN`.

## 4. Ejecutar

```bash
npm run dev
```

- Estado: `http://localhost:3000/api/health`
- Swagger: `http://localhost:3000/api-docs`

## Módulos incluidos

- Seguridad: usuarios, roles, login, auditoría.
- Restaurante: categorías, menú, mesas, comandas, pedidos e ítems de pedido.
- Caja: turnos, códigos, cobros, formas de pago y movimientos.
- Hospedaje: huéspedes, estadías y cargos a habitación.
- Configuración general.

## Endpoints principales

Swagger es la referencia completa. Los endpoints están bajo `/api`:

- `POST /auth/login`
- `GET/POST /categorias`
- `GET/POST /menu`
- `GET/POST /mesas`
- `POST /comandas`, `GET /comandas/abiertas`
- `POST /comandas/:id/pedidos`
- `POST /pedidos/:id/enviar`, `POST /pedidos/:id/listo`
- `POST /comandas/:id/cobros`
- `POST /caja/turnos/apertura`, `POST /caja/turnos/:id/cierre`
- `GET/POST /huespedes`, `GET/POST /estadias`

## Notas que deben confirmarse con el equipo

El código respeta los campos visibles en los diagramas compartidos y completa restricciones técnicas necesarias. Antes de producción, confirmar con el responsable funcional:

1. Si `rest_pedido.uid` debe ser único globalmente o por origen.
2. Los valores válidos de `origen`, `estado`, `forma` y `tipo` (se manejan como texto para no limitar integraciones).
3. Si `rest_cargo_habitacion.id_cobro_pago` representa realmente el pago asociado al cargo; así aparece en el diagrama recibido y se conservó.
4. Si los roles se limitan a un rol por usuario/sistema. El diagrama muestra `usuario_rol` con clave compuesta `(id_usuario, sistema)`.
5. Reglas operativas de apertura/cierre de mesas, comandas y caja.

No se deben cambiar nombres o contratos de API sin coordinarlo con los compañeros del frontend. Este paquete es una base inicial integrada, no reemplaza las pruebas de aceptación ni una revisión con el esquema SQL original completo.

## Contenido del paquete entregado

- 18 tablas en un único esquema `hosteria`.
- 24 procedimientos almacenados declarados en `database/10_procedures.sql`.
- `rest_comanda` está definida una sola vez.
- Endpoints documentados en Swagger/OpenAPI para los flujos implementados.
- Auditoría best-effort para las principales operaciones de escritura.

## Pruebas manuales sugeridas

1. `GET /api/health` sin autenticación.
2. `POST /api/auth/setup/admin` para crear el primer administrador.
3. `POST /api/auth/login` para obtener JWT.
4. En Swagger, pulsar **Authorize** y pegar el token sin escribir `Bearer ` (Swagger lo agrega).
5. Crear categoría, artículo y mesa.
6. Abrir comanda, registrar pedido y consultar su detalle.
7. Abrir caja y registrar el cobro de una comanda.
8. Registrar huésped y estadía.

Los ejemplos de datos deben adaptarse a los IDs que devuelva MariaDB en cada instalación.
