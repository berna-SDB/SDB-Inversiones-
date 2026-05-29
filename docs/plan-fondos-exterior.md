# Plan – Estructura de Fondos del Exterior

**Fecha:** 2026-05-19
**Estado:** Diseño aprobado por usuario, pendiente plan de implementación

## Contexto

Hoy en `customrecord_sdb_inv_exterior` sólo hay `cuenta_comitente` (texto), `subtipo` (lista placeholder "Exterior 1/2/3") y un link al maestro. No alcanza para llevar el detalle real que armaron en
`docs/Documento de inversiones exterior/Detalle de instrumentos.xlsx`.

El Excel mantiene un detalle mensual con cuatro brokers (Pictet, JP Morgan, Santander, IOR), múltiples cuentas comitente por broker, dos clases de líneas (instrumentos y cash) y multi-moneda (USD, EUR, GBP, CAD, JPY).

## Flujo operativo (clave)

El equipo **no registra** cada compra/venta/dividendo individual. El flujo real es:

1. Llega el extracto del broker al cierre del período.
2. Abren un **Suitelet de carga** que muestra el estado actual de cada cuenta comitente: instrumentos y cash con su último valor.
3. En el Suitelet:
   - **Actualizan** el valor de un instrumento/cash existente (cambio de cotización + cualquier movimiento del período).
   - **Dan de alta** un instrumento o cash nuevo (compra inicial, transferencia entrante).
   - **Dan de baja** un instrumento o cash (venta total, cierre de cuenta).
4. Al confirmar, el Suitelet:
   - Hace upsert (alta/update/baja) sobre los custom records.
   - Genera un **Journal Entry único** del cierre con todas las contrapartidas.

No se guarda histórico de snapshots por mes — la historia queda en los Journal Entries.

## Decisiones de diseño

| Decisión | Resultado |
|---|---|
| Granularidad | Un record por instrumento / por cash, se actualiza |
| Relación con `customrecord_sdb_inv_maestro` | **Estructura paralela** — no toca el maestro |
| Taxonomía Tipo/Subtipo | Única normalizada |
| Entidad | Reutilizar `customrecord_sdb_inv_inst_financiera` con tipo=Exterior |
| Cuenta comitente | Record propio, hijo de `inst_financiera` |
| Unicidad del catálogo | Por cuenta (Apple-Pictet ≠ Apple-IOR) |
| Multi-moneda | Original + funcional. TC desde `customrecord_sdb_inv_cotizaciones` |
| Cash | Record propio (uno por moneda dentro de cada cuenta comitente) |
| Cuenta de resultado | Configurable por **tipo de instrumento** (RF, RV, Alternativos, etc.) |
| Contrapartida del JE | Update de valor → cuenta de resultado del tipo. Alta/Baja → cash de la misma cuenta comitente |

## Arquitectura

```
customrecord_sdb_inv_inst_financiera                  (existente, tipo=Exterior)
  └─ customrecord_sdb_inv_ext_cuenta_comitente        (nuevo)
        ├─ customrecord_sdb_inv_ext_instrumento      (reemplaza al actual customrecord_sdb_inv_exterior)
        └─ customrecord_sdb_inv_ext_cash             (nuevo — uno por moneda)

customrecord_sdb_inv_ext_tipo                          (nuevo — categoría + cuenta de resultado)
customlist_sdb_inv_ext_subtipo                         (nuevo)
```

## Custom records

### `customrecord_sdb_inv_ext_cuenta_comitente` – Cuenta del comitente

| Campo | Tipo | Mand. | Notas |
|---|---|---|---|
| `name` | text | T | Auto "{Entidad} – {Número}" |
| `custrecord_sdb_extcc_inst_financiera` | select → `inst_financiera` | T | Filtrar por tipo=Exterior |
| `custrecord_sdb_extcc_numero` | text(50) | T | Ej 1415600, 7117004, MIX 30 USD 101226 |
| `custrecord_sdb_extcc_moneda` | select moneda | T | Moneda principal |
| `custrecord_sdb_extcc_descripcion` | textarea | F | |
| `isinactive` | checkbox | F | |

### `customrecord_sdb_inv_ext_tipo` – Tipo de instrumento

Es record (no list) porque cada tipo configura la cuenta de resultado contra la que se asienta la diferencia.

| Campo | Tipo | Mand. | Notas |
|---|---|---|---|
| `name` | text | T | Cash, Money Market, Renta Fija, Renta Variable, Alternativos |
| `custrecord_sdb_exttipo_cta_resultado` | select account | T | Cuenta de resultado por tenencia para este tipo |
| `isinactive` | checkbox | F | |

### `customrecord_sdb_inv_ext_instrumento` – Instrumento (reemplaza `customrecord_sdb_inv_exterior`)

| Campo | Tipo | Mand. | Notas |
|---|---|---|---|
| `name` | text | T | Nombre comercial — ej. "BLACKROCK USD HY BD" |
| `custrecord_sdb_extinst_cta_comitente` | select → `ext_cuenta_comitente` | T | Define entidad indirectamente |
| `custrecord_sdb_extinst_isin` | text(50) | F | ISIN / ticker / código broker |
| `custrecord_sdb_extinst_tipo` | select → `ext_tipo` | T | Define cuenta de resultado |
| `custrecord_sdb_extinst_subtipo` | select `customlist_ext_subtipo` | F | |
| `custrecord_sdb_extinst_moneda` | select moneda | T | |
| `custrecord_sdb_extinst_cuenta_contable` | select account | T | Cuenta de Inversiones donde vive el instrumento |
| `custrecord_sdb_extinst_cantidad` | decimal | F | Cantidad actual (nominal/acciones) |
| `custrecord_sdb_extinst_valor_actual` | currency | T | Valor de cierre actualizado en cada carga |
| `custrecord_sdb_extinst_fecha_actual` | date | T | Fecha del último valor |
| `custrecord_sdb_extinst_tipo_cambio` | decimal | F | TC al `fecha_actual` |
| `custrecord_sdb_extinst_valor_funcional` | currency | F | `valor_actual` × `tipo_cambio` |
| `custrecord_sdb_extinst_descripcion` | textarea | F | |
| `isinactive` | checkbox | F | Se marca cuando se da de baja |

