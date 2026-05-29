/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/search', 'N/runtime', 'N/log', 'N/format'], (record, search, runtime, log, format) => {

    const TIPO_PF = '1';
    const ESTADO_ACTIVA = '1';

    function execute(context) {
        const script = runtime.getCurrentScript();
        const ctaIntDevDefault = script.getParameter('custscript_sdb_devm_cta_int_devengados');
        const ctaIntGanDefault = script.getParameter('custscript_sdb_devm_cta_int_ganados');
        const forzarFechaStr = script.getParameter('custscript_sdb_devm_forzar_fecha');

        // Si hay forzarFecha → usar EXACTA esa fecha como corte (útil para testing).
        // Si no → último día del mes actual.
        let fechaCorte;
        if (forzarFechaStr) {
            const parsed = _parse(forzarFechaStr);
            fechaCorte = parsed || _ultimoDiaDelMes(new Date());
        } else {
            fechaCorte = _ultimoDiaDelMes(new Date());
        }

        log.audit('devengamiento mensual', `Fecha de corte: ${_fmtDate(fechaCorte)} ${forzarFechaStr ? `(forzada raw: ${forzarFechaStr})` : '(fin de mes)'}.`);

        const pfs = _buscarPFsActivos();
        log.audit('devengamiento mensual', `Encontrados ${pfs.length} PFs activos.`);

        let procesados = 0, sinCambio = 0, errores = 0;

        pfs.forEach(pf => {
            try {
                const ctaIntDev = pf.ctaIntDevRecord || ctaIntDevDefault;
                const ctaIntGan = pf.ctaIntGanRecord || ctaIntGanDefault;
                if (!ctaIntDev || !ctaIntGan) {
                    const faltan = [];
                    if (!ctaIntDev) faltan.push('custrecord_sdb_inv_cta_int_devengados (o param custscript_sdb_devm_cta_int_devengados)');
                    if (!ctaIntGan) faltan.push('custrecord_sdb_inv_cta_intereses (o param custscript_sdb_devm_cta_int_ganados)');
                    throw new Error(`Faltan cuentas: ${faltan.join(' | ')}`);
                }
                const r = _procesarDevengamiento(pf, fechaCorte, ctaIntDev, ctaIntGan);
                if (r === 'devengado') procesados++;
                else sinCambio++;
            } catch (e) {
                errores++;
                log.error('devengamiento mensual - error', `Inv ${pf.id}: ${e.message}`);
                _guardarError(pf.id, `Dev mensual: ${e.message}`);
            }
        });

        log.audit('devengamiento mensual', `Finalizado. Devengados: ${procesados} | Sin cambio: ${sinCambio} | Errores: ${errores}`);
    }

    function _buscarPFsActivos() {
        const out = [];
        search.create({
            type: 'customrecord_sdb_inv_maestro',
            filters: [
                ['custrecord_sdb_inv_tipo', 'anyof', [TIPO_PF]],
                'AND', ['custrecord_sdb_inv_estado', 'anyof', [ESTADO_ACTIVA]],
                'AND', ['isinactive', 'is', 'F']
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

    function _procesarDevengamiento(pf, fechaCorte, ctaIntDev, ctaIntGan) {
        if (pf.monto <= 0 || pf.tna <= 0) {
            log.audit('devengamiento mensual', `Inv ${pf.id} omitida: monto/TNA en 0 (monto=${pf.monto}, tna=${pf.tna}).`);
            return 'sin-cambio';
        }
        if (!pf.subsidiaria) throw new Error('Falta Subsidiaria en el record.');
        if (!pf.moneda) throw new Error('Falta Moneda en el record.');

        const fechaInicio = _parse(pf.fechaInicio);
        const fechaFin = _parse(pf.fechaFin);
        const fechaUltCalc = _parse(pf.fechaUltCalc);

        const fechaDesde = fechaUltCalc || fechaInicio;
        const fechaHasta = (fechaFin && fechaFin < fechaCorte) ? fechaFin : fechaCorte;

        if (!fechaDesde) throw new Error(`Falta Fecha de Inicio o no se pudo parsear (raw: "${pf.fechaInicio}", ult_calc raw: "${pf.fechaUltCalc}").`);
        if (fechaDesde >= fechaHasta) {
            log.audit('devengamiento mensual - fechas normalizadas', `Inv ${pf.id} | desde=${_fmtDate(fechaDesde)} | hasta=${_fmtDate(fechaHasta)}`);
            log.audit('devengamiento mensual', `Inv ${pf.id} sin período a devengar (desde=${fechaDesde.toISOString().slice(0,10)}, hasta=${fechaHasta.toISOString().slice(0,10)}).`);
            return 'sin-cambio';
        }

        const dias = _diasEntre(fechaDesde, fechaHasta);
        const diasAnio = _esBisiesto(fechaHasta.getFullYear()) ? 366 : 365;
        const intereses = parseFloat((pf.monto * (pf.tna / 100) * (dias / diasAnio)).toFixed(2));

        if (!isFinite(intereses) || isNaN(intereses)) {
            throw new Error(`Cálculo de intereses inválido (monto=${pf.monto}, tna=${pf.tna}, dias=${dias}).`);
        }
        if (intereses <= 0) return 'sin-cambio';

        _crearJE(pf, intereses, ctaIntDev, ctaIntGan, fechaHasta, dias);

        record.submitFields({
            type: 'customrecord_sdb_inv_maestro',
            id: pf.id,
            values: {
                custrecord_sdb_inv_int_devengados: parseFloat((pf.intDevengados + intereses).toFixed(2)),
                custrecord_sdb_inv_fecha_ult_calc: fechaHasta,
                custrecord_sdb_inv_ultimo_error: ''
            }
        });

        log.audit('devengamiento mensual', `Inv ${pf.id} | ${dias} días | Intereses: ${intereses}`);
        return 'devengado';
    }

    function _crearJE(pf, monto, ctaDeb, ctaCre, trandate, dias) {
        const je = record.create({ type: record.Type.JOURNAL_ENTRY, isDynamic: true });
        if (pf.subsidiaria) je.setValue('subsidiary', pf.subsidiaria);
        if (pf.moneda) je.setValue('currency', pf.moneda);
        if (trandate) je.setValue('trandate', trandate);
        je.setValue('memo', `[DEVENGAMIENTO MENSUAL] PF | Inv. ${pf.id} | ${dias} días | TNA ${pf.tna}%`);
        je.setValue('custbody_sdb_inv_inversion', pf.id);

        je.selectNewLine({ sublistId: 'line' });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: ctaDeb });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'debit', value: monto });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: `Devengamiento mensual PF - Intereses a cobrar | Inv. ${pf.id}` });
        je.commitLine({ sublistId: 'line' });

        je.selectNewLine({ sublistId: 'line' });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: ctaCre });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'credit', value: monto });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: `Devengamiento mensual PF - Intereses ganados | Inv. ${pf.id}` });
        je.commitLine({ sublistId: 'line' });

        const jeId = je.save();
        log.audit('devengamiento mensual - JE', `Inv ${pf.id} | JE ${jeId} | Monto ${monto} | Días ${dias}`);
    }

    function _guardarError(invId, msg) {
        try {
            record.submitFields({
                type: 'customrecord_sdb_inv_maestro',
                id: invId,
                values: { custrecord_sdb_inv_ultimo_error: `[${new Date().toISOString()}] ${msg}` }
            });
        } catch (e) {
            log.error('devengamiento mensual - no pude guardar error', `Inv ${invId}: ${e.message}`);
        }
    }

    function _esBisiesto(a) { return (a % 4 === 0 && a % 100 !== 0) || (a % 400 === 0); }
    function _ultimoDiaDelMes(d) { return _normalizeDate(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }
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
