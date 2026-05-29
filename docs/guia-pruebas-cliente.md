# Guía de Pruebas — Módulo de Inversiones

Guía para probar el módulo de Inversiones en sandbox **UCA-QA**.

---

## Mapa rápido del menú

Todo se accede desde la pestaña **Inversiones Overview** del menú principal:

```
Inversiones Overview
├── Listados
│   ├── Lista de Inversiones        ← ver, buscar, editar, eliminar
│   ├── Nueva Inv. Exterior         ← cargar inversión exterior
│   ├── Nueva Inv. Plazo Fijo       ← constituir un PF
│   └── Nueva Inv. FCI / Títulos    ← comprar/rescatar/revaluar FCI o bono
├── Operaciones
│   ├── Revaluación de Cuotaparte   ← actualizar cotización de mercado
│   ├── Revaluación de Moneda       ← actualizar TC sobre fondos USD
│   └── Devengar Intereses PF       ← calcular, devengar o cobrar intereses de PFs
└── Configuraciones
    └── Instituciones Financieras   ← ver/editar bancos y cuentas asociadas
```

---

## 1. FCI (Fondo Común de Inversión)

### 1.1 Comprar cuotapartes de un FCI

**Caso**: Comprar 1.000 cuotapartes del Fondo Galicia Pesos a $80,50 c/u

**Ruta**: **Inversiones Overview > Listados > Nueva Inv. FCI / Títulos**

**Datos a cargar**:
| Campo | Valor |
|---|---|
| Nombre | "Prueba FCI Galicia ARS" |
| Subsidiaria | UCA: Fundación... |
| Tipo Instrumento | Fondo de Inversión |
| Institución | Galicia |
| Moneda | Peso Argentino |
| Contrato / Referencia | (lo que quiera) |
| **Tipo de Operación** | **Compra** |
| Fecha de Operación | (la de hoy) |
| Monto a Comprar | 80.500 |
| Cotización de Compra | 80,50 |

**Al guardar**:
- Las cuotapartes se calculan solas: 80.500 / 80,50 = **1.000**
- Las cuentas contables se sourcean automáticamente desde Galicia (Cta Banco, Cta Activo)
- Se crea un **Journal Entry** automáticamente:
  ```
  D  112.41.02  Fondo Galicia Pesos    80.500
       H  111.21.04  Banco Galicia       80.500
  ```

**Verificar**:
- Grupo "Montos": Cotización Actual / Monto Actual con valores calculados
- Tab "Transacciones" (al pie de la inversión): aparece el JE creado
- Memo del JE: "[COMPRA] Fondo de Inversión | Galicia | ..."

---

### 1.2 Suscribir más cuotapartes (compra adicional)

**Caso**: Sumar 500 cuotapartes a $81,50 c/u a la inversión anterior

**Ruta**: **Inversiones Overview > Listados > Lista de Inversiones** → abrir la inversión → **Editar**

**Cambios**:
| Campo | Valor |
|---|---|
| Tipo de Operación | Compra |
| Fecha de Operación | (fecha posterior) |
| Monto a Comprar | 40.750 |
| Cotización de Compra | 81,50 |

**Al guardar**:
- Cuotapartes pasa de 1.000 a **1.500** (suma)
- Monto Inicial pasa de 80.500 a **121.250** (suma)
- Se crea otro JE con memo "[COMPRA] ... (adicional)"

---

### 1.3 Rescatar cuotapartes (parcial)

**Caso**: Rescatar 500 cuotapartes a cotización 82,00 (recibís 41.000)

**Ruta**: **Inversiones Overview > Listados > Lista de Inversiones** → abrir la inversión → **Editar**

**Cambios**:
| Campo | Valor |
|---|---|
| Tipo de Operación | Rescate |
| Fecha de Rescate | (la de hoy) |
| Cuotapartes a Rescatar | 500 |
| **Cotización del Rescate** | **82,00** |

**Al guardar**:
- JE: D Banco / H Activo por 41.000
- Cuotapartes pasa de 1.500 a **1.000**
- Estado cambia a **"Rescatada Parcial"**
- Los campos de la operación se limpian para la siguiente

