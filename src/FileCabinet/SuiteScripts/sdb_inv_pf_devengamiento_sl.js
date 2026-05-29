/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * Suitelet de Plazos Fijos: lista PFs activos con resumen y permite
 * ejecutar devengamiento de intereses on-demand (replica lógica del SS mensual).
 */
define(['N/ui/serverWidget', 'N/search', 'N/record', 'N/runtime', 'N/log', 'N/format', 'N/url'],
(serverWidget, search, record, runtime, log, format, url) => {

    const TIPO_PF = '1';
    const ESTADO_ACTIVA = '1';

    function onRequest(context) {
        let resultadoMsg = '';
        if (context.request.method === 'POST') {
            try {
                const accion = context.request.parameters.custpage_accion || 'devengar';
                if (accion === 'cobrar') {
                    resultadoMsg = procesarCobro(context);
                } else {
                    const soloCalculo = accion === 'calcular';
                    resultadoMsg = procesarDevengamiento(context, soloCalculo);
                }
            } catch (e) {
                log.error('onRequest POST', e.message + ' | ' + (e.stack || ''));
                resultadoMsg = `<span style="color:#c62828;">ERROR: ${escapeHtml(e.message)}</span>`;
            }
        }
        mostrarForm(context, resultadoMsg);
    }

    function mostrarForm(context, resultadoMsg) {
        const form = serverWidget.createForm({ title: 'Plazos Fijos - Devengamiento de Intereses' });

        const accionField = form.addField({
            id: 'custpage_accion',
            type: serverWidget.FieldType.SELECT,
            label: 'Acción'
        });
        accionField.addSelectOption({ value: 'calcular', text: 'Calcular (solo previsualizar, no asienta)', isSelected: true });
        accionField.addSelectOption({ value: 'devengar', text: 'Devengar (calcular + crear JE + actualizar inversión)' });
        accionField.addSelectOption({ value: 'cobrar', text: 'Cobrar Intereses Devengados (D Banco / H Int. Devengados)' });
        accionField.isMandatory = true;
        accionField.updateLayoutType({ layoutType: serverWidget.FieldLayoutType.STARTROW });

        const fechaField = form.addField({
            id: 'custpage_fecha_corte',
            type: serverWidget.FieldType.DATE,
            label: 'Fecha de Corte'
        });
        fechaField.isMandatory = true;
        fechaField.defaultValue = _ultimoDiaDelMes(new Date());
        fechaField.updateLayoutType({ layoutType: serverWidget.FieldLayoutType.STARTROW });

        const tablaField = form.addField({
            id: 'custpage_tabla',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' '
        });
        tablaField.updateLayoutType({ layoutType: serverWidget.FieldLayoutType.OUTSIDEBELOW });
        tablaField.updateBreakType({ breakType: serverWidget.FieldBreakType.STARTROW });

        const pfs = _buscarPFsActivos();
        const hoy = _normalizeDate(new Date());

        let header = '<div style="padding:0 4px;">';
        if (resultadoMsg) {
            header += `<div style="padding:10px 14px;margin:8px 0;border:1px solid #c9cdd4;background:#f5f6f8;font-size:14px;"><b>Resultado:</b> ${resultadoMsg}</div>`;
        }
        header += `<div style="padding:8px 14px;margin:8px 0;border:1px solid #c9cdd4;background:#fafbfc;font-size:13px;color:#444;">
            Lista <b>${pfs.length}</b> PFs activos. Seleccioná los que querés devengar y presioná <b>Devengar Intereses</b>.
            El cálculo genera JE: <i>D Cta Int. Devengados / H Cta Intereses Ganados</i> proporcional al período desde la última fecha de cálculo.
        </div></div>`;

        if (pfs.length === 0) {
            tablaField.defaultValue = header + '<div style="padding:20px;">No hay Plazos Fijos activos.</div>';
        } else {
            let html = `<style>
                .pf-tbl{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px;}
                .pf-tbl th,.pf-tbl td{border:1px solid #c9cdd4;padding:6px 8px;text-align:left;vertical-align:top;}
                .pf-tbl th{background:#f4f6f8;font-weight:600;color:#222;}
                .pf-tbl .num{text-align:right;font-variant-numeric:tabular-nums;}
                .pf-tbl tr.vencido td{background:#fde2e4;}
                .pf-tbl tr.proxvenc td{background:#fff4cc;}
            </style>
            <table class="pf-tbl">
                <thead><tr>
                    <th><input type="checkbox" id="chk_all" onclick="document.querySelectorAll('input[name^=chk_]').forEach(c=>c.checked=this.checked)" /></th>
                    <th>ID</th><th>Nombre</th><th>Institución</th><th>Moneda</th>
                    <th class="num">Monto</th><th class="num">TNA %</th>
                    <th>Fecha Inicio</th><th>Fecha Fin</th>
                    <th>Últ. Cálculo</th><th class="num">Int. Devengados</th>
                    <th class="num">Días Restantes</th>
                </tr></thead><tbody>`;

            pfs.forEach(pf => {
                let invUrl = '';
                try {
                    invUrl = url.resolveRecord({ recordType: 'customrecord_sdb_inv_maestro', recordId: pf.id, isEditMode: false });
                } catch (e) {}
                const idCell = invUrl ? `<a href="${invUrl}" target="_blank">${pf.id}</a>` : pf.id;
                const nombreCell = invUrl ? `<a href="${invUrl}" target="_blank">${escapeHtml(pf.nombre)}</a>` : escapeHtml(pf.nombre);

                const fechaFin = _parse(pf.fechaFin);
                let claseFila = '';
                let diasRest = '';
                if (fechaFin) {
                    const dr = _diasEntre(hoy, fechaFin);
                    diasRest = String(dr);
                    if (dr < 0) claseFila = 'vencido';
                    else if (dr <= 7) claseFila = 'proxvenc';
                }

                html += `<tr class="${claseFila}">
                    <td style="text-align:center;"><input type="checkbox" name="chk_${pf.id}" value="1" /></td>
                    <td>${idCell}</td>
                    <td>${nombreCell}</td>
                    <td>${escapeHtml(pf.institucion)}</td>
                    <td>${escapeHtml(pf.moneda)}</td>
                    <td class="num">${_fmtNum(pf.monto, 2)}</td>
                    <td class="num">${_fmtNum(pf.tna, 2)}</td>
                    <td>${_fmtDate(_parse(pf.fechaInicio))}</td>
                    <td>${_fmtDate(_parse(pf.fechaFin))}</td>
                    <td>${_fmtDate(_parse(pf.fechaUltCalc)) || '-'}</td>
                    <td class="num">${_fmtNum(pf.intDevengados, 2)}</td>
                    <td class="num">${diasRest}</td>
                </tr>`;
            });

            html += '</tbody></table>';
            html += `<input type="hidden" name="custpage_pf_ids" value="${pfs.map(p => p.id).join(',')}" />`;
            html += `<div style="margin-top:10px;font-size:12px;color:#888;">
                <span style="display:inline-block;width:14px;height:14px;background:#fde2e4;border:1px solid #c9cdd4;vertical-align:middle;"></span> Vencido
                &nbsp;&nbsp;
                <span style="display:inline-block;width:14px;height:14px;background:#fff4cc;border:1px solid #c9cdd4;vertical-align:middle;"></span> Vence en ≤ 7 días
            </div>`;

            tablaField.defaultValue = header + html;
        }

        form.addSubmitButton({ label: 'Ejecutar' });
        context.response.writePage(form);
    }

    function procesarDevengamiento(context, soloCalculo) {
        const req = context.request;
        const idsRaw = req.parameters.custpage_pf_ids || '';
        const ids = idsRaw.split(',').map(s => s.trim()).filter(Boolean);
        if (ids.length === 0) {
            return '<span style="color:#c62828;">No se recibieron PFs. Recargá la página.</span>';
        }

        const fechaCorteRaw = req.parameters.custpage_fecha_corte || '';
        const fechaCorte = _parse(fechaCorteRaw) || _ultimoDiaDelMes(new Date());

        const script = runtime.getCurrentScript();
        const ctaIntDevDefault = script.getParameter({ name: 'custscript_sdb_pf_dev_cta_int_dev' });
        const ctaIntGanDefault = script.getParameter({ name: 'custscript_sdb_pf_dev_cta_int_gan' });

        const pfs = _buscarPFsActivos();
        const pfsById = {};
        pfs.forEach(p => { pfsById[p.id] = p; });

        let procesados = 0, sinCambio = 0, errores = 0, saltados = 0;
        const filas = [];
        let totalIntereses = 0;

        ids.forEach(invId => {
            const checked = req.parameters[`chk_${invId}`];
            if (!checked) { saltados++; return; }
            const pf = pfsById[invId];
            if (!pf) { saltados++; return; }
            try {
                const ctaIntDev = pf.ctaIntDevRecord || ctaIntDevDefault;
                const ctaIntGan = pf.ctaIntGanRecord || ctaIntGanDefault;
                if (!soloCalculo && (!ctaIntDev || !ctaIntGan)) {
                    throw new Error('Faltan cuentas Int. Devengados / Int. Ganados (en el record o params del deployment).');
                }
                const r = _procesarDevengamiento(pf, fechaCorte, ctaIntDev, ctaIntGan, soloCalculo);
                if (r.accion === 'devengado' || r.accion === 'calculado') procesados++;
                else sinCambio++;
                if (r.intereses) totalIntereses += r.intereses;
                filas.push(Object.assign({ id: pf.id, nombre: pf.nombre, moneda: pf.moneda }, r));
            } catch (e) {
                errores++;
                filas.push({ id: pf.id, nombre: pf.nombre, accion: 'ERROR', error: e.message });
                log.error(`PF Dev Inv ${pf.id}`, e.message);
                if (!soloCalculo) _guardarError(pf.id, `Dev manual: ${e.message}`);
            }
        });

        const labelAccion = soloCalculo ? 'calculados' : 'devengados';
        let html = `✔ <b>${procesados}</b> ${labelAccion} | ${sinCambio} sin cambio | ${errores} errores`;
        if (saltados > 0) html += ` | ${saltados} no marcados`;
        if (soloCalculo) html += ` | <b>Total intereses calculados: ${_fmtNum(totalIntereses, 2)}</b> <i>(simulación — no se asentó nada)</i>`;
        if (filas.length > 0) {
            html += '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:8px;">';
            html += '<thead><tr style="background:#f4f6f8;">';
            html += '<th style="border:1px solid #c9cdd4;padding:4px;text-align:left;">Inv</th>';
            html += '<th style="border:1px solid #c9cdd4;padding:4px;text-align:left;">Nombre</th>';
            html += '<th style="border:1px solid #c9cdd4;padding:4px;text-align:left;">Acción</th>';
            html += '<th style="border:1px solid #c9cdd4;padding:4px;text-align:left;">Período</th>';
            html += '<th style="border:1px solid #c9cdd4;padding:4px;text-align:right;">Días</th>';
            html += '<th style="border:1px solid #c9cdd4;padding:4px;text-align:left;">Moneda</th>';
            html += '<th style="border:1px solid #c9cdd4;padding:4px;text-align:right;">Intereses</th>';
            html += '<th style="border:1px solid #c9cdd4;padding:4px;text-align:left;">JE / Detalle</th>';
            html += '</tr></thead><tbody>';
            filas.forEach(f => {
                const color = f.accion === 'ERROR' ? '#c62828' : ((f.accion === 'devengado' || f.accion === 'calculado') ? '#2e7d32' : '#888');
                let jeCell = '';
                if (f.jeId) {
                    try {
                        const u = url.resolveRecord({ recordType: 'journalentry', recordId: f.jeId, isEditMode: false });
                        jeCell = `<a href="${u}" target="_blank">JE ${f.jeId}</a>`;
                    } catch (e) { jeCell = `JE ${f.jeId}`; }
                }
                if (f.error) jeCell = `<span style="color:#c62828;">${escapeHtml(f.error)}</span>`;
                else if (f.motivo) jeCell = `<span style="color:#888;">${escapeHtml(f.motivo)}</span>`;
                const periodo = (f.fechaDesde && f.fechaHasta) ? `${f.fechaDesde} → ${f.fechaHasta}` : '';
                html += `<tr>
                    <td style="border:1px solid #c9cdd4;padding:4px;">${f.id}</td>
                    <td style="border:1px solid #c9cdd4;padding:4px;">${escapeHtml(f.nombre || '')}</td>
                    <td style="border:1px solid #c9cdd4;padding:4px;color:${color};font-weight:600;">${f.accion}</td>
                    <td style="border:1px solid #c9cdd4;padding:4px;">${periodo}</td>
                    <td style="border:1px solid #c9cdd4;padding:4px;text-align:right;">${f.dias || ''}</td>
                    <td style="border:1px solid #c9cdd4;padding:4px;">${escapeHtml(f.moneda || '')}</td>
                    <td style="border:1px solid #c9cdd4;padding:4px;text-align:right;">${f.intereses != null ? _fmtNum(f.intereses, 2) : ''}</td>
                    <td style="border:1px solid #c9cdd4;padding:4px;">${jeCell}</td>
                </tr>`;
            });
            html += '</tbody></table>';
        }
        return html;
    }

    function procesarCobro(context) {
        const req = context.request;
        const idsRaw = req.parameters.custpage_pf_ids || '';
        const ids = idsRaw.split(',').map(s => s.trim()).filter(Boolean);
        if (ids.length === 0) {
            return '<span style="color:#c62828;">No se recibieron PFs. Recargá la página.</span>';
        }

        const fechaCorteRaw = req.parameters.custpage_fecha_corte || '';
        const fechaCorte = _parse(fechaCorteRaw) || new Date();

        const pfs = _buscarPFsActivos();
        const pfsById = {};
        pfs.forEach(p => { pfsById[p.id] = p; });

        let procesados = 0, sinCambio = 0, errores = 0, saltados = 0;
        const filas = [];
        let totalCobrado = 0;

        ids.forEach(invId => {
            const checked = req.parameters[`chk_${invId}`];
            if (!checked) { saltados++; return; }
            const pf = pfsById[invId];
            if (!pf) { saltados++; return; }
            try {
                if (pf.intDevengados <= 0) {
                    sinCambio++;
                    filas.push({ id: pf.id, nombre: pf.nombre, moneda: pf.moneda, accion: 'sin-cambio', motivo: 'no hay intereses devengados' });
                    return;
                }
                // Cta Banco: prioridad cta_banco, sino cta_resultado (legacy PF sourcing)
                const ctaBanco = pf.ctaBanco || pf.ctaResultado;
                const ctaIntDev = pf.ctaIntDevRecord;
                if (!ctaBanco) throw new Error('Falta Cta Banco en la inversión (cta_banco o cta_resultado).');
                if (!ctaIntDev) throw new Error('Falta Cta Int. Devengados en la inversión.');

                const jeId = _crearJECobro(pf, pf.intDevengados, ctaBanco, ctaIntDev, fechaCorte);

                record.submitFields({
                    type: 'customrecord_sdb_inv_maestro',
                    id: pf.id,
                    values: {
                        custrecord_sdb_inv_int_devengados: 0,
                        custrecord_sdb_inv_int_cobrados: parseFloat((pf.intCobrados + pf.intDevengados).toFixed(2)),
                        custrecord_sdb_inv_ultimo_error: ''
                    }
                });

                totalCobrado += pf.intDevengados;
                procesados++;
                filas.push({
                    id: pf.id,
                    nombre: pf.nombre,
                    moneda: pf.moneda,
                    accion: 'cobrado',
                    intereses: pf.intDevengados,
                    jeId: jeId
                });
            } catch (e) {
                errores++;
                filas.push({ id: pf.id, nombre: pf.nombre, moneda: pf.moneda, accion: 'ERROR', error: e.message });
                log.error(`PF Cobro Inv ${pf.id}`, e.message);
                _guardarError(pf.id, `Cobro intereses: ${e.message}`);
            }
        });

        let html = `✔ <b>${procesados}</b> cobrados | ${sinCambio} sin cambio | ${errores} errores`;
        if (saltados > 0) html += ` | ${saltados} no marcados`;
        html += ` | <b>Total cobrado: ${_fmtNum(totalCobrado, 2)}</b>`;

        if (filas.length > 0) {
            html += '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:8px;">';
            html += '<thead><tr style="background:#f4f6f8;">';
            html += '<th style="border:1px solid #c9cdd4;padding:4px;text-align:left;">Inv</th>';
            html += '<th style="border:1px solid #c9cdd4;padding:4px;text-align:left;">Nombre</th>';
            html += '<th style="border:1px solid #c9cdd4;padding:4px;text-align:left;">Acción</th>';
            html += '<th style="border:1px solid #c9cdd4;padding:4px;text-align:left;">Moneda</th>';
            html += '<th style="border:1px solid #c9cdd4;padding:4px;text-align:right;">Cobrado</th>';
            html += '<th style="border:1px solid #c9cdd4;padding:4px;text-align:left;">JE / Detalle</th>';
            html += '</tr></thead><tbody>';
            filas.forEach(f => {
                const color = f.accion === 'ERROR' ? '#c62828' : (f.accion === 'cobrado' ? '#2e7d32' : '#888');
                let jeCell = '';
                if (f.jeId) {
                    try {
                        const u = url.resolveRecord({ recordType: 'journalentry', recordId: f.jeId, isEditMode: false });
                        jeCell = `<a href="${u}" target="_blank">JE ${f.jeId}</a>`;
                    } catch (e) { jeCell = `JE ${f.jeId}`; }
                }
                if (f.error) jeCell = `<span style="color:#c62828;">${escapeHtml(f.error)}</span>`;
                else if (f.motivo) jeCell = `<span style="color:#888;">${escapeHtml(f.motivo)}</span>`;
                html += `<tr>
                    <td style="border:1px solid #c9cdd4;padding:4px;">${f.id}</td>
                    <td style="border:1px solid #c9cdd4;padding:4px;">${escapeHtml(f.nombre || '')}</td>
                    <td style="border:1px solid #c9cdd4;padding:4px;color:${color};font-weight:600;">${f.accion}</td>
                    <td style="border:1px solid #c9cdd4;padding:4px;">${escapeHtml(f.moneda || '')}</td>
                    <td style="border:1px solid #c9cdd4;padding:4px;text-align:right;">${f.intereses != null ? _fmtNum(f.intereses, 2) : ''}</td>
                    <td style="border:1px solid #c9cdd4;padding:4px;">${jeCell}</td>
                </tr>`;
            });
            html += '</tbody></table>';
        }
        return html;
    }

    function _crearJECobro(pf, monto, ctaBanco, ctaIntDev, trandate) {
        const je = record.create({ type: record.Type.JOURNAL_ENTRY, isDynamic: true });
        if (pf.subsidiaria) je.setValue('subsidiary', pf.subsidiaria);
        if (pf.monedaId) je.setValue('currency', pf.monedaId);
        if (trandate) je.setValue('trandate', trandate);
        je.setValue('memo', `[COBRO INTERESES] PF | Inv. ${pf.id} | Monto ${monto}`);
        je.setValue('custbody_sdb_inv_inversion', pf.id);

        je.selectNewLine({ sublistId: 'line' });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: ctaBanco });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'debit', value: monto });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: `Cobro intereses PF | Inv. ${pf.id}` });
        je.commitLine({ sublistId: 'line' });

        je.selectNewLine({ sublistId: 'line' });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: ctaIntDev });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'credit', value: monto });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: `Baja Int. Devengados PF | Inv. ${pf.id}` });
        je.commitLine({ sublistId: 'line' });

        return je.save();
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
                'name',
                'custrecord_sdb_inv_institucion',
                'custrecord_sdb_inv_moneda',
                'custrecord_sdb_inv_monto',
                'custrecord_sdb_inv_tna',
                'custrecord_sdb_inv_fecha_inicio',
                'custrecord_sdb_inv_fecha_fin',
                'custrecord_sdb_inv_fecha_ult_calc',
                'custrecord_sdb_inv_int_devengados',
                'custrecord_sdb_inv_int_cobrados',
                'custrecord_sdb_inv_subsidiaria',
                'custrecord_sdb_inv_cta_intereses',
                'custrecord_sdb_inv_cta_int_devengados',
                'custrecord_sdb_inv_cta_banco',
                'custrecord_sdb_inv_cta_resultado'
            ]
        }).run().each(r => {
            out.push({
                id: r.id,
                nombre: r.getValue({ name: 'name' }) || '',
                institucion: r.getText({ name: 'custrecord_sdb_inv_institucion' }) || '',
                moneda: r.getText({ name: 'custrecord_sdb_inv_moneda' }) || '',
                monto: parseFloat(r.getValue({ name: 'custrecord_sdb_inv_monto' }) || 0),
                tna: parseFloat(r.getValue({ name: 'custrecord_sdb_inv_tna' }) || 0),
                fechaInicio: r.getValue({ name: 'custrecord_sdb_inv_fecha_inicio' }),
                fechaFin: r.getValue({ name: 'custrecord_sdb_inv_fecha_fin' }),
                fechaUltCalc: r.getValue({ name: 'custrecord_sdb_inv_fecha_ult_calc' }),
                intDevengados: parseFloat(r.getValue({ name: 'custrecord_sdb_inv_int_devengados' }) || 0),
                intCobrados: parseFloat(r.getValue({ name: 'custrecord_sdb_inv_int_cobrados' }) || 0),
                subsidiaria: r.getValue({ name: 'custrecord_sdb_inv_subsidiaria' }),
                monedaId: r.getValue({ name: 'custrecord_sdb_inv_moneda' }),
                ctaIntGanRecord: r.getValue({ name: 'custrecord_sdb_inv_cta_intereses' }),
                ctaIntDevRecord: r.getValue({ name: 'custrecord_sdb_inv_cta_int_devengados' }),
                ctaBanco: r.getValue({ name: 'custrecord_sdb_inv_cta_banco' }),
                ctaResultado: r.getValue({ name: 'custrecord_sdb_inv_cta_resultado' })
            });
            return true;
        });
        return out;
    }

    function _procesarDevengamiento(pf, fechaCorte, ctaIntDev, ctaIntGan, soloCalculo) {
        if (pf.monto <= 0 || pf.tna <= 0) return { accion: 'sin-cambio', motivo: 'monto/TNA en 0' };
        if (!soloCalculo && !pf.subsidiaria) throw new Error('Falta Subsidiaria en el record.');
        if (!soloCalculo && !pf.monedaId) throw new Error('Falta Moneda en el record.');

        const fechaInicio = _parse(pf.fechaInicio);
        const fechaFin = _parse(pf.fechaFin);
        const fechaUltCalc = _parse(pf.fechaUltCalc);
        const fechaDesde = fechaUltCalc || fechaInicio;
        const fechaHasta = (fechaFin && fechaFin < fechaCorte) ? fechaFin : fechaCorte;

        if (!fechaDesde) throw new Error('Falta Fecha de Inicio.');
        if (fechaDesde >= fechaHasta) return { accion: 'sin-cambio', motivo: 'período inválido (desde ≥ hasta)' };

        const dias = _diasEntre(fechaDesde, fechaHasta);
        const diasAnio = _esBisiesto(fechaHasta.getFullYear()) ? 366 : 365;
        const intereses = parseFloat((pf.monto * (pf.tna / 100) * (dias / diasAnio)).toFixed(2));

        if (!isFinite(intereses) || isNaN(intereses)) throw new Error('Cálculo de intereses inválido.');
        if (intereses <= 0) return { accion: 'sin-cambio', motivo: 'intereses = 0', dias };

        // Modo cálculo: devuelvo el resultado sin tocar nada
        if (soloCalculo) {
            return {
                accion: 'calculado',
                dias,
                intereses,
                fechaDesde: _fmtDate(fechaDesde),
                fechaHasta: _fmtDate(fechaHasta)
            };
        }

        const jeId = _crearJE(pf, intereses, ctaIntDev, ctaIntGan, fechaHasta, dias);

        record.submitFields({
            type: 'customrecord_sdb_inv_maestro',
            id: pf.id,
            values: {
                custrecord_sdb_inv_int_devengados: parseFloat((pf.intDevengados + intereses).toFixed(2)),
                custrecord_sdb_inv_fecha_ult_calc: fechaHasta,
                custrecord_sdb_inv_ultimo_error: ''
            }
        });

        return { accion: 'devengado', dias, intereses, jeId, fechaDesde: _fmtDate(fechaDesde), fechaHasta: _fmtDate(fechaHasta) };
    }

    function _crearJE(pf, monto, ctaDeb, ctaCre, trandate, dias) {
        const je = record.create({ type: record.Type.JOURNAL_ENTRY, isDynamic: true });
        if (pf.subsidiaria) je.setValue('subsidiary', pf.subsidiaria);
        if (pf.monedaId) je.setValue('currency', pf.monedaId);
        if (trandate) je.setValue('trandate', trandate);
        je.setValue('memo', `[DEVENGAMIENTO MANUAL] PF | Inv. ${pf.id} | ${dias} días | TNA ${pf.tna}%`);
        je.setValue('custbody_sdb_inv_inversion', pf.id);

        je.selectNewLine({ sublistId: 'line' });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: ctaDeb });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'debit', value: monto });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: `Devengamiento PF - Intereses a cobrar | Inv. ${pf.id}` });
        je.commitLine({ sublistId: 'line' });

        je.selectNewLine({ sublistId: 'line' });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: ctaCre });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'credit', value: monto });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: `Devengamiento PF - Intereses ganados | Inv. ${pf.id}` });
        je.commitLine({ sublistId: 'line' });

        return je.save();
    }

    function _guardarError(invId, msg) {
        try {
            record.submitFields({
                type: 'customrecord_sdb_inv_maestro',
                id: invId,
                values: { custrecord_sdb_inv_ultimo_error: `[${new Date().toISOString()}] ${msg}` }
            });
        } catch (e) { /* silent */ }
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
        return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
    }
    function _fmtNum(n, dec) {
        const v = parseFloat(n);
        if (!isFinite(v)) return '';
        const fixed = v.toFixed(dec);
        const [intPart, decPart] = fixed.split('.');
        const intFmt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        return decPart ? `${intFmt},${decPart}` : intFmt;
    }
    function escapeHtml(s) {
        return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    return { onRequest };
});
