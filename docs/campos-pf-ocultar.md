# Campos a ocultar en formulario de Plazo Fijo

Marcá con `[x]` los campos que querés **ocultar** cuando el tipo es Plazo Fijo.

---

## Ya ocultos en PF (re-mostrar si tildás)

Si querés que ALGUNO de estos vuelva a aparecer en PF, tildalo:

- [ ] `custrecord_sdb_inv_cuotapartes` — Cuotapartes
- [ ] `custrecord_sdb_inv_valor_cuota_ini` — Valor Cuota Inicial
- [ ] `custrecord_sdb_inv_monto_actual` — Monto Actual
- [ ] `custrecord_sdb_inv_cuotapartes_rescate` — Cuotapartes a Rescatar
- [ ] `custrecord_sdb_inv_subtipo_fci` — Subtipo FCI
- [ ] `custrecord_sdb_inv_cuenta_comitente` — Cuenta Comitente / Títulos
- [ ] `custrecord_sdb_inv_cantidad_titulos` — Cantidad de Títulos
- [ ] `custrecord_sdb_inv_cotizacion_titulo` — Cotización Título
- [ ] `custrecord_sdb_inv_isin` — ISIN
- [ ] `custrecord_sdb_inv_subtipo_rv` — Subtipo RV

---

## Específicos de PF (deberían quedarse — tildá si querés ocultarlos igual)

- [ ] `custrecord_sdb_inv_tna` — TNA
- [ ] `custrecord_sdb_inv_dias` — Días
- [ ] `custrecord_sdb_inv_subtipo_pf` — Subtipo PF
- [ ] `custrecord_sdb_inv_cuenta_inversora` — Cuenta Inversora
- [ ] `custrecord_sdb_inv_cta_intereses` — Cuenta Contable Intereses
- [ ] `custrecord_sdb_inv_int_devengados` — Intereses Devengados
- [ ] `custrecord_sdb_inv_int_cobrados` — Intereses Cobrados

---

## Siempre visibles (candidatos a ocultar en PF)

### Identificación / clasificación
- [ ] `custrecord_sdb_inv_subsidiaria` — Subsidiaria
- [ ] `custrecord_sdb_inv_moneda` — Moneda
- [ ] `custrecord_sdb_inv_institucion` — Institución Financiera
- [ ] `custrecord_sdb_inv_tipo` — Tipo de Instrumento
- [ ] `custrecord_sdb_inv_plazo` — Plazo de Inversión
- [ ] `custrecord_sdb_inv_contrato` — Número de Contrato / Referencia
- [ ] `custrecord_sdb_inv_responsable` — Responsable Interno
- [ ] `custrecord_sdb_inv_notas` — Notas / Comentarios

### Montos / valores
- [ ] `custrecord_sdb_inv_monto` — Monto Inicial
- [ x] `custrecord_sdb_inv_valor_actual` — Valor / Cotización Actual
- [ ] `custrecord_sdb_inv_costos` — Costos / Comisiones

### Fechas / estado
- [ ] `custrecord_sdb_inv_fecha_inicio` — Fecha de Inicio
- [ ] `custrecord_sdb_inv_fecha_fin` — Fecha de Finalización
- [x ] `custrecord_sdb_inv_periodicidad` — Periodicidad de Pago
- [ ] `custrecord_sdb_inv_estado` — Estado
- [x ] `custrecord_sdb_inv_prox_venc` — Próxima Fecha de Vencimiento
- [x ] `custrecord_sdb_inv_fecha_ult_calc` — Fecha Último Cálculo

### Rentabilidad
- [ x] `custrecord_sdb_inv_rent_esperada` — Rentabilidad Esperada (%)
- [ x] `custrecord_sdb_inv_rent_realizada` — Rentabilidad Realizada (%)

### Cuentas contables
- [ ] `custrecord_sdb_inv_cta_activo` — Cuenta Contable Activo
- [ ] `custrecord_sdb_inv_cta_resultado` — Cuenta Contable Resultado
- [ ] `custrecord_sdb_inv_cta_dif_cambio` — Dif. de Cuota Revaluación
- [ ] `custrecord_sdb_inv_cta_banco` — Cuenta Contable Banco
- [ ] `custrecord_sdb_inv_cta_comisiones` — Cuenta Contable Comisiones

### Operación: Compra
- [ x] `custrecord_sdb_inv_tipo_operacion` — Tipo de Operación
- [x ] `custrecord_sdb_inv_fecha_compra` — Fecha de Compra
- [x ] `custrecord_sdb_inv_monto_compra` — Monto a Comprar
- [x ] `custrecord_sdb_inv_cuotapartes_compra` — Cuotapartes a Comprar
- [x ] `custrecord_sdb_inv_cotizacion_compra` — Cotización de Compra
- [x ] `custrecord_sdb_inv_costos_compra` — Costos de Compra

### Operación: Rescate
- [x ] `custrecord_sdb_inv_monto_rescate` — Monto a Rescatar
- [x ] `custrecord_sdb_inv_valor_cuota_rescate` — Cotización del Rescate

### Diagnóstico
- [x ] `custrecord_sdb_inv_ultimo_error` — Último Error