---

### 1.4 Revaluar la cotización (ganancia/pérdida no realizada)

**Caso**: La cotización del fondo subió a 85,00 — asentar la diferencia

**Ruta**: **Inversiones Overview > Operaciones > Revaluación de Cuotaparte**

**Pasos**:
1. En la fila de la inversión, completá:
   - **Nueva Cotización**: 85,00
   - **Fecha Reval**: (la de hoy)
2. Marcá el checkbox de la inversión
3. Click **Revaluar**

**Resultado**:
- JE en la moneda del fondo: D Activo / H Ganancia
- Para 1.000 cuotap × (85 − 82) = **3.000 ARS** de ganancia
- En el record: `Cotización Actual` y `Valor Cuota Inicial` se actualizan a 85,00

---

### 1.5 Revaluar TC (solo aplica a FCI en USD)

**Caso**: Fondo USD. La cotización en USD no cambió, pero el TC pasó de 1.000 a 1.150. Asentar la diferencia.

**Pre-requisito**: tener una inversión FCI en USD (repetir paso 1.1 con moneda USD)

**Ruta**: **Inversiones Overview > Operaciones > Revaluación de Moneda**

**Pasos**:
1. **Fecha de Revaluación**: (la de hoy)
2. **Tipo de Cambio (override)**: 1.150 (o dejarlo vacío para que tome el del sistema)
3. Marcar el checkbox de la inversión USD
4. Click **Revaluar Moneda**

**Resultado**:
- JE **en ARS**: D Activo (Fondo USD) / H Diferencia de Cambio por la diferencia ARS
- En el record: `Monto en Pesos` se actualiza al nuevo valor al TC nuevo

---

## 2. Plazo Fijo

### 2.1 Constituir un Plazo Fijo

**Caso**: PF de 1.000.000 ARS en Galicia a 30 días, TNA 80%

**Ruta**: **Inversiones Overview > Listados > Nueva Inv. Plazo Fijo**

**Datos**:
| Campo | Valor |
|---|---|
| Nombre | "Prueba PF Galicia 30d" |
| Subsidiaria | UCA |
| Tipo Instrumento | Plazo Fijo |
| Institución | Galicia |
| Moneda | Peso Argentino |
| Monto Inicial | 1.000.000 |
| Fecha de Inicio | (hoy) |
| Fecha de Finalización | (hoy + 30 días) |
| TNA | 80 |
| Plazo de Inversión | Corto Plazo |
| Estado | Activa |

**Al guardar**:
- Las cuentas se sourcean automáticamente (Cta Activo PF = 112.21.03, Banco = 111.21.04)
- Se crea JE de constitución:
  ```
  D  112.21.03  Plazo Fijo Galicia Pesos    1.000.000
       H  111.21.04  Banco Galicia c/c       1.000.000
  ```

---

### 2.2 Calcular, Devengar o Cobrar intereses

**Ruta**: **Inversiones Overview > Operaciones > Devengar Intereses PF**

**Datos del formulario**:
- **Acción**:
  - `Calcular` → **previsualiza** intereses a devengar, NO asienta nada (útil para revisar antes)
  - `Devengar` → calcula + **crea JE** D Int. Devengados / H Int. Ganados + actualiza la inversión
  - `Cobrar Intereses Devengados` → **crea JE** D Banco / H Int. Devengados + mueve `Int. Devengados → Int. Cobrados` (deja devengados en 0)
- **Fecha de Corte**: por default el último día del mes (se puede cambiar)

**Pasos**:
1. Tildá los PFs a procesar
   - 🟥 Filas rojas = PFs vencidos
   - 🟨 Filas amarillas = vencen en ≤ 7 días
2. Elegí la acción
3. Click **Ejecutar**

**Resultado de Calcular**:
- Tabla con cada PF: período (desde → hasta), días, intereses calculados, moneda
- **Total general** de intereses al final
- **No** crea JEs ni toca registros — es una simulación

