# Relaciones y decisiones del modelo

## Tablas compartidas

`rest_comanda` es una única tabla. El módulo de restaurante crea comandas; el módulo de caja consulta y cobra esas mismas comandas. No se crea una segunda `rest_comanda`.

## Relaciones principales

- `rest_categoria (1) -> (N) rest_item_menu`
- `rest_mesa (1) -> (N) rest_comanda`
- `usuario (1) -> (N) rest_comanda` mediante `id_mozo`
- `rest_comanda (1) -> (N) rest_pedido`
- `rest_pedido (1) -> (N) rest_pedido_item`
- `rest_item_menu (1) -> (N) rest_pedido_item`
- `rest_turno_caja (1) -> (N) rest_cobro`
- `rest_comanda (1) -> (N) rest_cobro`
- `rest_cobro (1) -> (N) rest_cobro_pago`
- `rest_turno_caja (1) -> (N) rest_movimiento_caja`
- `huesped (1) -> (N) estadia`
- `estadia (1) -> (N) rest_cargo_habitacion`
- `rest_cobro_pago (1) -> (N) rest_cargo_habitacion` según el diagrama recibido.

## Criterios

- Precios históricos de un pedido se copian a `rest_pedido_item.precio_unitario`; cambiar el precio del menú no altera pedidos previos.
- `rest_comanda.total` se recalcula al registrar pedidos.
- Anulación de ítems conserva el registro y motivo.
- Los estados se almacenan como VARCHAR para permitir acordar el vocabulario con el frontend sin alterar el esquema.
- Las claves se mantienen InnoDB y las tablas usan `utf8mb4`.
- La relación de cargo a habitación con `rest_cobro_pago` se conservó tal como figura en el dibujo; confirmar semántica con el equipo funcional.
