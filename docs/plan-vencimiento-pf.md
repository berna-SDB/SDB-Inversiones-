# Plan: Automatizaciones de Plazos Fijos

Dos funcionalidades nuevas para PF:
1. **Cobro al vencimiento** (diario): cuando un PF llega a `fecha_fin`, devenga intereses pendientes y lo cancela.
2. **Devengamiento mensual** (último día del mes): calcula intereses devengados de PF activos durante el mes.

---

## Funcionalidad 1 — Cobro al vencimiento

### Script
- Archivo: `src/FileCabinet/SuiteScripts/sdb_inv_vencimiento_pf_ss.js`
- Tipo: ScheduledScript (NApiVersion 2.1)
- Object: `customscript_sdb_inv_vencimiento_pf_ss` con deployment **diario** (06:00 sugerido).

### Flujo
1. Buscar PFs con: `tipo=1` (PF), `estado=1` (Activa), `fecha_fin <= hoy`, `isinactive=F`.
2. Por cada PF vencido:
   1. Calcular intereses pendientes desde `fecha_ult_calc` (o `fecha_inicio` si nunca devengó) hasta `fecha_fin`.
   2. Si > 0 → generar JE de devengamiento (DEBE Cta Int. Devengados / HABER Cta Int. Ganados) y acumular en `int_devengados`.
   3. Setear `estado = CANCELADA` vía `submitFields` → el UE existente dispara `_generarAsientoCancelacion`:
      - DEBE Banco por (capital + int_devengados).
      - HABER Activo por capital.
      - DEBE/HABER Cta Resultado por la diferencia (si la hay).
   4. Logear resultado.
3. Try/catch por inversión → guarda errores en `custrecord_sdb_inv_ultimo_error`.

### Parámetros
- `custscript_sdb_venc_cta_int_devengados` (cuenta intereses devengados)
- `custscript_sdb_venc_cta_int_ganados` (cuenta intereses ganados)

---

## Funcionalidad 2 — Devengamiento mensual

### Script
- Archivo: `src/FileCabinet/SuiteScripts/sdb_inv_devengamiento_mensual_ss.js`
- Tipo: ScheduledScript (NApiVersion 2.1)
- Object: `customscript_sdb_inv_devengamiento_mensual_ss` con deployment **último día del mes a las 23:00** (o primer día del mes siguiente a las 02:00).

### Flujo
1. Determinar fecha de corte = **último día del mes en curso** (al 23:59).
2. Buscar PFs con: `tipo=1`, `estado=1`, `isinactive=F`.
3. Por cada PF:
   1. Calcular fecha desde la cual devengar:
      - Si `fecha_ult_calc` existe → usar el día siguiente.
      - Si no → `fecha_inicio`.
   2. Calcular fecha hasta donde devengar:
      - `min(fecha_fin, fecha_corte)`.
   3. Si días > 0 y TNA > 0:
      - Intereses = `monto × (tna/100) × (días / 365 o 366)`.
      - Generar JE de devengamiento.
      - Acumular en `int_devengados`.
      - Setear `fecha_ult_calc = fecha_hasta`.
4. Try/catch por inversión → errores en `ultimo_error`.

### Parámetros
- `custscript_sdb_devm_cta_int_devengados`
- `custscript_sdb_devm_cta_int_ganados`
- `custscript_sdb_devm_forzar_fecha` (opcional, para reproceso de un mes específico)

### Reemplaza al actual
El `sdb_inv_devengamiento_ss.js` actual (que solo corre 31/12) **se desactiva** o se elimina, porque el mensual ya cubre fin de año.

---

## Edge cases comunes

| # | Caso | Decisión |
|---|---|---|
| 1 | PF sin `fecha_fin` | Vencimiento: ignorar. Devengamiento mensual: usar `fecha_corte` como tope. |
| 2 | PF sin `tna` o `monto` | Skip con warning. |
| 3 | PF sin Cta Banco / Activo | Falla → `ultimo_error`. |
| 4 | `fecha_fin == hoy` (vencimiento) | Procesar (filtro `<=`). |
| 5 | Devengamiento mensual con `fecha_fin` dentro del mes | Devengar solo hasta `fecha_fin`. El SS de vencimiento del día siguiente lo cancela. |
| 6 | Re-corrida en mismo período | Idempotente: `fecha_ult_calc` evita duplicados. |
| 7 | TNA cambia a mitad de mes | El cálculo usa la TNA actual del record. **No se versiona TNA.** |

---

## Archivos a crear/tocar

- ➕ `src/FileCabinet/SuiteScripts/sdb_inv_vencimiento_pf_ss.js`
- ➕ `src/FileCabinet/SuiteScripts/sdb_inv_devengamiento_mensual_ss.js`
- ➕ `src/Objects/Scripts/customscript_sdb_inv_vencimiento_pf_ss.xml`
- ➕ `src/Objects/Scripts/customscript_sdb_inv_devengamiento_mensual_ss.xml`
- ✏️ `src/deploy.xml` (agregar 2 nuevos scripts; opcional: quitar `customscript_sdb_inv_devengamiento_ss`)
- ❓ `src/FileCabinet/SuiteScripts/sdb_inv_devengamiento_ss.js` → eliminar o desactivar deployment

---

## Decisiones que necesito de vos

| Tema | Opciones |
|---|---|
| **Hora del SS de vencimiento** | A) 06:00, B) 02:00, C) otra |
| **Cuándo corre el devengamiento mensual** | A) último día 23:00, B) primer día 02:00 |
| **Qué hacer con `sdb_inv_devengamiento_ss.js` (31/12)** | A) eliminar, B) desactivar deployment, C) mantener como backup |
| **Cuentas contables** | ¿Usamos las mismas cuentas en los 2 scripts (parámetros separados pero apuntando al mismo) o una sola fuente? |
| **TNA en records existentes** | ¿Hay PFs activos hoy que necesiten "primer devengamiento" calculado desde su `fecha_inicio`? Si sí, primera corrida puede generar JEs grandes. |