**Resultado de Devengar**:
- Para cada PF: JE con D Cta Int. Devengados / H Cta Int. Ganados
- Actualiza `Intereses Devengados` (acumulado) y `Fecha último cálculo`
- Link al JE generado en la tabla de resultado

**Resultado de Cobrar Intereses Devengados**:
- Para cada PF: JE con D Cta Banco / H Cta Int. Devengados por el total acumulado
- El campo `Intereses Devengados` queda en 0
- El campo `Intereses Cobrados` se incrementa por ese monto
- Se usa cuando el PF paga intereses periódicamente (sin cancelar el PF)
- Si el PF no tiene intereses devengados, se omite con el mensaje "no hay intereses devengados"

---

### 2.3 Cancelar un Plazo Fijo

**Caso**: Cancelar el PF al vencimiento (cobrar capital + intereses)

**Ruta**: **Inversiones Overview > Listados > Lista de Inversiones** → abrir el PF → **Editar**

**Cambio**:
- Estado: **"Cancelada"**

**Al guardar**:
- JE de cancelación:
  - D Banco (capital + intereses)
  - H Activo PF (capital original)
  - H Intereses Devengados (los que ya están asentados)
  - Opcional: línea de Resultado por la diferencia
- Mueve los intereses devengados a cobrados

**Nota**: si el PF venció pero no se canceló manualmente, el sistema lo cancela automáticamente al día siguiente del vencimiento.

---

## 3. Inversiones del Exterior

### 3.1 Cargar un movimiento del Exterior

**Caso**: Registrar saldos mensuales de cartera PICTET o JP Morgan

**Ruta**: **Inversiones Overview > Listados > Nueva Inv. Exterior**

**Datos del form** (vista limpia con 12 campos):

| Campo | Ejemplo |
|---|---|
| Nombre | "PICTET - Bonos Mayo 2025" |
| Fecha del Movimiento | 31/05/2025 |
| Entidad | PICTET (o JP Morgan) |
| Tipo | Exterior |
| Subtipo | (el que aplique) |
| Instrumento (ISIN) | LU2008207461 |
| Moneda | Dólar Estadounidense |
| Cantidad | 100 |
| Saldo Inicial | 200.000 |
| Saldo Final | 215.000 |
| Cuenta | 5600 (cuenta JP Morgan) |
| Observaciones | "Variación por valuación mensual" |
| Mes (Período) | 31/05/2025 |

**Verificar**: Solo aparecen esos 12 campos en el form Exterior (resto oculto).

**Nota**: Las inversiones de Exterior **no generan JE automático** — son carga manual para histórico/seguimiento. Si se necesita asentar contablemente, se hace JE aparte.

---

## 4. Listados rápidos

### 4.1 Ver todas las inversiones
**Inversiones Overview > Listados > Lista de Inversiones**

### 4.2 Ver instituciones financieras y sus cuentas
**Inversiones Overview > Configuraciones > Instituciones Financieras**

### 4.3 Dashboard general
**Inversiones Overview** (click directo en la pestaña)

---

## 5. Casos límite a probar

| # | Caso | Esperado |
|---|---|---|
| 1 | Rescate de más cuotapartes de las que hay | Error: "Rescate: las cuotapartes a rescatar (X) exceden las disponibles (Y)" |
| 2 | Rescate sin completar Cotización del Rescate | Error: "Rescate: informá la Cotización de Rescate" |
| 3 | Crear PF sin TNA | El devengamiento lo omite (sin error) |
| 4 | Inversión USD sin Tipo de Cambio cargado | El TC se completa automáticamente desde el sistema |
| 5 | Borrar una inversión con JEs asociados | Los JEs vinculados se eliminan junto con la inversión |

---

## 6. Si algo falla

- Si una operación falla, abrí la inversión y mirá en el detalle si aparece un mensaje de error
- Reportá al equipo SDB con:
  - **ID de la inversión** (visible en la URL o en el listado)
  - **Acción que intentaste** (compra / rescate / revaluación / devengamiento / cancelación)
  - **Captura de pantalla** del error o del estado del registro
  - **Fecha y hora** aproximada
