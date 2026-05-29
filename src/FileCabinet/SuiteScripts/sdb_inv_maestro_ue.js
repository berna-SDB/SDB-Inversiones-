/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/search', 'N/runtime', 'N/log'], (record, search, runtime, log) => {

    const TIPO = {
        PLAZO_FIJO: '1',
        FCI: '2',
        BONO: '3',
        ACCIONES: '4',
        RENTA_VARIABLE: '5',
        EXTERIOR: '6'
    };

    const TIPO_NOMBRE = {
        '1': 'Plazo Fijo',
        '2': 'Fondo de Inversión',
        '3': 'Bono',
        '4': 'Acciones',
        '5': 'Renta Variable',
        '6': 'Exterior'
    };

    const ESTADO = {
        ACTIVA: '1',
        RESCATADA_PARCIAL: '2',
        CANCELADA: '3'
    };

    function beforeLoad(context) {
        if (context.type === context.UserEventType.VIEW || context.type === context.UserEventType.EDIT) {
            const rec = context.newRecord;
            const tipo = rec.getValue('custrecord_sdb_inv_tipo');
            _configurarVisibilidadCampos(context.form, tipo);

            const ultimoError = rec.getValue('custrecord_sdb_inv_ultimo_error');
            if (ultimoError) {
                context.form.addPageInitMessage({
                    type: 'ERROR',
                    title: 'Error en procesamiento contable',
                    message: ultimoError
                });
            }
        }
    }

    function beforeSubmit(context) {
        if (context.type === context.UserEventType.DELETE) return;
        // XEDIT = record.submitFields (lo usan los schedules). No correr derivaciones acá:
        // newRecord.getValue puede devolver vacío para campos no submitteados y terminaríamos
        // pisando valores correctos (ej. fecha_ult_calc calculada por devengamiento_mensual).
        if (context.type === context.UserEventType.XEDIT) return;

        const rec = context.newRecord;
        const tipo = rec.getValue('custrecord_sdb_inv_tipo');
        const fechaFin = rec.getValue('custrecord_sdb_inv_fecha_fin');
        const isCreate = context.type === context.UserEventType.CREATE;
        const esPF = tipo === TIPO.PLAZO_FIJO;
        let tipoOp = '';
        try { tipoOp = (rec.getText('custrecord_sdb_inv_tipo_operacion') || '').trim(); } catch (e) { /* getText puede fallar en CREATE si el valor no está resuelto todavía */ }

        const montoCompra = parseFloat(rec.getValue('custrecord_sdb_inv_monto_compra') || 0);
        const cotizCompra = parseFloat(rec.getValue('custrecord_sdb_inv_cotizacion_compra') || 0);

        // ─── RESCATE: validar cantidad de cuotapartes a rescatar antes de procesar
        if (!esPF && context.type === context.UserEventType.EDIT && context.oldRecord) {
            const cuotapRescate = parseFloat(rec.getValue('custrecord_sdb_inv_cuotapartes_rescate') || 0);
            const esRescate = tipoOp === 'Rescate' || cuotapRescate > 0;
            if (esRescate) {
                const cuotapartesActuales = parseFloat(context.oldRecord.getValue('custrecord_sdb_inv_cuotapartes') || 0);
                if (cuotapRescate <= 0) {
                    throw new Error('Rescate: indicá la cantidad de cuotapartes a rescatar.');
                }
                if (cuotapartesActuales > 0 && cuotapRescate > cuotapartesActuales) {
                    throw new Error(`Rescate: las cuotapartes a rescatar (${cuotapRescate}) exceden las disponibles (${cuotapartesActuales}).`);
                }
            }
        }

        // ─── COMPRA: driver = tipo_operacion=Compra, o CREATE legacy no-PF con campos de compra
        const esCompra = tipoOp === 'Compra' || (isCreate && !esPF && montoCompra > 0 && cotizCompra > 0);
        if (esCompra && montoCompra > 0 && cotizCompra > 0) {
            _aplicarCompraAlSumario(rec, isCreate, montoCompra, cotizCompra);
        }

        const cuotapartes = parseFloat(rec.getValue('custrecord_sdb_inv_cuotapartes') || 0);
        const valorCuotaIni = parseFloat(rec.getValue('custrecord_sdb_inv_valor_cuota_ini') || 0);
        const valorActual = parseFloat(rec.getValue('custrecord_sdb_inv_valor_actual') || 0);

        // ─── CREATE legacy sin bridge (cuotapartes + valor_cuota_ini cargados a mano)
        if (isCreate && !esCompra && cuotapartes > 0 && valorCuotaIni > 0) {
            const montoInicial = parseFloat((cuotapartes * valorCuotaIni).toFixed(2));
            rec.setValue('custrecord_sdb_inv_monto', montoInicial);
        }

        // ─── Monto actual = cuotapartes × valor_actual (valor de mercado)
        if (!esPF && cuotapartes > 0 && valorActual > 0) {
            const montoActual = parseFloat((cuotapartes * valorActual).toFixed(2));
            rec.setValue('custrecord_sdb_inv_monto_actual', montoActual);
        }

        // ─── Rentabilidad realizada
        const monto = parseFloat(rec.getValue('custrecord_sdb_inv_monto') || 0);
        const intDevengados = parseFloat(rec.getValue('custrecord_sdb_inv_int_devengados') || 0);
        const intCobrados = parseFloat(rec.getValue('custrecord_sdb_inv_int_cobrados') || 0);
        let rentabilidad = null;
        if (esPF) {
            if (monto > 0 && (intDevengados + intCobrados) > 0) {
                rentabilidad = ((intDevengados + intCobrados) / monto) * 100;
            }
        } else {
            if (valorCuotaIni > 0 && valorActual > 0) {
                rentabilidad = ((valorActual - valorCuotaIni) / valorCuotaIni) * 100;
            }
        }
        if (rentabilidad !== null) {
            rec.setValue('custrecord_sdb_inv_rent_realizada', parseFloat(rentabilidad.toFixed(4)));
        }

        if (!esPF) {
            rec.setValue('custrecord_sdb_inv_fecha_ult_calc', new Date());
        } else if (isCreate) {
            rec.setValue('custrecord_sdb_inv_fecha_ult_calc', null);
        }

        if (fechaFin && !rec.getValue('custrecord_sdb_inv_prox_venc')) {
            rec.setValue('custrecord_sdb_inv_prox_venc', fechaFin);
        }

        log.debug('beforeSubmit', `TipoInstr:${tipo} TipoOp:${tipoOp} Monto:${monto} VA:${valorActual} Cuotap:${cuotapartes} VCIni:${valorCuotaIni}`);
    }

    // ─── Aplica COMPRA al sumario (primera compra o compra adicional con promedio ponderado)
    function _aplicarCompraAlSumario(rec, isCreate, montoCompra, cotizCompra) {
        const cuotapartesNuevas = parseFloat((montoCompra / cotizCompra).toFixed(6));
        const cuotapartesExistentes = parseFloat(rec.getValue('custrecord_sdb_inv_cuotapartes') || 0);
        const montoExistente = parseFloat(rec.getValue('custrecord_sdb_inv_monto') || 0);
        const tipoCambio = parseFloat(rec.getValue('custrecord_sdb_inv_tipo_cambio') || 1);
        const montoPesosExistente = parseFloat(rec.getValue('custrecord_sdb_inv_monto_pesos') || 0);
        const montoCompraPesos = parseFloat((montoCompra * tipoCambio).toFixed(2));

        if (isCreate || cuotapartesExistentes <= 0) {
            rec.setValue('custrecord_sdb_inv_monto', montoCompra);
            rec.setValue('custrecord_sdb_inv_valor_cuota_ini', cotizCompra);
            rec.setValue('custrecord_sdb_inv_cuotapartes', cuotapartesNuevas);
            rec.setValue('custrecord_sdb_inv_monto_pesos', montoCompraPesos);
            log.debug('_aplicarCompraAlSumario', `Primera compra: monto=${montoCompra} cuotap=${cuotapartesNuevas} VCIni=${cotizCompra} TC=${tipoCambio} montoPesos=${montoCompraPesos}`);
        } else {
            const cuotapartesTotal = parseFloat((cuotapartesExistentes + cuotapartesNuevas).toFixed(6));
            const montoTotal = parseFloat((montoExistente + montoCompra).toFixed(2));
            const montoPesosTotal = parseFloat((montoPesosExistente + montoCompraPesos).toFixed(2));
            rec.setValue('custrecord_sdb_inv_monto', montoTotal);
            rec.setValue('custrecord_sdb_inv_cuotapartes', cuotapartesTotal);
            rec.setValue('custrecord_sdb_inv_monto_pesos', montoPesosTotal);
            log.debug('_aplicarCompraAlSumario', `Compra adic: +${montoCompra}/+${cuotapartesNuevas} TC=${tipoCambio} → monto=${montoTotal} cuotap=${cuotapartesTotal} montoPesos=${montoPesosTotal}`);
        }
    }

    function afterSubmit(context) {
        if (context.type === context.UserEventType.DELETE) {
            _eliminarJournalsAsociados(context.newRecord.id);
            return;
        }

        const rec = context.newRecord;
        const oldRec = context.oldRecord;
        const tipo = rec.getValue('custrecord_sdb_inv_tipo');
        const estado = rec.getValue('custrecord_sdb_inv_estado');
        const recId = rec.id;

        const isNew = context.type === context.UserEventType.CREATE;
        let tipoOp = '';
        try { tipoOp = (rec.getText('custrecord_sdb_inv_tipo_operacion') || '').trim(); } catch (e) { /* ídem beforeSubmit */ }
        const estadoAnterior = oldRec ? oldRec.getValue('custrecord_sdb_inv_estado') : null;
        const estadoCambio = !isNew && estadoAnterior !== estado;
        const montoCompra = parseFloat(rec.getValue('custrecord_sdb_inv_monto_compra') || 0);
        const cuotapartesRescate = parseFloat(rec.getValue('custrecord_sdb_inv_cuotapartes_rescate') || 0);
        const montoRescateLegacy = parseFloat(rec.getValue('custrecord_sdb_inv_monto_rescate') || 0);

        // Derivar acción por tipo_operacion (con fallback legacy)
        let accion = null;
        if (tipoOp === 'Compra') accion = 'COMPRA';
        else if (tipoOp === 'Rescate') accion = 'RESCATE';
        else if (tipoOp === 'Revaluación') accion = 'REVALUACION';
        else {
            if (isNew) accion = 'COMPRA';
            else if (estadoCambio && estado === ESTADO.CANCELADA) accion = 'CANCELACION';
            else if (cuotapartesRescate > 0 || montoRescateLegacy > 0) accion = 'RESCATE';
        }

        if (!accion) return;

        try {
            if (accion === 'COMPRA') {
                if (isNew) {
                    _generarAsientoConstitucion(rec, tipo);
                } else if (montoCompra > 0) {
                    _generarAsientoCompraAdicional(rec, tipo, montoCompra);
                }
                _limpiarCamposCompra(recId, tipo, isNew);
            } else if (accion === 'RESCATE') {
                _procesarRescate(rec, recId, tipo, cuotapartesRescate, montoRescateLegacy);
            } else if (accion === 'REVALUACION') {
                _procesarRevaluacion(rec, oldRec, recId, tipo);
            } else if (accion === 'CANCELACION') {
                _generarAsientoCancelacion(rec, tipo);
                // Mover intereses devengados a cobrados (quedan saldados contra banco en el JE final).
                const lookup = search.lookupFields({
                    type: 'customrecord_sdb_inv_maestro',
                    id: recId,
                    columns: ['custrecord_sdb_inv_int_devengados', 'custrecord_sdb_inv_int_cobrados']
                });
                const intDev = parseFloat(lookup.custrecord_sdb_inv_int_devengados || 0);
                const intCob = parseFloat(lookup.custrecord_sdb_inv_int_cobrados || 0);
                record.submitFields({
                    type: 'customrecord_sdb_inv_maestro',
                    id: recId,
                    values: {
                        custrecord_sdb_inv_cuotapartes: 0,
                        custrecord_sdb_inv_monto_actual: 0,
                        custrecord_sdb_inv_valor_actual: 0,
                        custrecord_sdb_inv_cuotapartes_rescate: 0,
                        custrecord_sdb_inv_monto_rescate: 0,
                        custrecord_sdb_inv_int_devengados: 0,
                        custrecord_sdb_inv_int_cobrados: parseFloat((intCob + intDev).toFixed(2))
                    }
                });
            }

            record.submitFields({
                type: 'customrecord_sdb_inv_maestro',
                id: recId,
                values: { custrecord_sdb_inv_ultimo_error: '' }
            });
        } catch (e) {
            log.error('afterSubmit - Error', e.message);
            try {
                record.submitFields({
                    type: 'customrecord_sdb_inv_maestro',
                    id: recId,
                    values: { custrecord_sdb_inv_ultimo_error: `[${new Date().toISOString()}] ${e.message}` }
                });
            } catch (e2) {
                log.error('afterSubmit - No se pudo guardar el error en el registro', e2.message);
            }
        }
    }

    function _limpiarCamposCompra(recId, tipo, isNew) {
        const values = { custrecord_sdb_inv_tipo_operacion: null };
        if (tipo !== TIPO.PLAZO_FIJO) {
            values.custrecord_sdb_inv_monto_compra = 0;
            values.custrecord_sdb_inv_fecha_compra = null;
            values.custrecord_sdb_inv_cotizacion_compra = 0;
            values.custrecord_sdb_inv_costos_compra = 0;
            values.custrecord_sdb_inv_cuotapartes_compra = 0;
        }
        record.submitFields({ type: 'customrecord_sdb_inv_maestro', id: recId, values });
    }

    function _procesarRescate(rec, recId, tipo, cuotapartesRescate, montoRescateLegacy) {
        const cuotapartesActuales = parseFloat(rec.getValue('custrecord_sdb_inv_cuotapartes') || 0);
        const cotizRescate = parseFloat(rec.getValue('custrecord_sdb_inv_valor_cuota_rescate') || 0);
        const valorActual = parseFloat(rec.getValue('custrecord_sdb_inv_valor_actual') || 0);
        const montoLibro = parseFloat(rec.getValue('custrecord_sdb_inv_monto') || 0);
        const tipoCambioRescate = parseFloat(rec.getValue('custrecord_sdb_inv_tipo_cambio') || 1);
        const montoPesosActual = parseFloat(rec.getValue('custrecord_sdb_inv_monto_pesos') || 0);

        if (cuotapartesRescate > 0) {
            if (cuotapartesRescate > cuotapartesActuales) {
                throw new Error(`Rescate: cuotapartes a rescatar (${cuotapartesRescate}) excede las disponibles (${cuotapartesActuales}).`);
            }
            if (cotizRescate <= 0) {
                throw new Error('Rescate: informá la Cotización de Rescate (Valor Cuota Rescate) para calcular el monto.');
            }

            const montoRescatado = parseFloat((cuotapartesRescate * cotizRescate).toFixed(2));
            const montoRescatadoPesos = parseFloat((montoRescatado * tipoCambioRescate).toFixed(2));
            const nuevasCuotapartes = parseFloat((cuotapartesActuales - cuotapartesRescate).toFixed(6));
            const pctRescatado = cuotapartesRescate / cuotapartesActuales;
            const nuevoMontoLibro = parseFloat((montoLibro * (1 - pctRescatado)).toFixed(2));
            // monto_pesos en libros proporcional al rescate (preserva TC histórico de la compra).
            // La diferencia entre TC compra y TC rescate se asienta con revaluacion_moneda.
            const nuevoMontoPesos = parseFloat((montoPesosActual * (1 - pctRescatado)).toFixed(2));

            if (nuevasCuotapartes <= 0) {
                _generarAsientoCancelacion(rec, tipo);
                record.submitFields({
                    type: 'customrecord_sdb_inv_maestro',
                    id: recId,
                    values: {
                        custrecord_sdb_inv_cuotapartes: 0,
                        custrecord_sdb_inv_monto: 0,
                        custrecord_sdb_inv_monto_pesos: 0,
                        custrecord_sdb_inv_monto_actual: 0,
                        custrecord_sdb_inv_cuotapartes_rescate: 0,
                        custrecord_sdb_inv_monto_rescate: 0,
                        custrecord_sdb_inv_valor_cuota_rescate: 0,
                        custrecord_sdb_inv_estado: ESTADO.CANCELADA,
                        custrecord_sdb_inv_tipo_operacion: null
                    }
                });
            } else {
                _generarAsientoRescateParcial(rec, montoRescatado);
                // monto_actual preserva la valuación a valor_actual (revaluación), no a cotiz de rescate
                const cotizValuacion = valorActual > 0 ? valorActual : cotizRescate;
                const nuevoMontoActual = parseFloat((nuevasCuotapartes * cotizValuacion).toFixed(2));
                record.submitFields({
                    type: 'customrecord_sdb_inv_maestro',
                    id: recId,
                    values: {
                        custrecord_sdb_inv_cuotapartes: nuevasCuotapartes,
                        custrecord_sdb_inv_monto: nuevoMontoLibro,
                        custrecord_sdb_inv_monto_pesos: nuevoMontoPesos,
                        custrecord_sdb_inv_monto_actual: nuevoMontoActual,
                        custrecord_sdb_inv_cuotapartes_rescate: 0,
                        custrecord_sdb_inv_monto_rescate: 0,
                        custrecord_sdb_inv_valor_cuota_rescate: 0,
                        custrecord_sdb_inv_estado: ESTADO.RESCATADA_PARCIAL,
                        custrecord_sdb_inv_tipo_operacion: null
                    }
                });
            }
        } else if (montoRescateLegacy > 0) {
            _generarAsientoRescateParcial(rec, montoRescateLegacy);
            record.submitFields({
                type: 'customrecord_sdb_inv_maestro',
                id: recId,
                values: {
                    custrecord_sdb_inv_monto_rescate: 0,
                    custrecord_sdb_inv_valor_cuota_rescate: 0,
                    custrecord_sdb_inv_estado: ESTADO.RESCATADA_PARCIAL,
                    custrecord_sdb_inv_tipo_operacion: null
                }
            });
        } else {
            throw new Error('Rescate: informá cuotapartes a rescatar o monto a rescatar.');
        }
    }

    // ─── Revaluación: ajusta el activo a la nueva cotización y registra ganancia/pérdida ──

    function _procesarRevaluacion(rec, oldRec, recId, tipo) {
        if (tipo === TIPO.PLAZO_FIJO) {
            throw new Error('Revaluación: no aplica a Plazo Fijo.');
        }
        if (!oldRec) {
            throw new Error('Revaluación: solo aplica en edición de inversiones existentes.');
        }

        const cuotapartes = parseFloat(rec.getValue('custrecord_sdb_inv_cuotapartes') || 0);
        const cotizPrev = parseFloat(oldRec.getValue('custrecord_sdb_inv_valor_actual') || 0);
        const cotizNueva = parseFloat(rec.getValue('custrecord_sdb_inv_valor_actual') || 0);
        const ctaActivo = rec.getValue('custrecord_sdb_inv_cta_activo');
        const subsidiaria = rec.getValue('custrecord_sdb_inv_subsidiaria');
        const moneda = rec.getValue('custrecord_sdb_inv_moneda');
        const contrato = rec.getValue('custrecord_sdb_inv_contrato') || recId;
        const institucion = _obtenerNombreInstitucion(rec);

        if (cuotapartes <= 0) throw new Error('Revaluación: la inversión no tiene cuotapartes.');
        if (cotizNueva <= 0) throw new Error('Revaluación: informá la nueva cotización en Valor Actual.');
        if (!ctaActivo) throw new Error('Revaluación: la inversión no tiene cuenta de Activo configurada.');

        const script = runtime.getCurrentScript();
        const ctaGanancia = script.getParameter({ name: 'custscript_sdb_inv_cta_rev_ganancia' });
        const ctaPerdida = script.getParameter({ name: 'custscript_sdb_inv_cta_rev_perdida' });
        if (!ctaGanancia || !ctaPerdida) {
            throw new Error('Revaluación: configurá las cuentas de Ganancia y Pérdida en el deployment del User Event.');
        }

        const cotizBase = cotizPrev > 0 ? cotizPrev : parseFloat(oldRec.getValue('custrecord_sdb_inv_valor_cuota_ini') || 0);
        const montoAnterior = parseFloat((cuotapartes * cotizBase).toFixed(2));
        const montoNuevo = parseFloat((cuotapartes * cotizNueva).toFixed(2));
        const diferencia = parseFloat((montoNuevo - montoAnterior).toFixed(2));

        if (Math.abs(diferencia) < 0.01) {
            record.submitFields({
                type: 'customrecord_sdb_inv_maestro',
                id: recId,
                values: {
                    custrecord_sdb_inv_monto_actual: montoNuevo,
                    custrecord_sdb_inv_valor_cuota_ini: cotizNueva,
                    custrecord_sdb_inv_fecha_ult_calc: new Date(),
                    custrecord_sdb_inv_tipo_operacion: null
                }
            });
            return;
        }

        const ganancia = diferencia > 0;
        const abs = Math.abs(diferencia);
        const signo = ganancia ? 'GANANCIA' : 'PÉRDIDA';
        const ctaResultado = ganancia ? ctaGanancia : ctaPerdida;
        const tipoText = _obtenerTipoTexto(tipo);

        const je = record.create({ type: record.Type.JOURNAL_ENTRY, isDynamic: true });
        if (subsidiaria) je.setValue('subsidiary', subsidiaria);
        if (moneda) je.setValue('currency', moneda);
        je.setValue('memo', `[REVALUACIÓN ${signo}] ${tipoText} | Cotiz: ${cotizNueva} | ${institucion} | Cto: ${contrato} | Inv. ${recId}`);
        je.setValue('custbody_sdb_inv_inversion', recId);

        if (ganancia) {
            je.selectNewLine({ sublistId: 'line' });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: ctaActivo });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'debit', value: abs });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: `Revaluación GANANCIA - Ajuste Activo | Inv. ${recId}` });
            je.commitLine({ sublistId: 'line' });

            je.selectNewLine({ sublistId: 'line' });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: ctaResultado });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'credit', value: abs });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: `Revaluación GANANCIA - Diferencia | Inv. ${recId}` });
            je.commitLine({ sublistId: 'line' });
        } else {
            je.selectNewLine({ sublistId: 'line' });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: ctaResultado });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'debit', value: abs });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: `Revaluación PÉRDIDA - Diferencia | Inv. ${recId}` });
            je.commitLine({ sublistId: 'line' });

            je.selectNewLine({ sublistId: 'line' });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: ctaActivo });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'credit', value: abs });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: `Revaluación PÉRDIDA - Ajuste Activo | Inv. ${recId}` });
            je.commitLine({ sublistId: 'line' });
        }

        const jeId = je.save();
        log.audit('_procesarRevaluacion', `Inv ${recId}: ${cotizBase}→${cotizNueva} | Dif: ${diferencia} | JE: ${jeId}`);

        record.submitFields({
            type: 'customrecord_sdb_inv_maestro',
            id: recId,
            values: {
                custrecord_sdb_inv_monto_actual: montoNuevo,
                custrecord_sdb_inv_valor_cuota_ini: cotizNueva,
                custrecord_sdb_inv_fecha_ult_calc: new Date(),
                custrecord_sdb_inv_tipo_operacion: null
            }
        });
    }

    // ─── Visibilidad de campos según tipo ───────────────────────────────────────

    function _configurarVisibilidadCampos(form, tipo) {
        const esPF = tipo === TIPO.PLAZO_FIJO;
        const esFCI = tipo === TIPO.FCI;
        const esBONO = tipo === TIPO.BONO;
        const esACC = tipo === TIPO.ACCIONES;
        const esRV = tipo === TIPO.RENTA_VARIABLE;

        // Mapeo campo -> tipos que lo usan. Si el tipo actual no está en el array, se oculta.
        const VISIBILIDAD_POR_CAMPO = {
            // Cuotapartes: FCI, Acciones, RV, Exterior
            'custrecord_sdb_inv_cuotapartes':          [TIPO.FCI, TIPO.ACCIONES, TIPO.RENTA_VARIABLE, TIPO.EXTERIOR],
            'custrecord_sdb_inv_valor_cuota_ini':      [TIPO.FCI, TIPO.ACCIONES, TIPO.RENTA_VARIABLE, TIPO.EXTERIOR],
            'custrecord_sdb_inv_monto_actual':         [TIPO.FCI, TIPO.ACCIONES, TIPO.RENTA_VARIABLE, TIPO.EXTERIOR],
            'custrecord_sdb_inv_cuotapartes_rescate':  [TIPO.FCI, TIPO.ACCIONES, TIPO.RENTA_VARIABLE, TIPO.EXTERIOR],
            // Plazo Fijo
            'custrecord_sdb_inv_tna':                  [TIPO.PLAZO_FIJO],
            'custrecord_sdb_inv_dias':                 [TIPO.PLAZO_FIJO],
            'custrecord_sdb_inv_subtipo_pf':           [TIPO.PLAZO_FIJO],
            'custrecord_sdb_inv_cuenta_inversora':     [TIPO.PLAZO_FIJO],
            'custrecord_sdb_inv_cta_intereses':        [TIPO.PLAZO_FIJO],
            'custrecord_sdb_inv_int_devengados':       [TIPO.PLAZO_FIJO],
            'custrecord_sdb_inv_int_cobrados':         [TIPO.PLAZO_FIJO],
            // FCI
            'custrecord_sdb_inv_subtipo_fci':          [TIPO.FCI],
            'custrecord_sdb_inv_cuenta_comitente':     [TIPO.PLAZO_FIJO, TIPO.FCI, TIPO.BONO, TIPO.ACCIONES, TIPO.RENTA_VARIABLE, TIPO.EXTERIOR],
            // Bono
            'custrecord_sdb_inv_cantidad_titulos':     [TIPO.BONO],
            'custrecord_sdb_inv_cotizacion_titulo':    [TIPO.BONO],
            'custrecord_sdb_inv_isin':                 [TIPO.BONO],
            // Renta Variable
            'custrecord_sdb_inv_subtipo_rv':           [TIPO.RENTA_VARIABLE],
            // Exterior
            'custrecord_sdb_inv_subtipo_exterior':     [TIPO.EXTERIOR]
        };

        if (!tipo) return; // Sin tipo no hacemos nada

        Object.keys(VISIBILIDAD_POR_CAMPO).forEach(fieldId => {
            const tiposPermitidos = VISIBILIDAD_POR_CAMPO[fieldId];
            if (tiposPermitidos.indexOf(tipo) === -1) {
                try { form.getField(fieldId).updateDisplayType({ displayType: 'hidden' }); } catch (e) {}
            }
        });
    }

    // ─── Helpers para obtener textos sin getText (evita error de API) ──────────

    function _obtenerNombreInstitucion(rec) {
        const instId = rec.getValue('custrecord_sdb_inv_institucion');
        if (!instId) return '';
        try {
            const result = search.lookupFields({
                type: 'customrecord_sdb_inv_inst_financiera',
                id: instId,
                columns: ['name']
            });
            return result.name || '';
        } catch (e) {
            return String(instId);
        }
    }

    function _obtenerTipoTexto(tipo) {
        return TIPO_NOMBRE[String(tipo)] || '';
    }

    // ─── Obtener cuenta de banco (del registro o fallback al parámetro) ─────────

    function _obtenerCtaBanco(rec) {
        const ctaBancoRegistro = rec.getValue('custrecord_sdb_inv_cta_banco');
        if (ctaBancoRegistro) return ctaBancoRegistro;

        // Para PF el sourceo de la institución guarda la cuenta bancaria en cta_resultado (legacy CS)
        const tipo = rec.getValue('custrecord_sdb_inv_tipo');
        if (tipo === TIPO.PLAZO_FIJO) {
            const ctaResultado = rec.getValue('custrecord_sdb_inv_cta_resultado');
            if (ctaResultado) return ctaResultado;
        }

        const script = runtime.getCurrentScript();
        return script.getParameter('custscript_sdb_inv_cta_banco');
    }

    // ─── Generación de asientos ─────────────────────────────────────────────────

    function _generarAsientoConstitucion(rec, tipo) {
        const ctaBanco = _obtenerCtaBanco(rec);
        const ctaActivo = rec.getValue('custrecord_sdb_inv_cta_activo');
        const monto = parseFloat(rec.getValue('custrecord_sdb_inv_monto') || 0);
        const subsidiaria = rec.getValue('custrecord_sdb_inv_subsidiaria');
        const moneda = rec.getValue('custrecord_sdb_inv_moneda');
        const contrato = rec.getValue('custrecord_sdb_inv_contrato') || rec.id;
        const institucion = _obtenerNombreInstitucion(rec);
        const tipoText = _obtenerTipoTexto(tipo);
        const fechaCompra = rec.getValue('custrecord_sdb_inv_fecha_compra');
        const tipoCambio = parseFloat(rec.getValue('custrecord_sdb_inv_tipo_cambio') || 0);

        if (!ctaBanco || !ctaActivo || monto <= 0) {
            throw new Error('Constitución: faltan cuentas contables configuradas (Banco o Activo) o el monto es 0.');
        }

        const je = record.create({ type: record.Type.JOURNAL_ENTRY, isDynamic: true });
        je.setValue('subsidiary', subsidiaria);
        je.setValue('currency', moneda);
        if (fechaCompra) je.setValue('trandate', fechaCompra);
        if (tipoCambio > 0) je.setValue('exchangerate', tipoCambio);
        je.setValue('memo', `[COMPRA] ${tipoText} | ${institucion} | Cto: ${contrato}`);
        je.setValue('custbody_sdb_inv_inversion', rec.id);

        // Debe: Activo (inversión)
        je.selectNewLine({ sublistId: 'line' });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: ctaActivo });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'debit', value: monto });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: `Compra ${tipoText} - Activo | Cto: ${contrato}` });
        je.commitLine({ sublistId: 'line' });

        // Haber: Banco
        je.selectNewLine({ sublistId: 'line' });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: ctaBanco });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'credit', value: monto });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: `Compra ${tipoText} - Salida de Fondos | Cto: ${contrato}` });
        je.commitLine({ sublistId: 'line' });

        const jeId = je.save();
        log.audit('_generarAsientoConstitucion', `Journal Entry creado: ${jeId}`);
    }

    function _generarAsientoCompraAdicional(rec, tipo, montoCompra) {
        const ctaBanco = _obtenerCtaBanco(rec);
        const ctaActivo = rec.getValue('custrecord_sdb_inv_cta_activo');
        const subsidiaria = rec.getValue('custrecord_sdb_inv_subsidiaria');
        const moneda = rec.getValue('custrecord_sdb_inv_moneda');
        const contrato = rec.getValue('custrecord_sdb_inv_contrato') || rec.id;
        const institucion = _obtenerNombreInstitucion(rec);
        const tipoText = _obtenerTipoTexto(tipo);
        const fechaCompra = rec.getValue('custrecord_sdb_inv_fecha_compra');
        const tipoCambio = parseFloat(rec.getValue('custrecord_sdb_inv_tipo_cambio') || 0);

        if (!ctaBanco || !ctaActivo || montoCompra <= 0) {
            throw new Error('Compra adicional: faltan cuentas contables (Banco o Activo) o el monto es 0.');
        }

        const je = record.create({ type: record.Type.JOURNAL_ENTRY, isDynamic: true });
        je.setValue('subsidiary', subsidiaria);
        je.setValue('currency', moneda);
        if (fechaCompra) je.setValue('trandate', fechaCompra);
        if (tipoCambio > 0) je.setValue('exchangerate', tipoCambio);
        je.setValue('memo', `[COMPRA] ${tipoText} (adicional) | ${institucion} | Cto: ${contrato}`);
        je.setValue('custbody_sdb_inv_inversion', rec.id);

        je.selectNewLine({ sublistId: 'line' });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: ctaActivo });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'debit', value: montoCompra });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: `Compra ${tipoText} - Activo (adicional) | Cto: ${contrato}` });
        je.commitLine({ sublistId: 'line' });

        je.selectNewLine({ sublistId: 'line' });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: ctaBanco });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'credit', value: montoCompra });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: `Compra ${tipoText} - Salida de Fondos (adicional) | Cto: ${contrato}` });
        je.commitLine({ sublistId: 'line' });

        const jeId = je.save();
        log.audit('_generarAsientoCompraAdicional', `JE creado: ${jeId} | Monto: ${montoCompra}`);
    }

    function _generarAsientoCancelacion(rec, tipo) {
        // En XEDIT (cambio de estado vía submitFields del schedule de vencimiento),
        // context.newRecord no tiene los campos no-submitteados. Cargamos el record completo.
        const full = record.load({ type: 'customrecord_sdb_inv_maestro', id: rec.id });
        const tipoActual = tipo || full.getValue('custrecord_sdb_inv_tipo');
        const ctaBanco = _obtenerCtaBanco(full);
        const ctaActivo = full.getValue('custrecord_sdb_inv_cta_activo');
        const ctaResultado = full.getValue('custrecord_sdb_inv_cta_resultado');
        const ctaIntDevengados = full.getValue('custrecord_sdb_inv_cta_int_devengados');
        const esPF = tipoActual === TIPO.PLAZO_FIJO;

        const monto = parseFloat(full.getValue('custrecord_sdb_inv_monto') || 0);
        const montoActual = parseFloat(full.getValue('custrecord_sdb_inv_monto_actual') || monto);
        const intDevengados = parseFloat(full.getValue('custrecord_sdb_inv_int_devengados') || 0);

        // Para FCI/Títulos: la cotización de rescate viene de valor_cuota_rescate;
        // valor_actual es el valor de mercado por última revaluación (fallback si no hay rescate)
        const cuotapartes = parseFloat(full.getValue('custrecord_sdb_inv_cuotapartes') || 0);
        const valorCuotaRescate = parseFloat(full.getValue('custrecord_sdb_inv_valor_cuota_rescate') || 0);
        const valorActualCuota = valorCuotaRescate > 0
            ? valorCuotaRescate
            : parseFloat(full.getValue('custrecord_sdb_inv_valor_actual') || 0);

        let valorCobrado = 0;
        if (!esPF && cuotapartes > 0 && valorActualCuota > 0) {
            valorCobrado = parseFloat((cuotapartes * valorActualCuota).toFixed(2));
        } else if (valorActualCuota > 0) {
            // Para PF, valor_actual se usa como monto total directo
            valorCobrado = valorActualCuota;
        } else {
            valorCobrado = monto;
        }

        // Base del activo a dar de baja
        const baseActivo = esPF ? monto : montoActual;

        const subsidiaria = full.getValue('custrecord_sdb_inv_subsidiaria');
        const moneda = full.getValue('custrecord_sdb_inv_moneda');
        const contrato = full.getValue('custrecord_sdb_inv_contrato') || rec.id;
        const institucion = _obtenerNombreInstitucion(full);
        const tipoText = _obtenerTipoTexto(tipoActual);

        if (!ctaBanco || !ctaActivo) {
            throw new Error('Cancelación: faltan cuentas contables configuradas (Banco o Activo).');
        }
        if (esPF && intDevengados > 0 && !ctaIntDevengados) {
            throw new Error('Cancelacion PF: falta la cuenta de Intereses Devengados para dar de baja los intereses ya reconocidos.');
        }

        const je = record.create({ type: record.Type.JOURNAL_ENTRY, isDynamic: true });
        je.setValue('subsidiary', subsidiaria);
        je.setValue('currency', moneda);
        if (esPF) {
            const fechaFin = full.getValue('custrecord_sdb_inv_fecha_fin');
            if (fechaFin) je.setValue('trandate', fechaFin);
        } else {
            const fechaRescate = full.getValue('custrecord_sdb_inv_fecha_rescate');
            if (fechaRescate) je.setValue('trandate', fechaRescate);
            const tipoCambioFull = parseFloat(full.getValue('custrecord_sdb_inv_tipo_cambio') || 0);
            if (tipoCambioFull > 0) je.setValue('exchangerate', tipoCambioFull);
        }
        je.setValue('memo', `[RESCATE] ${tipoText} (total) | ${institucion} | Cto: ${contrato}`);
        je.setValue('custbody_sdb_inv_inversion', rec.id);

        const totalCobrado = esPF && valorActualCuota <= 0
            ? parseFloat((baseActivo + intDevengados).toFixed(2))
            : parseFloat((valorCobrado + (esPF ? 0 : intDevengados)).toFixed(2));
        const interesesDevengadosABajar = esPF ? intDevengados : 0;
        const diferencia = parseFloat((totalCobrado - baseActivo - interesesDevengadosABajar).toFixed(2));

        // Debe: Banco
        je.selectNewLine({ sublistId: 'line' });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: ctaBanco });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'debit', value: totalCobrado });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: `Rescate ${tipoText} - Cobro${esPF ? ' Capital + Intereses' : ''} | Cto: ${contrato}` });
        je.commitLine({ sublistId: 'line' });

        // Haber: Activo
        je.selectNewLine({ sublistId: 'line' });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: ctaActivo });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'credit', value: baseActivo });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: `Rescate ${tipoText} - Baja Activo | Cto: ${contrato}` });
        je.commitLine({ sublistId: 'line' });

        // Resultado: ganancia (H) o pérdida (D)
        // Haber: Intereses devengados. Evita reconocer otra vez como resultado lo ya devengado.
        if (interesesDevengadosABajar > 0) {
            je.selectNewLine({ sublistId: 'line' });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: ctaIntDevengados });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'credit', value: interesesDevengadosABajar });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: `Rescate ${tipoText} - Baja Intereses Devengados | Cto: ${contrato}` });
            je.commitLine({ sublistId: 'line' });
        }

        if (ctaResultado && diferencia !== 0) {
            je.selectNewLine({ sublistId: 'line' });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: ctaResultado });
            if (diferencia > 0) {
                je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'credit', value: diferencia });
                je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: `Rescate ${tipoText} - Ganancia | Cto: ${contrato}` });
            } else {
                je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'debit', value: Math.abs(diferencia) });
                je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: `Rescate ${tipoText} - Pérdida | Cto: ${contrato}` });
            }
            je.commitLine({ sublistId: 'line' });
        }

        const jeId = je.save();
        log.audit('_generarAsientoCancelacion', `JE: ${jeId} | Cobrado: ${totalCobrado} | Activo: ${baseActivo} | IntDev: ${interesesDevengadosABajar} | Diff: ${diferencia}`);
    }

    function _generarAsientoRescateParcial(rec, montoRescatado) {
        const ctaBanco = _obtenerCtaBanco(rec);
        const ctaActivo = rec.getValue('custrecord_sdb_inv_cta_activo');
        const subsidiaria = rec.getValue('custrecord_sdb_inv_subsidiaria');
        const moneda = rec.getValue('custrecord_sdb_inv_moneda');
        const contrato = rec.getValue('custrecord_sdb_inv_contrato') || rec.id;
        const institucion = _obtenerNombreInstitucion(rec);
        const tipoText = _obtenerTipoTexto(rec.getValue('custrecord_sdb_inv_tipo'));
        const fechaRescate = rec.getValue('custrecord_sdb_inv_fecha_rescate');
        const tipoCambio = parseFloat(rec.getValue('custrecord_sdb_inv_tipo_cambio') || 0);

        if (!ctaBanco || !ctaActivo || montoRescatado <= 0) {
            throw new Error('Rescate parcial: faltan cuentas contables (Banco o Activo) o el monto a rescatar es 0.');
        }

        const je = record.create({ type: record.Type.JOURNAL_ENTRY, isDynamic: true });
        je.setValue('subsidiary', subsidiaria);
        je.setValue('currency', moneda);
        if (fechaRescate) je.setValue('trandate', fechaRescate);
        if (tipoCambio > 0) je.setValue('exchangerate', tipoCambio);
        je.setValue('memo', `[RESCATE] ${tipoText} (parcial) | ${institucion} | Cto: ${contrato}`);
        je.setValue('custbody_sdb_inv_inversion', rec.id);

        je.selectNewLine({ sublistId: 'line' });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: ctaBanco });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'debit', value: montoRescatado });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: `Rescate ${tipoText} (parcial) - Cobro Fondos | Cto: ${contrato}` });
        je.commitLine({ sublistId: 'line' });

        je.selectNewLine({ sublistId: 'line' });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: ctaActivo });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'credit', value: montoRescatado });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: `Rescate ${tipoText} (parcial) - Reducción Activo | Cto: ${contrato}` });
        je.commitLine({ sublistId: 'line' });

        const jeId = je.save();
        log.audit('_generarAsientoRescateParcial', `Journal Entry creado: ${jeId}`);
    }

    function _eliminarJournalsAsociados(invId) {
        const resultados = search.create({
            type: search.Type.JOURNAL_ENTRY,
            filters: [
                search.createFilter({ name: 'custbody_sdb_inv_inversion', operator: search.Operator.IS, values: [invId] })
            ],
            columns: ['internalid']
        }).run().getRange({ start: 0, end: 1000 });

        let eliminados = 0;
        let errores = 0;
        resultados.forEach(result => {
            try {
                record.delete({ type: record.Type.JOURNAL_ENTRY, id: result.id });
                eliminados++;
            } catch (e) {
                log.error('_eliminarJournalsAsociados', `Error al eliminar JE ${result.id}: ${e.message}`);
                errores++;
            }
        });

        log.audit('_eliminarJournalsAsociados', `Inversión ${invId} eliminada. JEs eliminados: ${eliminados} | Errores: ${errores}`);
    }

    return { beforeLoad, beforeSubmit, afterSubmit };
});