### `customrecord_sdb_inv_ext_cash` – Cash de la cuenta comitente

Un record por (cuenta comitente, moneda). Ej. JP Morgan cuenta 1415600 tiene tres `ext_cash`: USD, EUR, LIBRA.

| Campo | Tipo | Mand. | Notas |
|---|---|---|---|
| `name` | text | T | Auto "{Cta. Comitente} – {Moneda}" |
| `custrecord_sdb_extcash_cta_comitente` | select → `ext_cuenta_comitente` | T | |
| `custrecord_sdb_extcash_moneda` | select moneda | T | |
| `custrecord_sdb_extcash_cuenta_contable` | select account | T | Cuenta NS de bancos del exterior |
| `custrecord_sdb_extcash_saldo_actual` | currency | T | Saldo cierre actualizado |
| `custrecord_sdb_extcash_fecha_actual` | date | T | |
| `custrecord_sdb_extcash_tipo_cambio` | decimal | F | |
| `custrecord_sdb_extcash_saldo_funcional` | currency | F | |
| `isinactive` | checkbox | F | |

## Custom lists

### `customlist_sdb_inv_ext_subtipo`
Bono soberano, Bono corporativo, Acción, ETF, Fondo, Estructurado, Opción, Commodity, Money Market, Otros

## Suitelet de carga (núcleo del flujo)

**Script ID sugerido:** `sdb_inv_ext_carga_sl.js`

**UI:** página con selector de Cuenta Comitente arriba, debajo dos grids:

1. **Cash** — filas: una por moneda existente. Columnas: Moneda · Cuenta contable · Saldo actual · **Saldo nuevo** · Fecha · TC · [Dar de baja].
2. **Instrumentos** — filas: una por instrumento activo. Columnas: Nombre · ISIN · Tipo · Subtipo · Moneda · Cuenta · Cantidad actual · **Cantidad nueva** · Valor actual · **Valor nuevo** · Fecha · TC · [Dar de baja].

Botones: `+ Agregar cash` / `+ Agregar instrumento` (alta), `Confirmar cierre`.

### Lógica al confirmar

Para cada línea modificada se determina la operación:

| Operación | Detección | Acción sobre el record | Línea(s) del JE |
|---|---|---|---|
| **Update de valor** | Mismo record, valor_nuevo ≠ valor_actual | Actualizar `valor_actual`/`saldo_actual` y fecha | D/H Cuenta contable del instrumento o cash × diferencia; contrapartida = `ext_tipo.cuenta_resultado` (para instrumentos) o cuenta de resultado configurable para diferencia de cambio (para cash) |
| **Alta** | Línea nueva | Crear record con valor inicial | D Cuenta contable del instrumento/cash × valor inicial; contrapartida = `ext_cash` de la cuenta comitente en moneda funcional (o moneda original si existe). Si no hay cash en esa moneda, queda pendiente y se marca para revisión |
| **Baja** | Marcaron checkbox de baja | Setear `isinactive=T`, dejar valor en 0 | H Cuenta contable del instrumento/cash × valor anterior; contrapartida = `ext_cash` de la cuenta comitente |

El JE se crea con `subsidiary` y `currency` apropiados, y un memo identificando cierre + cuenta comitente.

**Nota sobre alta vs revaluación:** si una compra y una suba de cotización suceden en el mismo período, el cliente debe primero dar de alta el instrumento por el valor de compra y después actualizar el valor a cierre. El Suitelet permite ambas acciones en la misma sesión y genera líneas separadas en el JE. Si esto no alcanza, ya hay base para iterar al agregar campos "monto comprado" / "monto vendido" en cada línea.

## Scripts / automatizaciones complementarias

- **Client Script** en `ext_instrumento` y `ext_cash`: al elegir cuenta comitente, sourcear moneda y cuenta contable por default; calcular `valor_funcional` cuando entra valor + TC.
- **User Event (Before Submit)** en ambos records: si `tipo_cambio` está vacío, buscar en `customrecord_sdb_inv_cotizaciones` por (moneda, fecha) y calcular `valor_funcional`.
- **Saved Searches** que repliquen la vista del Excel: pivot por Entidad / Cuenta Comitente / Tipo / Subtipo / Instrumento, totales por moneda y por funcional.

## Migración

- `customrecord_sdb_inv_exterior` se reemplaza por `customrecord_sdb_inv_ext_instrumento`. Datos cargados (si los hay) se migran manualmente — la lista de subtipos era placeholder, asumimos que no se usó.
- `customlist_sdb_inv_subtipo_exterior` se elimina.
- `custform_sdb_inv_exterior` se elimina o se reusa para el nuevo instrumento.
- Carga inicial del catálogo a partir del Excel `Detalle de instrumentos.xlsx`: script o CSV Import nativo. Definir en plan de implementación.

## Fuera de alcance

- Diferenciar dentro de un mismo update qué parte de la variación fue por movimiento de capital vs revaluación. Iteración futura.
- Integración con `customrecord_sdb_inv_maestro` (devengamiento, revaluación PF, vencimiento). El exterior es paralelo.
- Carga automática desde APIs de brokers.
- Reportes regulatorios o impositivos sobre el exterior.
