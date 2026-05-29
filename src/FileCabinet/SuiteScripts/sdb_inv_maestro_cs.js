/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 */
define(['N/search', 'N/format'], (search, format) => {

    const FIELD_TIPO_OPERACION = 'custrecord_sdb_inv_tipo_operacion';
    const FIELD_TIPO_INSTRUMENTO = 'custrecord_sdb_inv_tipo';
    const FIELD_MONTO_COMPRA = 'custrecord_sdb_inv_monto_compra';
    const FIELD_COTIZ_COMPRA = 'custrecord_sdb_inv_cotizacion_compra';
    const FIELD_CUOTAP_COMPRA = 'custrecord_sdb_inv_cuotapartes_compra';
    const FIELD_CUOTAP_RESCATE = 'custrecord_sdb_inv_cuotapartes_rescate';
    const FIELD_MONTO_RESCATE = 'custrecord_sdb_inv_monto_rescate';
    const FIELD_VALOR_CUOTA_RESCATE = 'custrecord_sdb_inv_valor_cuota_rescate';
    const FIELD_VALOR_ACTUAL = 'custrecord_sdb_inv_valor_actual';
    const FIELD_FECHA_INICIO = 'custrecord_sdb_inv_fecha_inicio';
    const FIELD_FECHA_FIN = 'custrecord_sdb_inv_fecha_fin';
    const FIELD_DIAS = 'custrecord_sdb_inv_dias';
    const FIELD_INSTITUCION = 'custrecord_sdb_inv_institucion';
    const FIELD_CTA_BANCO = 'custrecord_sdb_inv_cta_banco';
    const FIELD_CTA_ACTIVO = 'custrecord_sdb_inv_cta_activo';
    const FIELD_CTA_RESULTADO = 'custrecord_sdb_inv_cta_resultado';
    const FIELD_CTA_COMISIONES = 'custrecord_sdb_inv_cta_comisiones';
    const FIELD_MONEDA = 'custrecord_sdb_inv_moneda';
    const FIELD_FECHA_COMPRA = 'custrecord_sdb_inv_fecha_compra';
    const FIELD_FECHA_RESCATE = 'custrecord_sdb_inv_fecha_rescate';
    const FIELD_TIPO_CAMBIO = 'custrecord_sdb_inv_tipo_cambio';
    const TIPO_PLAZO_FIJO = '1';
    const BASE_CURRENCY_ID = '1'; // ARS (base subsidiary)
    const USD_CURRENCY_ID = '2'; // USD — el maestro (PF/FCI/Bonos local) solo opera en ARS y USD

    // Campos que se ocultan cuando tipo_instrumento = Plazo Fijo
    const FIELDS_HIDE_IN_PF = [
        'custrecord_sdb_inv_subtipo_fci',
        'custrecord_sdb_inv_cuenta_comitente',
        'custrecord_sdb_inv_isin',
        'custrecord_sdb_inv_subtipo_exterior',
        'custrecord_sdb_inv_subtipo_pf'
    ];

    // Snapshot de cuotapartes originales para validar el rescate al guardar
    let _cuotapartesOriginales = 0;

    const CAMPOS_COMPRA_REQUERIDOS = [
        'custrecord_sdb_inv_monto_compra',
        'custrecord_sdb_inv_fecha_compra',
        'custrecord_sdb_inv_cotizacion_compra'
    ];

    const CAMPOS_POR_TIPO = {
        'Compra': [
            'custrecord_sdb_inv_fecha_compra',
            'custrecord_sdb_inv_monto_compra',
            'custrecord_sdb_inv_cuotapartes_compra',
            'custrecord_sdb_inv_cotizacion_compra',
            'custrecord_sdb_inv_costos_compra'
        ],
        'Rescate': [
            'custrecord_sdb_inv_monto_rescate',
            'custrecord_sdb_inv_cuotapartes_rescate',
            'custrecord_sdb_inv_valor_cuota_rescate',
            'custrecord_sdb_inv_fecha_rescate',
            'custrecord_sdb_inv_int_cobrados',
            'custrecord_sdb_inv_costos'
        ],
        'Revaluación': [
            'custrecord_sdb_inv_monto_actual',
            'custrecord_sdb_inv_valor_actual',
            'custrecord_sdb_inv_cotizacion_titulo',
            'custrecord_sdb_inv_int_devengados',
            'custrecord_sdb_inv_fecha_ult_calc'
        ]
    };

    // Campos de INPUT a limpiar al cambiar de operación (no incluye campos estructurales/sumario)
    const CAMPOS_INPUT_POR_TIPO = {
        'Compra': [
            'custrecord_sdb_inv_fecha_compra',
            'custrecord_sdb_inv_monto_compra',
            'custrecord_sdb_inv_cuotapartes_compra',
            'custrecord_sdb_inv_cotizacion_compra',
            'custrecord_sdb_inv_costos_compra'
        ],
        'Rescate': [
            'custrecord_sdb_inv_monto_rescate',
            'custrecord_sdb_inv_cuotapartes_rescate',
            'custrecord_sdb_inv_valor_cuota_rescate',
            'custrecord_sdb_inv_fecha_rescate',
            'custrecord_sdb_inv_int_cobrados',
            'custrecord_sdb_inv_costos'
        ],
        'Revaluación': []
    };

    const TODOS_LOS_CAMPOS = Object.values(CAMPOS_POR_TIPO).flat();

    // Campos calculados automáticamente — siempre disabled aunque estén en CAMPOS_POR_TIPO
    const CAMPOS_AUTO_CALC = [
        'custrecord_sdb_inv_cuotapartes_compra',
        'custrecord_sdb_inv_cuotapartes_rescate'
    ];

    function setDisabled(currentRecord, fieldIds, disabled) {
        fieldIds.forEach(id => {
            const f = currentRecord.getField({ fieldId: id });
            if (f) f.isDisabled = disabled;
        });
    }

    function setMandatory(currentRecord, fieldIds, mandatory) {
        fieldIds.forEach(id => {
            const f = currentRecord.getField({ fieldId: id });
            if (f) f.isMandatory = mandatory;
        });
    }

    function setDisplay(currentRecord, fieldIds, display) {
        fieldIds.forEach(id => {
            const f = currentRecord.getField({ fieldId: id });
            if (f) f.isDisplay = display;
        });
    }

    function aplicarVisibilidad(currentRecord) {
        setDisabled(currentRecord, TODOS_LOS_CAMPOS, true);
        const tipoOp = currentRecord.getText({ fieldId: FIELD_TIPO_OPERACION });
        if (tipoOp) {
            const habilitar = CAMPOS_POR_TIPO[tipoOp];
            if (habilitar) setDisabled(currentRecord, habilitar, false);
        }
        // Plazo Fijo: tipo_operacion no aplica. Habilitamos los campos del flujo PF directamente.
        const tipoInstrumento = currentRecord.getValue({ fieldId: FIELD_TIPO_INSTRUMENTO });
        if (tipoInstrumento === TIPO_PLAZO_FIJO) {
            setDisabled(currentRecord, ['custrecord_sdb_inv_fecha_fin'], false);
        }
        // Ocultar subtipos no aplicables en PF
        const esPF = tipoInstrumento === TIPO_PLAZO_FIJO;
        setDisplay(currentRecord, FIELDS_HIDE_IN_PF, !esPF);
        // Campos calculados automáticamente: siempre disabled
        setDisabled(currentRecord, CAMPOS_AUTO_CALC, true);
    }

    function limpiarCamposOtrasOperaciones(currentRecord, tipoOpActual) {
        Object.keys(CAMPOS_INPUT_POR_TIPO).forEach(tipo => {
            if (tipo === tipoOpActual) return;
            CAMPOS_INPUT_POR_TIPO[tipo].forEach(fieldId => {
                const f = currentRecord.getField({ fieldId: fieldId });
                if (!f) return;
                const val = currentRecord.getValue({ fieldId: fieldId });
                if (val === '' || val === null || val === undefined) return;
                // Para campos date: null; para numéricos/texto: ''
                const clearValue = (f.type === 'date' || f.type === 'datetimetz') ? null : '';
                try {
                    currentRecord.setValue({ fieldId: fieldId, value: clearValue, ignoreFieldChange: true });
                } catch (e) {}
            });
        });
    }

    function aplicarMandatoriedadCompra(currentRecord) {
        const isCreate = !currentRecord.id;
        if (!isCreate) {
            setMandatory(currentRecord, CAMPOS_COMPRA_REQUERIDOS, false);
            return;
        }
        const tipoInstrumento = currentRecord.getValue({ fieldId: FIELD_TIPO_INSTRUMENTO });
        const esPF = tipoInstrumento === TIPO_PLAZO_FIJO;
        setMandatory(currentRecord, CAMPOS_COMPRA_REQUERIDOS, !!tipoInstrumento && !esPF);
    }

    // Deja en el dropdown de Moneda solo ARS y USD (el maestro local no opera otras monedas).
    // No toca las monedas del exterior, que usan sus propios campos.
    function filtrarMonedas(currentRecord) {
        try {
            const fld = currentRecord.getField({ fieldId: FIELD_MONEDA });
            if (!fld || typeof fld.getSelectOptions !== 'function') return;
            const permitidas = [BASE_CURRENCY_ID, USD_CURRENCY_ID];
            const actual = String(currentRecord.getValue({ fieldId: FIELD_MONEDA }) || '');
            if (actual && permitidas.indexOf(actual) === -1) permitidas.push(actual); // preserva valor de registros viejos
            const opts = fld.getSelectOptions() || [];
            opts.forEach(function (o) {
                if (o.value && permitidas.indexOf(String(o.value)) === -1) {
                    fld.removeSelectOption({ value: o.value });
                }
            });
        } catch (e) { console.error('[moneda] filtrar', e); }
    }

    function pageInit(context) {
        aplicarVisibilidad(context.currentRecord);
        aplicarMandatoriedadCompra(context.currentRecord);
        filtrarMonedas(context.currentRecord);
        _cuotapartesOriginales = parseFloat(context.currentRecord.getValue({ fieldId: 'custrecord_sdb_inv_cuotapartes' }) || 0);
        // Default fechas a hoy si están vacías (sólo en CREATE)
        if (context.mode === 'create') {
            const hoy = new Date();
            ['custrecord_sdb_inv_fecha_compra', 'custrecord_sdb_inv_fecha_rescate'].forEach(fid => {
                const f = context.currentRecord.getField({ fieldId: fid });
                if (!f) return;
                const v = context.currentRecord.getValue({ fieldId: fid });
                if (!v) {
                    try { context.currentRecord.setValue({ fieldId: fid, value: hoy, ignoreFieldChange: false }); } catch (e) {}
                }
            });
        }
    }

    function fieldChanged(context) {
        const rec = context.currentRecord;
        if (context.fieldId === FIELD_TIPO_OPERACION) {
            const tipoOpActual = rec.getText({ fieldId: FIELD_TIPO_OPERACION });
            limpiarCamposOtrasOperaciones(rec, tipoOpActual);
            aplicarVisibilidad(rec);
        }
        if (context.fieldId === FIELD_TIPO_INSTRUMENTO) {
            aplicarMandatoriedadCompra(rec);
            aplicarVisibilidad(rec);
            if (rec.getValue({ fieldId: FIELD_INSTITUCION })) {
                sourcearDesdeInstitucion(rec);
            }
        }
        if (context.fieldId === FIELD_INSTITUCION) {
            sourcearDesdeInstitucion(rec);
        }
        // Auto-source TC al cambiar fecha (compra o rescate)
        if (context.fieldId === FIELD_FECHA_COMPRA || context.fieldId === FIELD_FECHA_RESCATE) {
            console.log('[TC] fieldChanged', context.fieldId);
            const fecha = rec.getValue({ fieldId: context.fieldId });
            _sourcearTipoCambio(rec, fecha);
        }
        if (context.fieldId === FIELD_MONEDA) {
            console.log('[TC] fieldChanged moneda');
            const fc = rec.getValue({ fieldId: FIELD_FECHA_COMPRA });
            const fr = rec.getValue({ fieldId: FIELD_FECHA_RESCATE });
            _sourcearTipoCambio(rec, fc || fr);
            if (rec.getValue({ fieldId: FIELD_INSTITUCION })) {
                sourcearDesdeInstitucion(rec);
            }
        }
        // Auto-cálculo cuotapartes_compra = monto_compra / cotizacion_compra
        if (context.fieldId === FIELD_MONTO_COMPRA || context.fieldId === FIELD_COTIZ_COMPRA) {
            const monto = parseFloat(rec.getValue({ fieldId: FIELD_MONTO_COMPRA }) || 0);
            const cotiz = parseFloat(rec.getValue({ fieldId: FIELD_COTIZ_COMPRA }) || 0);
            if (monto > 0 && cotiz > 0) {
                const cuotap = parseFloat((monto / cotiz).toFixed(6));
                rec.setValue({ fieldId: FIELD_CUOTAP_COMPRA, value: cuotap, ignoreFieldChange: true });
            } else {
                rec.setValue({ fieldId: FIELD_CUOTAP_COMPRA, value: '', ignoreFieldChange: true });
            }
        }
        // Auto-cálculo días = fecha_fin - fecha_inicio
        if (context.fieldId === FIELD_FECHA_INICIO || context.fieldId === FIELD_FECHA_FIN) {
            const fIni = rec.getValue({ fieldId: FIELD_FECHA_INICIO });
            const fFin = rec.getValue({ fieldId: FIELD_FECHA_FIN });
            if (fIni instanceof Date && fFin instanceof Date) {
                const ms = fFin.getTime() - fIni.getTime();
                const dias = Math.round(ms / 86400000);
                rec.setValue({ fieldId: FIELD_DIAS, value: dias >= 0 ? dias : 0, ignoreFieldChange: true });
            } else {
                rec.setValue({ fieldId: FIELD_DIAS, value: '', ignoreFieldChange: true });
            }
        }
        // Auto-cálculo cuotapartes_rescate = monto_rescate / valor_cuota_rescate (el usuario pone monto + cotización de rescate)
        if (context.fieldId === FIELD_MONTO_RESCATE || context.fieldId === FIELD_VALOR_CUOTA_RESCATE) {
            const montoR = parseFloat(rec.getValue({ fieldId: FIELD_MONTO_RESCATE }) || 0);
            const cotiz = parseFloat(rec.getValue({ fieldId: FIELD_VALOR_CUOTA_RESCATE }) || 0);
            if (montoR > 0 && cotiz > 0) {
                const cuotapR = parseFloat((montoR / cotiz).toFixed(6));
                rec.setValue({ fieldId: FIELD_CUOTAP_RESCATE, value: cuotapR, ignoreFieldChange: true });
            } else {
                rec.setValue({ fieldId: FIELD_CUOTAP_RESCATE, value: '', ignoreFieldChange: true });
            }
        }
    }

    function _sourcearTipoCambio(rec, fecha) {
        console.log('[TC] _sourcearTipoCambio called', { fecha: fecha });
        if (!fecha) { console.log('[TC] sin fecha, abort'); return; }
        const monedaId = rec.getValue({ fieldId: FIELD_MONEDA });
        console.log('[TC] monedaId:', monedaId);
        if (!monedaId) { console.log('[TC] sin moneda, abort'); return; }
        if (String(monedaId) === BASE_CURRENCY_ID) {
            console.log('[TC] moneda = base, TC=1');
            rec.setValue({ fieldId: FIELD_TIPO_CAMBIO, value: 1, ignoreFieldChange: true });
            return;
        }
        try {
            const fechaStr = format.format({ value: fecha, type: format.Type.DATE });
            console.log('[TC] buscando currencyrate', { moneda: monedaId, fecha: fechaStr });
            const results = search.create({
                type: 'currencyrate',
                filters: [
                    ['transactioncurrency', 'anyof', monedaId],
                    'AND',
                    ['effectivedate', 'onorbefore', fechaStr]
                ],
                columns: [
                    search.createColumn({ name: 'effectivedate', sort: search.Sort.DESC }),
                    search.createColumn({ name: 'exchangerate' })
                ]
            }).run().getRange({ start: 0, end: 1 });
            console.log('[TC] resultados:', results.length);
            if (results.length > 0) {
                const rate = parseFloat(results[0].getValue({ name: 'exchangerate' }));
                console.log('[TC] rate encontrado:', rate);
                if (rate > 0) {
                    rec.setValue({ fieldId: FIELD_TIPO_CAMBIO, value: rate, ignoreFieldChange: true });
                    return;
                }
            }
            console.log('[TC] no se encontró rate, dejo vacío');
            rec.setValue({ fieldId: FIELD_TIPO_CAMBIO, value: '', ignoreFieldChange: true });
        } catch (e) {
            console.error('[TC] error', e.message);
        }
    }

    function sourcearDesdeInstitucion(rec) {
        const instId = rec.getValue({ fieldId: FIELD_INSTITUCION });
        if (!instId) return;
        try {
            const r = search.lookupFields({
                type: 'customrecord_sdb_inv_inst_financiera',
                id: instId,
                columns: [
                    'custrecord_sdb_instfin_cta_banco',
                    'custrecord_sdb_instfin_cta_comisiones',
                    'custrecord_sdb_instfin_moneda',
                    'custrecord_sdb_cuenta_contable_activo',
                    'custrecord_sdb_instfin_cta_banco_ars',
                    'custrecord_sdb_instfin_cta_banco_usd',
                    'custrecord_sdb_instfin_cta_act_pf_ars',
                    'custrecord_sdb_instfin_cta_act_pf_usd',
                    'custrecord_sdb_instfin_cta_int_dev_ars',
                    'custrecord_sdb_instfin_cta_int_dev_usd',
                    'custrecord_sdb_instfin_cta_act_fci_ars',
                    'custrecord_sdb_instfin_cta_act_fci_usd',
                    'custrecord_sdb_instfin_cta_act_bono_ars',
                    'custrecord_sdb_instfin_cta_act_bono_usd'
                ]
            });
            const monedaInst = _pickId(r.custrecord_sdb_instfin_moneda);
            const monedaActual = rec.getValue({ fieldId: FIELD_MONEDA });
            const moneda = monedaActual || monedaInst;
            const esARS = String(moneda) === BASE_CURRENCY_ID;
            const tipoInstr = rec.getValue({ fieldId: FIELD_TIPO_INSTRUMENTO });
            const esPF = tipoInstr === TIPO_PLAZO_FIJO;

            // Cta. Activo según tipo+moneda (con fallback al legacy cta_activo)
            let ctaActivoSrc = '';
            let ctaIntDevSrc = '';
            if (tipoInstr === TIPO_PLAZO_FIJO) {
                ctaActivoSrc = esARS
                    ? _pickId(r.custrecord_sdb_instfin_cta_act_pf_ars)
                    : _pickId(r.custrecord_sdb_instfin_cta_act_pf_usd);
                ctaIntDevSrc = esARS
                    ? _pickId(r.custrecord_sdb_instfin_cta_int_dev_ars)
                    : _pickId(r.custrecord_sdb_instfin_cta_int_dev_usd);
            } else if (tipoInstr === '2') { // FCI
                ctaActivoSrc = esARS
                    ? _pickId(r.custrecord_sdb_instfin_cta_act_fci_ars)
                    : _pickId(r.custrecord_sdb_instfin_cta_act_fci_usd);
            } else if (tipoInstr === '3') { // Bono
                ctaActivoSrc = esARS
                    ? _pickId(r.custrecord_sdb_instfin_cta_act_bono_ars)
                    : _pickId(r.custrecord_sdb_instfin_cta_act_bono_usd);
            }
            if (!ctaActivoSrc) ctaActivoSrc = _pickId(r.custrecord_sdb_cuenta_contable_activo);

            // Cta. Banco según moneda (con fallback al legacy cta_banco)
            let ctaBancoSrc = esARS
                ? _pickId(r.custrecord_sdb_instfin_cta_banco_ars)
                : _pickId(r.custrecord_sdb_instfin_cta_banco_usd);
            if (!ctaBancoSrc) ctaBancoSrc = _pickId(r.custrecord_sdb_instfin_cta_banco);

            const ctaCom = _pickId(r.custrecord_sdb_instfin_cta_comisiones);

            if (ctaActivoSrc) rec.setValue({ fieldId: FIELD_CTA_ACTIVO, value: ctaActivoSrc, ignoreFieldChange: true });
            if (ctaBancoSrc) {
                const destinoBanco = esPF ? FIELD_CTA_RESULTADO : FIELD_CTA_BANCO;
                rec.setValue({ fieldId: destinoBanco, value: ctaBancoSrc, ignoreFieldChange: true });
            }
            if (ctaIntDevSrc) {
                try { rec.setValue({ fieldId: 'custrecord_sdb_inv_cta_int_devengados', value: ctaIntDevSrc, ignoreFieldChange: true }); } catch (e) {}
            }
            if (ctaCom) rec.setValue({ fieldId: FIELD_CTA_COMISIONES, value: ctaCom, ignoreFieldChange: true });
            if (monedaInst && !monedaActual) {
                rec.setValue({ fieldId: FIELD_MONEDA, value: monedaInst, ignoreFieldChange: true });
            }
        } catch (e) { /* silent */ }
    }

    function _pickId(v) {
        if (Array.isArray(v) && v[0]) return v[0].value;
        return v || '';
    }

    function saveRecord(context) {
        const rec = context.currentRecord;
        const tipoInstr = rec.getValue({ fieldId: FIELD_TIPO_INSTRUMENTO });
        if (tipoInstr === TIPO_PLAZO_FIJO) return true;

        const tipoOpText = (rec.getText({ fieldId: FIELD_TIPO_OPERACION }) || '').trim();
        const cuotapR = parseFloat(rec.getValue({ fieldId: FIELD_CUOTAP_RESCATE }) || 0);

        if (tipoOpText === 'Rescate' || cuotapR > 0) {
            if (cuotapR <= 0) {
                alert('Rescate: indicá la cantidad de cuotapartes a rescatar.');
                return false;
            }
            if (_cuotapartesOriginales > 0 && cuotapR > _cuotapartesOriginales) {
                alert('Rescate: las cuotapartes a rescatar (' + cuotapR + ') exceden las disponibles (' + _cuotapartesOriginales + ').');
                return false;
            }
        }

        return true;
    }

    return { pageInit, fieldChanged, saveRecord };
});
