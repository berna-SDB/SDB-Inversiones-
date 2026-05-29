/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/search', 'N/runtime', 'N/log', 'N/format'], (record, search, runtime, log, format) => {

    const TIPO_PF = '1';
    const ESTADO_ACTIVA = '1';
    const ESTADO_CANCELADA = '3';

    function execute(context) {
        const script = runtime.getCurrentScript();
        const ctaIntDevDefault = script.getParameter('custscript_sdb_venc_cta_int_devengados');
        const ctaIntGanDefault = script.getParameter('custscript_sdb_venc_cta_int_ganados');
        const forzarFechaStr = script.getParameter('custscript_sdb_venc_forzar_fecha');

        const hoy = forzarFechaStr ? (_parse(forzarFechaStr) || _truncar(new Date())) : _truncar(new Date());
        const pfs = _buscarPFsVencidos(hoy);

        log.audit('vencimiento PF', `Encontrados ${pfs.length} PFs con fecha_fin <= ${_fmtDate(hoy)}${forzarFechaStr ? ` (forzada raw: ${forzarFechaStr})` : ''}.`);

        let cancelados = 0, sinCambio = 0, errores = 0;

        pfs.forEach(pf => {
            try {
                const ctaIntDev = pf.ctaIntDevRecord || ctaIntDevDefault;
                const ctaIntGan = pf.ctaIntGanRecord || ctaIntGanDefault;
                if (!ctaIntDev || !ctaIntGan) {
                    const faltan = [];
                    if (!ctaIntDev) faltan.push('custrecord_sdb_inv_cta_int_devengados (o param custscript_sdb_venc_cta_int_devengados)');
                    if (!ctaIntGan) faltan.push('custrecord_sdb_inv_cta_intereses (o param custscript_sdb_venc_cta_int_ganados)');
                    throw new Error(`Faltan cuentas: ${faltan.join(' | ')}`);
                }
                const r = _procesarVencimiento(pf, ctaIntDev, ctaIntGan);
                if (r === 'cancelado') cancelados++;
                else sinCambio++;
            } catch (e) {
                errores++;
                log.error('vencimiento PF - error', `Inv ${pf.id}: ${e.message}`);
                _guardarError(pf.id, `Vencimiento: ${e.message}`);
            }
        });

        log.audit('vencimiento PF', `Finalizado. Cancelados: ${cancelados} | Sin cambio: ${sinCambio} | Errores: ${errores}`);
    }

    function _buscarPFsVencidos(hoy) {
        const hoyFiltro = format.format({ value: hoy, type: format.Type.DATE });
        const out = [];
        search.create({
            type: 'customrecord_sdb_inv_maestro',
            filters: [
                ['custrecord_sdb_inv_tipo', 'anyof', [TIPO_PF]],
                'AND', ['custrecord_sdb_inv_estado', 'anyof', [ESTADO_ACTIVA]],
                'AND', ['isinactive', 'is', 'F'],
                'AND', ['custrecord_sdb_inv_fecha_fin', 'onorbefore', hoyFiltro]
            ],
            columns: [
                'custrecord_sdb_inv_monto',
                'custrecord_sdb_inv_tna',
                'custrecord_sdb_inv_fecha_inicio',
                'custrecord_sdb_inv_fecha_fin',
                'custrecord_sdb_inv_fecha_ult_calc',
                'custrecord_sdb_inv_int_devengados',
                'custrecord_sdb_inv_subsidiaria',
                'custrecord_sdb_inv_moneda',
                'custrecord_sdb_inv_cta_intereses',
                'custrecord_sdb_inv_cta_int_devengados'
            ]
        }).run().each(r => {
            out.push({
                id: r.id,
                monto: parseFloat(r.getValue({ name: 'custrecord_sdb_inv_monto' }) || 0),
                tna: parseFloat(r.getValue({ name: 'custrecord_sdb_inv_tna' }) || 0),
                fechaInicio: r.getValue({ name: 'custrecord_sdb_inv_fecha_inicio' }),
                fechaFin: r.getValue({ name: 'custrecord_sdb_inv_fecha_fin' }),
                fechaUltCalc: r.getValue({ name: 'custrecord_sdb_inv_fecha_ult_calc' }),
                intDevengados: parseFloat(r.getValue({ name: 'custrecord_sdb_inv_int_devengados' }) || 0),
                subsidiaria: r.getValue({ name: 'custrecord_sdb_inv_subsidiaria' }),
                moneda: r.getValue({ name: 'custrecord_sdb_inv_moneda' }),
                ctaIntGanRecord: r.getValue({ name: 'custrecord_sdb_inv_cta_intereses' }),
                ctaIntDevRecord: r.getValue({ name: 'custrecord_sdb_inv_cta_int_devengados' })
            });
            return true;
        });
        return out;
    }

    function _procesarVencimiento(pf, ctaIntDev, ctaIntGan) {
        if (pf.monto <= 0 || pf.tna <= 0) {
            log.audit('vencimiento PF', `Inv ${pf.id} omitida: monto/TNA en 0 (monto=${pf.monto}, tna=${pf.tna}).`);
            return 'sin-cambio';
        }
        if (!pf.subsidiaria) throw new Error('Falta Subsidiaria en el record.');
        if (!pf.moneda) throw new Error('Falta Moneda en el record.');

        const fechaFin = _parse(pf.fechaFin);
        const fechaDesde = _parse(pf.fechaUltCalc) || _parse(pf.fechaInicio);
        if (!fechaFin) throw new Error('Falta Fecha de Finalización en el record.');

        let intPendientes = 0;
        if (fechaDesde && fechaFin && fechaDesde < fechaFin) {
            const dias = _diasEntre(fechaDesde, fechaFin);
            const diasAnio = _esBisiesto(fechaFin.getFullYear()) ? 366 : 365;
            intPendientes = parseFloat((pf.monto * (pf.tna / 100) * (dias / diasAnio)).toFixed(2));

            if (intPendientes > 0) {
                _crearJE(pf, intPendientes, ctaIntDev, ctaIntGan, fechaFin, dias, 'pre-vencimiento');
                record.submitFields({
                    type: 'customrecord_sdb_inv_maestro',
                    id: pf.id,
                    values: {
                        custrecord_sdb_inv_int_devengados: parseFloat((pf.intDevengados + intPendientes).toFixed(2)),
                        custrecord_sdb_inv_fecha_ult_calc: fechaFin
                    }
                });
            }
        }

        // Cambiar estado → CANCELADA. El UE del maestro dispara el JE de cobro (capital + int_devengados).
        record.submitFields({
            type: 'customrecord_sdb_inv_maestro',
            id: pf.id,
            values: { custrecord_sdb_inv_estado: ESTADO_CANCELADA }
        });

        log.audit('vencimiento PF', `Inv ${pf.id} cancelada. Int devengados extra: ${intPendientes}`);
        return 'cancelado';
    }

    function _crearJE(pf, monto, ctaDeb, ctaCre, trandate, dias, etiqueta) {
        const je = record.create({ type: record.Type.JOURNAL_ENTRY, isDynamic: true });
        if (pf.subsidiaria) je.setValue('subsidiary', pf.subsidiaria);
        if (pf.moneda) je.setValue('currency', pf.moneda);
        if (trandate) je.setValue('trandate', trandate);
        je.setValue('memo', `[DEVENGAMIENTO ${etiqueta.toUpperCase()}] PF | Inv. ${pf.id} | ${dias} días | TNA ${pf.tna}%`);
        je.setValue('custbody_sdb_inv_inversion', pf.id);

        je.selectNewLine({ sublistId: 'line' });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: ctaDeb });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'debit', value: monto });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: `Devengamiento PF ${etiqueta} - Intereses a cobrar | Inv. ${pf.id}` });
        je.commitLine({ sublistId: 'line' });

        je.selectNewLine({ sublistId: 'line' });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: ctaCre });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'credit', value: monto });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: `Devengamiento PF ${etiqueta} - Intereses ganados | Inv. ${pf.id}` });
        je.commitLine({ sublistId: 'line' });

        const jeId = je.save();
        log.audit('vencimiento PF - JE devengamiento', `Inv ${pf.id} | JE ${jeId} | Monto ${monto} | Días ${dias}`);
    }

    function _guardarError(invId, msg) {
        try {
            record.submitFields({
                type: 'customrecord_sdb_inv_maestro',
                id: invId,
                values: { custrecord_sdb_inv_ultimo_error: `[${new Date().toISOString()}] ${msg}` }
            });
        } catch (e) {
            log.error('vencimiento PF - no pude guardar error', `Inv ${invId}: ${e.message}`);
        }
    }

    function _esBisiesto(a) { return (a % 4 === 0 && a % 100 !== 0) || (a % 400 === 0); }
    function _truncar(d) { return _normalizeDate(d); }
    function _parse(d) {
        if (!d) return null;
        if (d instanceof Date) return _normalizeDate(d);
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(d))) {
            const parts = String(d).split('-').map(Number);
            return _normalizeDate(new Date(parts[0], parts[1] - 1, parts[2]));
        }
        try {
            return _normalizeDate(format.parse({ value: d, type: format.Type.DATE }));
        } catch (e) {
            const fallback = new Date(d);
            return isNaN(fallback.getTime()) ? null : _normalizeDate(fallback);
        }
    }
    function _normalizeDate(d) {
        if (!d) return null;
        return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }
    function _diasEntre(desde, hasta) {
        const a = Date.UTC(desde.getFullYear(), desde.getMonth(), desde.getDate());
        const b = Date.UTC(hasta.getFullYear(), hasta.getMonth(), hasta.getDate());
        return Math.round((b - a) / 86400000);
    }
    function _fmtDate(d) {
        if (!d) return '';
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    return { execute };
});
