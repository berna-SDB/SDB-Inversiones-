/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * Revaluación de Moneda (diferencia de cambio).
 * Re-expresa monto_pesos al TC del día sin tocar valor de cuotaparte.
 */
define(['N/ui/serverWidget', 'N/search', 'N/record', 'N/runtime', 'N/log', 'N/url', 'N/currency', 'N/format'],
(serverWidget, search, record, runtime, log, url, currency, format) => {

    const TIPO_PF = '1';
    const BASE_CURRENCY_ID = '1'; // ARS
    const CTA_DIF_CAMBIO_DEFAULT = '1030'; // Cuenta default si la inversión no tiene cta_dif_cambio seteado

    function onRequest(context) {
        // Endpoint JSON: lookup TC por fecha (consumido por el JS embebido al cambiar la fecha)
        if (context.request.method === 'GET' && context.request.parameters.action === 'lookup_tc') {
            const fechaStr = context.request.parameters.fecha || '';
            const monedaId = context.request.parameters.moneda || '2'; // default USD
            let tc = 1;
            try {
                const fecha = _parseSuiteletDate(fechaStr);
                tc = _tipoCambio(monedaId, fecha);
            } catch (e) { /* silent */ }
            context.response.setHeader({ name: 'Content-Type', value: 'application/json' });
            context.response.write(JSON.stringify({ tc: tc }));
            return;
        }

        let resultadoMsg = '';
        if (context.request.method === 'POST') {
            try {
                resultadoMsg = procesarRevalMoneda(context);
            } catch (e) {
                log.error('onRequest POST', e.message + ' | ' + (e.stack || ''));
                resultadoMsg = `<span style="color:#c62828;">ERROR GLOBAL: ${escapeHtml(e.message)}</span>`;
            }
        }
        mostrarForm(context, resultadoMsg);
    }

    function mostrarForm(context, resultadoMsg) {
        const form = serverWidget.createForm({ title: 'Revaluación de Moneda' });
        const inversiones = buscarInversionesForeign();

        const grupoFiltros = form.addFieldGroup({
            id: 'custpage_grupo_filtros',
            label: 'Filtros'
        });

        const fechaField = form.addField({
            id: 'custpage_fecha_reval',
            type: serverWidget.FieldType.DATE,
            label: 'Fecha de Revaluación',
            container: 'custpage_grupo_filtros'
        });
        fechaField.isMandatory = true;
        fechaField.defaultValue = new Date();
        fechaField.updateLayoutType({ layoutType: serverWidget.FieldLayoutType.STARTROW });

        const tcField = form.addField({
            id: 'custpage_tc',
            type: serverWidget.FieldType.FLOAT,
            label: 'Tipo de Cambio',
            container: 'custpage_grupo_filtros'
        });
        tcField.updateLayoutType({ layoutType: serverWidget.FieldLayoutType.STARTROW });
        tcField.updateBreakType({ breakType: serverWidget.FieldBreakType.STARTROW });
        // Editable: el poll lo auto-completa con el TC de la cuenta (currency.exchangeRate) al elegir/cambiar fecha,
        // pero el usuario puede pisarlo manualmente. El POST usa este valor como TC para las inversiones seleccionadas.
        tcField.updateDisplayType({ displayType: serverWidget.FieldDisplayType.NORMAL });

        // URL del endpoint lookup_tc resuelta server-side (con script/deploy/hash correctos).
        // El client script la lee y le agrega &fecha=. Sin esto, un fetch armado con window.location
        // puede pegarle mal y NetSuite devuelve una página HTML "Notice" en vez del JSON.
        const _sc = runtime.getCurrentScript();
        const lookupUrlField = form.addField({
            id: 'custpage_lookup_url',
            type: serverWidget.FieldType.TEXT,
            label: 'lookup'
        });
        lookupUrlField.updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });
        lookupUrlField.defaultValue = url.resolveScript({
            scriptId: _sc.id,
            deploymentId: _sc.deploymentId,
            params: { action: 'lookup_tc' }
        });

        const tablaField = form.addField({
            id: 'custpage_tabla',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' '
        });
        tablaField.updateLayoutType({ layoutType: serverWidget.FieldLayoutType.OUTSIDEBELOW });
        tablaField.updateBreakType({ breakType: serverWidget.FieldBreakType.STARTROW });

        let headerHtml = '<div style="padding:0 4px;">';
        if (resultadoMsg) {
            headerHtml += `<div style="padding:10px 14px;margin:8px 0;border:1px solid #c9cdd4;background:#f5f6f8;font-size:14px;"><b>Resultado:</b> ${resultadoMsg}</div>`;
        }
        headerHtml += `<div style="padding:8px 14px;margin:8px 0;border:1px solid #c9cdd4;background:#fafbfc;font-size:13px;color:#444;">
            Sólo se listan inversiones en moneda ≠ ARS. La diferencia se contabiliza contra <b>cta_dif_cambio</b> del maestro.
        </div>`;
        headerHtml += '</div>';

        if (inversiones.length === 0) {
            tablaField.defaultValue = headerHtml + '<div style="padding:20px;">No hay inversiones en moneda foreign.</div>';
        } else {
            let html = `<style>
                .rev-tbl{width:100%;border-collapse:collapse;font-size:14px;margin-top:8px;}
                .rev-tbl th,.rev-tbl td{border:1px solid #c9cdd4;padding:7px 10px;text-align:left;vertical-align:top;}
                .rev-tbl th{background:#f4f6f8;font-weight:600;color:#222;font-size:14px;}
                .rev-tbl input[type=date]{width:140px;padding:5px 6px;font-size:14px;border:1px solid #c9cdd4;}
                .rev-tbl .num{text-align:right;font-size:15px;font-variant-numeric:tabular-nums;}
            </style>
            <table class="rev-tbl">
                <thead><tr>
                    <th><input type="checkbox" id="chk_all" onclick="document.querySelectorAll('input[name^=chk_]').forEach(c=>c.checked=this.checked)" /></th>
                    <th>ID</th><th>Nombre</th><th>Tipo</th><th>Moneda</th>
                    <th class="num">Cuotapartes</th><th class="num">Cot. Actual</th>
                    <th class="num">Monto USD</th><th class="num">Libros ARS</th>
                </tr></thead>
                <tbody>`;

            inversiones.forEach(inv => {
                let invUrl = '';
                try {
                    invUrl = url.resolveRecord({ recordType: 'customrecord_sdb_inv_maestro', recordId: inv.id, isEditMode: false });
                } catch (e) { /* silent */ }
                const idCell = invUrl ? `<a href="${invUrl}" target="_blank">${inv.id}</a>` : inv.id;
                const nombreCell = invUrl ? `<a href="${invUrl}" target="_blank">${escapeHtml(inv.nombre)}</a>` : escapeHtml(inv.nombre);
                const cuotapCell = inv.esPF ? '<span style="color:#888;">— PF</span>' : _fmtNum(inv.cuotapartes, 6);
                const cotizCell = inv.esPF ? '<span style="color:#888;">—</span>' : _fmtNum(inv.cotiz, 6);
                html += `<tr>
                    <td style="text-align:center;"><input type="checkbox" name="chk_${inv.id}" value="1" /></td>
                    <td>${idCell}</td>
                    <td>${nombreCell}</td>
                    <td>${escapeHtml(inv.tipo)}</td>
                    <td>${escapeHtml(inv.moneda)}</td>
                    <td class="num">${cuotapCell}</td>
                    <td class="num">${cotizCell}</td>
                    <td class="num">${_fmtNum(inv.montoForeign, 2)}</td>
                    <td class="num">${_fmtNum(inv.montoPesos, 2)}</td>
                </tr>`;
            });

            html += '</tbody></table>';
            html += `<input type="hidden" name="custpage_inv_ids" value="${inversiones.map(i => i.id).join(',')}" />`;
            // El auto-relleno del TC lo maneja el Client Script sdb_inv_reval_moneda_cs.js (fieldChanged sobre la fecha)

            tablaField.defaultValue = headerHtml + html;
        }

        form.clientScriptModulePath = './sdb_inv_reval_moneda_cs.js';
        form.addSubmitButton({ label: 'Revaluar Moneda' });
        context.response.writePage(form);
    }

    function buscarInversionesForeign() {
        const out = [];
        search.create({
            type: 'customrecord_sdb_inv_maestro',
            filters: [
                ['custrecord_sdb_inv_estado', 'anyof', ['1', '2']],
                'AND',
                ['custrecord_sdb_inv_moneda', 'noneof', [BASE_CURRENCY_ID]],
                'AND',
                ['isinactive', 'is', 'F']
            ],
            columns: [
                search.createColumn({ name: 'name' }),
                search.createColumn({ name: 'custrecord_sdb_inv_tipo' }),
                search.createColumn({ name: 'custrecord_sdb_inv_moneda' }),
                search.createColumn({ name: 'custrecord_sdb_inv_cuotapartes' }),
                search.createColumn({ name: 'custrecord_sdb_inv_valor_actual' }),
                search.createColumn({ name: 'custrecord_sdb_inv_valor_cuota_ini' }),
                search.createColumn({ name: 'custrecord_sdb_inv_monto' }),
                search.createColumn({ name: 'custrecord_sdb_inv_monto_pesos' })
            ]
        }).run().each(r => {
            const valorActual = parseFloat(r.getValue({ name: 'custrecord_sdb_inv_valor_actual' }) || 0);
            const valorIni = parseFloat(r.getValue({ name: 'custrecord_sdb_inv_valor_cuota_ini' }) || 0);
            const esPF = String(r.getValue({ name: 'custrecord_sdb_inv_tipo' }) || '') === TIPO_PF;
            const cuotapartes = parseFloat(r.getValue({ name: 'custrecord_sdb_inv_cuotapartes' }) || 0);
            const monto = parseFloat(r.getValue({ name: 'custrecord_sdb_inv_monto' }) || 0);
            const cotiz = valorActual > 0 ? valorActual : valorIni;
            out.push({
                id: r.id,
                nombre: r.getValue({ name: 'name' }) || '',
                tipo: r.getText({ name: 'custrecord_sdb_inv_tipo' }) || '',
                moneda: r.getText({ name: 'custrecord_sdb_inv_moneda' }) || '',
                esPF: esPF,
                cuotapartes: cuotapartes,
                cotiz: cotiz,
                montoForeign: esPF ? monto : parseFloat((cuotapartes * cotiz).toFixed(2)),
                montoPesos: parseFloat(r.getValue({ name: 'custrecord_sdb_inv_monto_pesos' }) || 0)
            });
            return true;
        });
        return out;
    }

    function procesarRevalMoneda(context) {
        const req = context.request;
        const idsRaw = req.parameters.custpage_inv_ids || '';
        const ids = idsRaw.split(',').map(s => s.trim()).filter(Boolean);
        if (ids.length === 0) {
            return '<span style="color:#c62828;">No se recibieron inversiones. Recargá.</span>';
        }

        const fechaRaw = req.parameters.custpage_fecha_reval || '';
        const fechaReval = fechaRaw ? _parseSuiteletDate(fechaRaw) : new Date();
        const tcRaw = req.parameters.custpage_tc || '';
        const tcManual = parseFloat(String(tcRaw).replace(',', '.')) || 0;

        let procesadas = 0, errores = 0, saltadas = 0;
        const jes = [];
        const errMsgs = [];

        ids.forEach(invId => {
            const checked = req.parameters[`chk_${invId}`];
            if (!checked) { saltadas++; return; }

            try {
                const jeId = revaluarMoneda(invId, fechaReval, tcManual);
                if (jeId) { jes.push(jeId); procesadas++; }
                else { saltadas++; }
            } catch (e) {
                errores++;
                errMsgs.push(`Inv ${invId}: ${e.message}`);
                log.error('procesarRevalMoneda', `Inv ${invId}: ${e.message}`);
            }
        });

        let msg = `✔ <b>${procesadas}</b> revaluadas | ${saltadas} sin cambio | ${errores} errores`;
        if (jes.length) {
            const jeLinks = jes.map(id => {
                try {
                    const u = url.resolveRecord({ recordType: 'journalentry', recordId: id, isEditMode: false });
                    return `<a href="${u}" target="_blank">${id}</a>`;
                } catch (e) { return String(id); }
            }).join(', ');
            msg += ` | JEs: ${jeLinks}`;
        }
        if (errMsgs.length) msg += ` | <span style="color:#c62828;">Errores: ${escapeHtml(errMsgs.join('; '))}</span>`;
        return msg;
    }

    function revaluarMoneda(invId, fechaReval, tcManual) {
        const inv = search.lookupFields({
            type: 'customrecord_sdb_inv_maestro',
            id: invId,
            columns: [
                'custrecord_sdb_inv_tipo',
                'custrecord_sdb_inv_cuotapartes',
                'custrecord_sdb_inv_valor_actual',
                'custrecord_sdb_inv_monto',
                'custrecord_sdb_inv_cta_activo',
                'custrecord_sdb_inv_cta_dif_cambio',
                'custrecord_sdb_inv_subsidiaria',
                'custrecord_sdb_inv_moneda',
                'custrecord_sdb_inv_institucion',
                'custrecord_sdb_inv_contrato',
                'custrecord_sdb_inv_monto_pesos'
            ]
        });

        const tipo = _pickId(inv.custrecord_sdb_inv_tipo);
        const esPF = String(tipo) === TIPO_PF;
        const cuotapartes = parseFloat(inv.custrecord_sdb_inv_cuotapartes || 0);
        const valorActual = parseFloat(inv.custrecord_sdb_inv_valor_actual || 0);
        const monto = parseFloat(inv.custrecord_sdb_inv_monto || 0);
        const montoPesosLibros = parseFloat(inv.custrecord_sdb_inv_monto_pesos || 0);
        const ctaActivo = _pickId(inv.custrecord_sdb_inv_cta_activo);
        const ctaDifCambio = _pickId(inv.custrecord_sdb_inv_cta_dif_cambio) || CTA_DIF_CAMBIO_DEFAULT;
        const subsidiaria = _pickId(inv.custrecord_sdb_inv_subsidiaria);
        const moneda = _pickId(inv.custrecord_sdb_inv_moneda);
        const contrato = inv.custrecord_sdb_inv_contrato || invId;
        const institucion = _pickText(inv.custrecord_sdb_inv_institucion);

        if (!ctaActivo) throw new Error('sin cuenta Activo');
        if (!ctaDifCambio) throw new Error('sin cta_dif_cambio en el maestro (y no hay default)');

        // PF revalúa el capital (monto en moneda); cuotaparte revalúa cuotapartes × valor_actual
        let valorForeign;
        if (esPF) {
            if (monto <= 0) throw new Error('PF sin monto (capital)');
            valorForeign = monto;
        } else {
            if (cuotapartes <= 0) throw new Error('sin cuotapartes');
            if (valorActual <= 0) throw new Error('sin valor_actual (cotización)');
            valorForeign = parseFloat((cuotapartes * valorActual).toFixed(6));
        }

        const tcNuevo = (tcManual && tcManual > 0) ? tcManual : _tipoCambio(moneda, fechaReval);
        const valorAtTcNuevo = parseFloat((valorForeign * tcNuevo).toFixed(2));
        const diferencia = parseFloat((valorAtTcNuevo - montoPesosLibros).toFixed(2));

        if (Math.abs(diferencia) < 0.01) return null;

        const ganancia = diferencia > 0;
        const abs = Math.abs(diferencia);
        const signo = ganancia ? 'GANANCIA' : 'PÉRDIDA';

        const je = record.create({ type: record.Type.JOURNAL_ENTRY, isDynamic: true });
        if (subsidiaria) je.setValue('subsidiary', subsidiaria);
        je.setValue('trandate', fechaReval);
        je.setValue('memo', `[REVAL MONEDA ${signo}] TC: ${tcNuevo} | LibrosARS: ${montoPesosLibros} → ${valorAtTcNuevo} | ${institucion} | Cto: ${contrato} | Inv. ${invId}`);
        je.setValue('custbody_sdb_inv_inversion', invId);

        if (ganancia) {
            je.selectNewLine({ sublistId: 'line' });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: ctaActivo });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'debit', value: abs });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: `Reval moneda GANANCIA - Ajuste Activo | Inv. ${invId}` });
            je.commitLine({ sublistId: 'line' });

            je.selectNewLine({ sublistId: 'line' });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: ctaDifCambio });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'credit', value: abs });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: `Reval moneda GANANCIA - Dif. Cambio | Inv. ${invId}` });
            je.commitLine({ sublistId: 'line' });
        } else {
            je.selectNewLine({ sublistId: 'line' });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: ctaDifCambio });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'debit', value: abs });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: `Reval moneda PÉRDIDA - Dif. Cambio | Inv. ${invId}` });
            je.commitLine({ sublistId: 'line' });

            je.selectNewLine({ sublistId: 'line' });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: ctaActivo });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'credit', value: abs });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: `Reval moneda PÉRDIDA - Ajuste Activo | Inv. ${invId}` });
            je.commitLine({ sublistId: 'line' });
        }

        const jeId = je.save();

        record.submitFields({
            type: 'customrecord_sdb_inv_maestro',
            id: invId,
            values: {
                custrecord_sdb_inv_monto_pesos: valorAtTcNuevo,
                custrecord_sdb_inv_tipo_cambio: tcNuevo,
                custrecord_sdb_inv_fecha_ult_calc: fechaReval,
                custrecord_sdb_inv_ultimo_error: ''
            }
        });

        log.audit('revaluarMoneda', `Inv ${invId}: TC=${tcNuevo} LibrosARS:${montoPesosLibros}→${valorAtTcNuevo} | Dif: ${diferencia} | JE: ${jeId}`);
        return jeId;
    }

    function _tipoCambio(monedaId, fecha) {
        if (!monedaId || String(monedaId) === BASE_CURRENCY_ID) return 1;
        try {
            const rate = currency.exchangeRate({
                source: monedaId,
                target: BASE_CURRENCY_ID,
                date: fecha || new Date()
            });
            return rate > 0 ? rate : 1;
        } catch (e) {
            log.error('_tipoCambio', `moneda=${monedaId} fecha=${fecha} err=${e.message}`);
            return 1;
        }
    }

    function _parseSuiteletDate(s) {
        try {
            const d = format.parse({ value: s, type: format.Type.DATE });
            if (d instanceof Date) return d;
        } catch (e) { /* fallthrough */ }
        const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m) return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
        return new Date();
    }

    function _pickId(v) {
        if (Array.isArray(v)) return v.length > 0 && v[0] ? String(v[0].value || '') : '';
        return v ? String(v) : '';
    }
    function _pickText(arr) {
        if (Array.isArray(arr) && arr[0]) return arr[0].text || '';
        return '';
    }
    function escapeHtml(s) {
        return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }
    function _fmtNum(n, dec) {
        const v = parseFloat(n);
        if (!isFinite(v)) return '';
        const fixed = v.toFixed(dec);
        const [intPart, decPart] = fixed.split('.');
        const intFmt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        return decPart ? `${intFmt},${decPart}` : intFmt;
    }

    return { onRequest };
});
