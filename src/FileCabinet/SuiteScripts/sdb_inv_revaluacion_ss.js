/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/search', 'N/runtime', 'N/log'], (record, search, runtime, log) => {

    const MONEDA_LOCAL = 'ARS';

    function execute(context) {
        const script = runtime.getCurrentScript();
        const ctaDifCambio = script.getParameter('custscript_sdb_rev_cta_dif_cambio');

        if (!ctaDifCambio) {
            log.error('revaluacion', 'Cuenta de diferencia de cambio no configurada en parámetros del script.');
            return;
        }

        const hoy = new Date();
        const periodo = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;

        log.audit('revaluacion', `Iniciando revaluación para período: ${periodo}`);

        // Buscar inversiones activas en moneda extranjera
        const inversiones = _buscarInversionesEnMonedaExtranjera();
        let procesadas = 0;
        let errores = 0;

        inversiones.each(result => {
            try {
                const invId = result.id;
                const moneda = result.getValue('custrecord_sdb_inv_moneda');
                const monedaText = result.getText('custrecord_sdb_inv_moneda');
                const monto = parseFloat(result.getValue('custrecord_sdb_inv_monto') || 0);
                const valorActual = parseFloat(result.getValue('custrecord_sdb_inv_valor_actual') || monto);
                const ctaActivo = result.getValue('custrecord_sdb_inv_cta_activo');
                const subsidiaria = result.getValue('custrecord_sdb_inv_subsidiaria');

                if (!ctaActivo) return true;

                // Obtener cotización del período desde el Custom Record de cotizaciones
                // Se pasa el ID de moneda (campo SELECT) y el texto para logs
                const cotizacion = _obtenerCotizacion(moneda, periodo);
                if (!cotizacion) {
                    log.audit('revaluacion', `Sin cotización para ${monedaText} (id=${moneda}) en ${periodo}. Inversión ${invId} omitida.`);
                    return true;
                }

                // Calcular diferencia de cambio
                const valorRevaluado = valorActual * cotizacion;
                const diferencia = valorRevaluado - valorActual;

                if (Math.abs(diferencia) < 0.01) return true;

                const signo = diferencia > 0 ? 'GANANCIA' : 'PÉRDIDA';
                const je = record.create({ type: record.Type.JOURNAL_ENTRY, isDynamic: true });
                je.setValue('subsidiary', subsidiaria);
                je.setValue('memo', `[REVALUACIÓN ${signo}] ${monedaText} | Período: ${periodo} | Cotiz: ${cotizacion} | Inv. ${invId}`);
                je.setValue('custbody_sdb_inv_inversion', invId);

                if (diferencia > 0) {
                    // Debe: Activo; Haber: Diferencia de cambio (ganancia)
                    je.selectNewLine({ sublistId: 'line' });
                    je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: ctaActivo });
                    je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'debit', value: parseFloat(Math.abs(diferencia).toFixed(2)) });
                    je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: `Revaluación ${monedaText} - Ajuste Activo (Ganancia) | Inv. ${invId} | ${periodo}` });
                    je.commitLine({ sublistId: 'line' });

                    je.selectNewLine({ sublistId: 'line' });
                    je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: ctaDifCambio });
                    je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'credit', value: parseFloat(Math.abs(diferencia).toFixed(2)) });
                    je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: `Revaluación ${monedaText} - Diferencia de Cambio Ganada | Inv. ${invId} | ${periodo}` });
                    je.commitLine({ sublistId: 'line' });
                } else {
                    // Debe: Diferencia de cambio (pérdida); Haber: Activo
                    je.selectNewLine({ sublistId: 'line' });
                    je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: ctaDifCambio });
                    je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'debit', value: parseFloat(Math.abs(diferencia).toFixed(2)) });
                    je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: `Revaluación ${monedaText} - Diferencia de Cambio Perdida | Inv. ${invId} | ${periodo}` });
                    je.commitLine({ sublistId: 'line' });

                    je.selectNewLine({ sublistId: 'line' });
                    je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: ctaActivo });
                    je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'credit', value: parseFloat(Math.abs(diferencia).toFixed(2)) });
                    je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: `Revaluación ${monedaText} - Ajuste Activo (Pérdida) | Inv. ${invId} | ${periodo}` });
                    je.commitLine({ sublistId: 'line' });
                }

                const jeId = je.save();
                log.audit('revaluacion', `JE ${jeId} creado para Inversión ${invId} - Dif: ${diferencia.toFixed(2)}`);

                // Actualizar valor actual revaluado y limpiar error previo
                record.submitFields({
                    type: 'customrecord_sdb_inv_maestro',
                    id: invId,
                    values: {
                        custrecord_sdb_inv_valor_actual: parseFloat(valorRevaluado.toFixed(2)),
                        custrecord_sdb_inv_ultimo_error: ''
                    }
                });

                procesadas++;
            } catch (e) {
                log.error('revaluacion - error', e.message);
                try {
                    record.submitFields({
                        type: 'customrecord_sdb_inv_maestro',
                        id: invId,
                        values: { custrecord_sdb_inv_ultimo_error: `[${new Date().toISOString()}] Revaluación: ${e.message}` }
                    });
                } catch (e2) {
                    log.error('revaluacion - No se pudo guardar el error en el registro', e2.message);
                }
                errores++;
            }
            return true;
        });

        log.audit('revaluacion', `Finalizado. Procesadas: ${procesadas} | Errores: ${errores}`);
    }

    function _buscarInversionesEnMonedaExtranjera() {
        return search.create({
            type: 'customrecord_sdb_inv_maestro',
            filters: [
                search.createFilter({
                    name: 'custrecord_sdb_inv_estado',
                    operator: search.Operator.ANYOF,
                    values: ['1', '2'] // Activa, Rescatada Parcial
                }),
                search.createFilter({
                    name: 'custrecord_sdb_inv_cta_activo',
                    operator: search.Operator.ISNOTEMPTY
                })
            ],
            columns: [
                'custrecord_sdb_inv_moneda',
                'custrecord_sdb_inv_monto',
                'custrecord_sdb_inv_valor_actual',
                'custrecord_sdb_inv_cta_activo',
                'custrecord_sdb_inv_subsidiaria'
            ]
        }).run();
    }

    function _obtenerCotizacion(monedaId, periodo) {
        const resultados = search.create({
            type: 'customrecord_sdb_inv_cotizaciones',
            filters: [
                search.createFilter({ name: 'custrecord_sdb_cot_periodo', operator: search.Operator.IS, values: [periodo] }),
                search.createFilter({ name: 'custrecord_sdb_cot_moneda', operator: search.Operator.ANYOF, values: [monedaId] })
            ],
            columns: ['custrecord_sdb_cot_valor']
        }).run().getRange({ start: 0, end: 1 });

        if (resultados.length > 0) {
            return parseFloat(resultados[0].getValue('custrecord_sdb_cot_valor') || 0);
        }
        return null;
    }

    return { execute };
});
