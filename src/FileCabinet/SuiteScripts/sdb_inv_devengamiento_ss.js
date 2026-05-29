/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/search', 'N/runtime', 'N/log'], (record, search, runtime, log) => {

    function execute(context) {
        const script = runtime.getCurrentScript();
        const ctaIntDevengados = script.getParameter('custscript_sdb_dev_cta_int_devengados');
        const ctaIntGanados = script.getParameter('custscript_sdb_dev_cta_int_ganados');
        const forzar = script.getParameter('custscript_sdb_dev_forzar');

        const hoy = new Date();
        const esFinDeAnio = hoy.getMonth() === 11 && hoy.getDate() === 31;

        if (!esFinDeAnio && !forzar) {
            log.audit('devengamiento', 'No es 31/12 y no está activado "Forzar ejecución". Script finalizado sin procesar.');
            return;
        }

        if (!ctaIntDevengados || !ctaIntGanados) {
            log.error('devengamiento', 'Cuentas contables de devengamiento no configuradas en parámetros del script.');
            return;
        }

        // Buscar todos los Plazos Fijos activos directamente en el maestro
        const resultados = _buscarPlazosFijosActivos();
        let procesados = 0;
        let errores = 0;

        // Contar cuántos resultados hay para debug
        let totalEncontrados = 0;
        resultados.each(() => { totalEncontrados++; return true; });
        log.audit('devengamiento', `Búsqueda encontró ${totalEncontrados} Plazos Fijos activos.`);

        // Volver a ejecutar para procesar (el .each anterior consumió el cursor)
        const resultados2 = _buscarPlazosFijosActivos();
        resultados2.each(result => {
            try {
                const invId = result.id;
                const monto = parseFloat(result.getValue({ name: 'custrecord_sdb_inv_monto' }) || 0);
                const tna = parseFloat(result.getValue({ name: 'custrecord_sdb_inv_tna' }) || 0);
                const fechaInicio = result.getValue({ name: 'custrecord_sdb_inv_fecha_inicio' });
                const fechaFin = result.getValue({ name: 'custrecord_sdb_inv_fecha_fin' });
                const subsidiaria = result.getValue({ name: 'custrecord_sdb_inv_subsidiaria' });
                const moneda = result.getValue({ name: 'custrecord_sdb_inv_moneda' });

                log.debug('devengamiento', `Procesando Inv ${invId} | Monto: ${monto} | TNA: ${tna} | Inicio: ${fechaInicio} | Fin: ${fechaFin}`);

                if (monto <= 0 || tna <= 0) {
                    log.audit('devengamiento', `Inv ${invId} omitida — monto o TNA en cero (monto=${monto}, tna=${tna}).`);
                    return true;
                }

                // Validar que el PF siga vigente al 31/12 del año actual
                const fin31dic = new Date(hoy.getFullYear(), 11, 31);
                if (fechaFin) {
                    const fechaFinDate = new Date(fechaFin);
                    if (fechaFinDate <= fin31dic) {
                        log.audit('devengamiento', `Inv ${invId} omitida — vence antes del 31/12 (${fechaFin}).`);
                        return true;
                    }
                }

                // Calcular intereses desde fecha inicio hasta 31/12
                const diasAnio = _esBisiesto(hoy.getFullYear()) ? 366 : 365;
                const fechaInicioDate = new Date(fechaInicio);
                const diasTranscurridos = Math.floor((fin31dic - fechaInicioDate) / (1000 * 60 * 60 * 24));

                if (diasTranscurridos <= 0) {
                    log.audit('devengamiento', `Inv ${invId} omitida — días transcurridos = ${diasTranscurridos}.`);
                    return true;
                }

                const intereses = monto * (tna / 100) * (diasTranscurridos / diasAnio);
                log.debug('devengamiento', `Inv ${invId} | Días: ${diasTranscurridos}/${diasAnio} | Intereses calc: ${intereses.toFixed(2)}`);

                // Crear Journal Entry de devengamiento
                const je = record.create({ type: record.Type.JOURNAL_ENTRY, isDynamic: true });
                je.setValue('subsidiary', subsidiaria);
                je.setValue('currency', moneda);
                je.setValue('memo', `[DEVENGAMIENTO] Plazo Fijo | Intereses al 31/12/${hoy.getFullYear()} | Inv. ${invId} | ${diasTranscurridos} días`);
                je.setValue('custbody_sdb_inv_inversion', invId);

                je.selectNewLine({ sublistId: 'line' });
                je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: ctaIntDevengados });
                je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'debit', value: parseFloat(intereses.toFixed(2)) });
                je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: `Devengamiento PF - Intereses a cobrar | Inv. ${invId} | TNA ${tna}% | ${diasTranscurridos} días` });
                je.commitLine({ sublistId: 'line' });

                je.selectNewLine({ sublistId: 'line' });
                je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: ctaIntGanados });
                je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'credit', value: parseFloat(intereses.toFixed(2)) });
                je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: `Devengamiento PF - Intereses ganados | Inv. ${invId} | TNA ${tna}% | ${diasTranscurridos} días` });
                je.commitLine({ sublistId: 'line' });

                const jeId = je.save();
                log.audit('devengamiento', `JE ${jeId} creado para Inversión ${invId} - Intereses: ${intereses.toFixed(2)}`);

                // Actualizar intereses devengados en el maestro y limpiar error previo
                record.submitFields({
                    type: 'customrecord_sdb_inv_maestro',
                    id: invId,
                    values: {
                        custrecord_sdb_inv_int_devengados: parseFloat(intereses.toFixed(2)),
                        custrecord_sdb_inv_ultimo_error: ''
                    }
                });

                procesados++;
            } catch (e) {
                log.error('devengamiento - error procesando registro', e.message);
                try {
                    record.submitFields({
                        type: 'customrecord_sdb_inv_maestro',
                        id: invId,
                        values: { custrecord_sdb_inv_ultimo_error: `[${new Date().toISOString()}] Devengamiento: ${e.message}` }
                    });
                } catch (e2) {
                    log.error('devengamiento - No se pudo guardar el error en el registro', e2.message);
                }
                errores++;
            }
            return true;
        });

        log.audit('devengamiento', `Finalizado. Procesados: ${procesados} | Errores: ${errores}`);
    }

    function _buscarPlazosFijosActivos() {
        // Buscar directamente en el maestro: tipo = Plazo Fijo (1) y estado = Activa (1)
        return search.create({
            type: 'customrecord_sdb_inv_maestro',
            filters: [
                search.createFilter({
                    name: 'custrecord_sdb_inv_tipo',
                    operator: search.Operator.ANYOF,
                    values: ['1'] // Plazo Fijo
                }),
                search.createFilter({
                    name: 'custrecord_sdb_inv_estado',
                    operator: search.Operator.ANYOF,
                    values: ['1'] // Activa
                })
            ],
            columns: [
                'custrecord_sdb_inv_monto',
                'custrecord_sdb_inv_tna',
                'custrecord_sdb_inv_fecha_inicio',
                'custrecord_sdb_inv_fecha_fin',
                'custrecord_sdb_inv_subsidiaria',
                'custrecord_sdb_inv_moneda'
            ]
        }).run();
    }

    function _esBisiesto(anio) {
        return (anio % 4 === 0 && anio % 100 !== 0) || (anio % 400 === 0);
    }

    return { execute };
});
