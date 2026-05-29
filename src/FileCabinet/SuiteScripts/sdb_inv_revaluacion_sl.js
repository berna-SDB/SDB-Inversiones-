/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define(['N/ui/serverWidget', 'N/search', 'N/record', 'N/runtime', 'N/log', 'N/url', 'N/currency'],
(serverWidget, search, record, runtime, log, url, currency) => {

    const TIPO_PF = '1'; // Plazo Fijo: excluido (no tiene cotización por cuotaparte)
    const BASE_CURRENCY_ID = '1'; // ARS base subsidiary

    function onRequest(context) {
        let resultadoMsg = '';
        if (context.request.method === 'POST') {
            try {
                resultadoMsg = procesarRevaluacion(context);
            } catch (e) {
                log.error('onRequest POST', e.message + ' | ' + (e.stack || ''));
                resultadoMsg = `<span style="color:#c62828;">ERROR GLOBAL: ${escapeHtml(e.message)}</span>`;
            }
        }
        mostrarForm(context, resultadoMsg);
    }

    function mostrarForm(context, resultadoMsg) {
        const form = serverWidget.createForm({ title: 'Revaluación de Cuotaparte' });

        // Tabla con inversiones
        const inversiones = buscarInversiones();

        // Encabezado + tabla en un único INLINEHTML (así evitamos el label col que desfasa)
        const tablaField = form.addField({
            id: 'custpage_tabla',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' '
        });

        const script = runtime.getCurrentScript();
        const ctaGananciaParam = script.getParameter({ name: 'custscript_sdb_rev_sl_cta_ganancia' });
        const ctaPerdidaParam = script.getParameter({ name: 'custscript_sdb_rev_sl_cta_perdida' });
        const ctaGananciaLabel = _labelCuenta(ctaGananciaParam);
        const ctaPerdidaLabel = _labelCuenta(ctaPerdidaParam);

        let headerHtml = '<div style="padding:0 4px;">';
        if (resultadoMsg) {
            headerHtml += `<div style="padding:10px 14px;margin:8px 0;border:1px solid #c9cdd4;background:#f5f6f8;font-size:14px;"><b>Resultado:</b> ${resultadoMsg}</div>`;
        }
        headerHtml += `<div style="padding:8px 14px;margin:8px 0;border:1px solid #c9cdd4;background:#fafbfc;font-size:13px;color:#444;">
            Cuentas del deployment →
            <b>Ganancia:</b> ${ctaGananciaLabel}
            · <b>Pérdida:</b> ${ctaPerdidaLabel}
        </div>`;
        headerHtml += '</div>';

        if (inversiones.length === 0) {
            tablaField.defaultValue = headerHtml + '<div style="padding:20px;">No hay inversiones activas (FCI/Bono/Acciones/RV) para revaluar.</div>';
        } else {
            let html = `<style>
                .rev-tbl{width:100%;border-collapse:collapse;font-size:14px;margin-top:8px;}
                .rev-tbl th,.rev-tbl td{border:1px solid #c9cdd4;padding:7px 10px;text-align:left;vertical-align:top;}
                .rev-tbl th{background:#f4f6f8;font-weight:600;color:#222;font-size:14px;}
                .rev-tbl input[type=text],.rev-tbl input[type=date]{width:120px;padding:5px 6px;font-size:14px;border:1px solid #c9cdd4;}
                .rev-tbl .num{text-align:right;font-size:15px;font-variant-numeric:tabular-nums;}
                .rev-tbl .cta-ok{display:block;margin-top:3px;font-size:13px;color:#555;}
                .rev-tbl .cta-missing{display:block;margin-top:3px;font-size:13px;color:#555;}
            </style>
            <table class="rev-tbl">
                <thead><tr>
                    <th><input type="checkbox" id="chk_all" onclick="document.querySelectorAll('input[name^=chk_]').forEach(c=>c.checked=this.checked)" /></th>
                    <th>ID</th><th>Nombre</th><th>Tipo</th><th>Moneda</th>
                    <th class="num">Cuotapartes</th><th class="num">Cot. Anterior</th><th class="num">Libros ARS</th>
                    <th>Nueva Cotización</th><th>Fecha Reval</th>
                </tr></thead>
                <tbody>`;

            inversiones.forEach(inv => {
                let invUrl = '';
                try {
                    invUrl = url.resolveRecord({ recordType: 'customrecord_sdb_inv_maestro', recordId: inv.id, isEditMode: false });
                } catch (e) { /* silent */ }
                const idCell = invUrl ? `<a href="${invUrl}" target="_blank">${inv.id}</a>` : inv.id;
                const nombreCell = invUrl ? `<a href="${invUrl}" target="_blank">${escapeHtml(inv.nombre)}</a>` : escapeHtml(inv.nombre);
                html += `<tr>
                    <td style="text-align:center;"><input type="checkbox" name="chk_${inv.id}" value="1" /></td>
                    <td>${idCell}</td>
                    <td>${nombreCell}</td>
                    <td>${escapeHtml(inv.tipo)}</td>
                    <td>${escapeHtml(inv.moneda)}</td>
                    <td class="num">${inv.cuotapartes ? _fmtNum(inv.cuotapartes, 6) : ''}</td>
                    <td class="num">${inv.cotiz ? _fmtNum(inv.cotiz, 6) : ''}</td>
                    <td class="num">${_fmtNum(inv.montoPesos, 2)}</td>
                    <td><input type="text" name="cotiz_${inv.id}" data-prev="${inv.cotiz || 0}" oninput="window._revColor(this)" placeholder="0.00" /></td>
                    <td><input type="date" name="fecha_${inv.id}" /></td>
                </tr>`;
            });

            html += '</tbody></table>';
            // Hidden field con los IDs
            html += `<input type="hidden" name="custpage_inv_ids" value="${inversiones.map(i => i.id).join(',')}" />`;
            // JS cliente: color rojo si cotiz nueva < anterior, verde si > anterior
            html += `<script>
                window._revColor = function(el) {
                    var raw = (el.value || '').replace(',', '.');
                    var v = parseFloat(raw);
                    var p = parseFloat(el.getAttribute('data-prev'));
                    if (!v || isNaN(v) || isNaN(p)) { el.style.background = ''; return; }
                    if (v < p) el.style.background = '#fde2e4';
                    else if (v > p) el.style.background = '#dcf5dc';
                    else el.style.background = '';
                };
            </script>`;

            tablaField.defaultValue = headerHtml + html;
        }

        form.addSubmitButton({ label: 'Revaluar' });
        context.response.writePage(form);
    }

    function buscarInversiones() {
        const out = [];
        search.create({
            type: 'customrecord_sdb_inv_maestro',
            filters: [
                ['custrecord_sdb_inv_estado', 'anyof', ['1', '2']],
                'AND',
                ['custrecord_sdb_inv_tipo', 'noneof', [TIPO_PF]],
                'AND',
                ['isinactive', 'is', 'F']
            ],
            columns: [
                search.createColumn({ name: 'name' }),
                search.createColumn({ name: 'custrecord_sdb_inv_tipo' }),
                search.createColumn({ name: 'custrecord_sdb_inv_moneda' }),
                search.createColumn({ name: 'custrecord_sdb_inv_institucion' }),
                search.createColumn({ name: 'custrecord_sdb_inv_cuotapartes' }),
                search.createColumn({ name: 'custrecord_sdb_inv_valor_actual' }),
                search.createColumn({ name: 'custrecord_sdb_inv_valor_cuota_ini' }),
                search.createColumn({ name: 'custrecord_sdb_inv_monto_pesos' })
            ]
        }).run().each(r => {
            const valorActual = parseFloat(r.getValue({ name: 'custrecord_sdb_inv_valor_actual' }) || 0);
            const valorIni = parseFloat(r.getValue({ name: 'custrecord_sdb_inv_valor_cuota_ini' }) || 0);
            out.push({
                id: r.id,
                nombre: r.getValue({ name: 'name' }) || '',
                tipo: r.getText({ name: 'custrecord_sdb_inv_tipo' }) || '',
                moneda: r.getText({ name: 'custrecord_sdb_inv_moneda' }) || '',
                institucion: r.getText({ name: 'custrecord_sdb_inv_institucion' }) || '',
                cuotapartes: parseFloat(r.getValue({ name: 'custrecord_sdb_inv_cuotapartes' }) || 0),
                cotiz: valorActual > 0 ? valorActual : valorIni,
                montoPesos: parseFloat(r.getValue({ name: 'custrecord_sdb_inv_monto_pesos' }) || 0)
            });
            return true;
        });
        return out;
    }

    function procesarRevaluacion(context) {
        const req = context.request;
        const script = runtime.getCurrentScript();
        const ctaGanancia = script.getParameter({ name: 'custscript_sdb_rev_sl_cta_ganancia' });
        const ctaPerdida = script.getParameter({ name: 'custscript_sdb_rev_sl_cta_perdida' });

        if (!ctaGanancia || !ctaPerdida) {
            return '<span style="color:#c62828;">ERROR: Cuentas Ganancia/Pérdida no configuradas en el deployment.</span>';
        }

        const idsRaw = req.parameters.custpage_inv_ids || '';
        const ids = idsRaw.split(',').map(s => s.trim()).filter(Boolean);

        log.audit('procesarRevaluacion', `IDs recibidos: ${ids.length} | ctaG: ${ctaGanancia} | ctaP: ${ctaPerdida}`);

        if (ids.length === 0) {
            return '<span style="color:#c62828;">No se recibieron inversiones en el form. Recargá la página.</span>';
        }

        let procesadas = 0, errores = 0, saltadas = 0;
        const jes = [];
        const errMsgs = [];

        ids.forEach(invId => {
            // Solo procesar filas con checkbox marcado
            const checked = req.parameters[`chk_${invId}`];
            if (!checked) { saltadas++; return; }

            const nuevaCotizRaw = req.parameters[`cotiz_${invId}`] || '';
            const nuevaCotiz = parseFloat(String(nuevaCotizRaw).replace(',', '.') || 0);
            if (nuevaCotiz <= 0) { saltadas++; return; }

            const fechaRaw = req.parameters[`fecha_${invId}`] || '';
            const fechaReval = fechaRaw ? _parseYmd(fechaRaw) : new Date();

            try {
                const jeId = revaluarInversion(invId, nuevaCotiz, fechaReval, ctaGanancia, ctaPerdida);
                if (jeId) { jes.push(jeId); procesadas++; }
                else { saltadas++; }
            } catch (e) {
                errores++;
                errMsgs.push(`Inv ${invId}: ${e.message}`);
                log.error('procesarRevaluacion - error', `Inv ${invId}: ${e.message}`);
            }
        });

        let msg = `✔ <b>${procesadas}</b> revaluadas | ${saltadas} sin cambio / sin cotización nueva | ${errores} errores`;
        if (jes.length) {
            const jeLinks = jes.map(id => {
                try {
                    const u = url.resolveRecord({ recordType: 'journalentry', recordId: id, isEditMode: false });
                    return `<a href="${u}" target="_blank">${id}</a>`;
                } catch (e) {
                    return String(id);
                }
            }).join(', ');
            msg += ` | JEs: ${jeLinks}`;
        }
        if (errMsgs.length) msg += ` | <span style="color:#c62828;">Errores: ${escapeHtml(errMsgs.join('; '))}</span>`;
        return msg;
    }

    function revaluarInversion(invId, nuevaCotiz, fechaReval, ctaGanancia, ctaPerdida) {
        const inv = search.lookupFields({
            type: 'customrecord_sdb_inv_maestro',
            id: invId,
            columns: [
                'custrecord_sdb_inv_cuotapartes',
                'custrecord_sdb_inv_valor_actual',
                'custrecord_sdb_inv_valor_cuota_ini',
                'custrecord_sdb_inv_cta_activo',
                'custrecord_sdb_inv_subsidiaria',
                'custrecord_sdb_inv_moneda',
                'custrecord_sdb_inv_tipo',
                'custrecord_sdb_inv_institucion',
                'custrecord_sdb_inv_contrato',
                'custrecord_sdb_inv_monto_pesos'
            ]
        });

        const cuotapartes = parseFloat(inv.custrecord_sdb_inv_cuotapartes || 0);
        const valorActual = parseFloat(inv.custrecord_sdb_inv_valor_actual || 0);
        const valorIni = parseFloat(inv.custrecord_sdb_inv_valor_cuota_ini || 0);
        const cotizAnterior = valorActual > 0 ? valorActual : valorIni;
        const montoPesosLibros = parseFloat(inv.custrecord_sdb_inv_monto_pesos || 0);
        const ctaActivo = _pickId(inv.custrecord_sdb_inv_cta_activo);
        const subsidiaria = _pickId(inv.custrecord_sdb_inv_subsidiaria);
        const moneda = _pickId(inv.custrecord_sdb_inv_moneda);
        const contrato = inv.custrecord_sdb_inv_contrato || invId;
        const institucion = _pickText(inv.custrecord_sdb_inv_institucion);

        if (!ctaActivo) throw new Error('sin cuenta Activo');
        if (cuotapartes <= 0) throw new Error('sin cuotapartes');

        // TC a la fecha de revaluación (1 si moneda == base) — sólo para convertir la dif a ARS
        const tc = _tipoCambio(moneda, subsidiaria, fechaReval);
        const difUSD = parseFloat((cuotapartes * (nuevaCotiz - cotizAnterior)).toFixed(6));
        const difARS = parseFloat((difUSD * tc).toFixed(2));

        if (Math.abs(difARS) < 0.01) return null;

        const ganancia = difARS > 0;
        const abs = parseFloat(Math.abs(difUSD).toFixed(2));
        const signo = ganancia ? 'GANANCIA' : 'PÉRDIDA';
        const ctaResultado = ganancia ? ctaGanancia : ctaPerdida;
        const nuevoMontoPesos = parseFloat((montoPesosLibros + difARS).toFixed(2));

        const je = record.create({ type: record.Type.JOURNAL_ENTRY, isDynamic: true });
        if (subsidiaria) je.setValue('subsidiary', subsidiaria);
        if (moneda) je.setValue('currency', moneda);
        je.setValue('trandate', fechaReval);
        if (tc > 0 && String(moneda) !== BASE_CURRENCY_ID) je.setValue('exchangerate', tc);
        je.setValue('memo', `[REVAL CUOTAPARTE ${signo}] ${cotizAnterior}→${nuevaCotiz} TC: ${tc} | difUSD: ${difUSD} difARS: ${difARS} | ${institucion} | Cto: ${contrato} | Inv. ${invId}`);
        je.setValue('custbody_sdb_inv_inversion', invId);

        if (ganancia) {
            je.selectNewLine({ sublistId: 'line' });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: ctaActivo });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'debit', value: abs });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: `Reval cuotaparte GANANCIA - Ajuste Activo | Inv. ${invId}` });
            je.commitLine({ sublistId: 'line' });

            je.selectNewLine({ sublistId: 'line' });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: ctaResultado });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'credit', value: abs });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: `Reval cuotaparte GANANCIA - Resultado | Inv. ${invId}` });
            je.commitLine({ sublistId: 'line' });
        } else {
            je.selectNewLine({ sublistId: 'line' });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: ctaResultado });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'debit', value: abs });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: `Reval cuotaparte PÉRDIDA - Resultado | Inv. ${invId}` });
            je.commitLine({ sublistId: 'line' });

            je.selectNewLine({ sublistId: 'line' });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: ctaActivo });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'credit', value: abs });
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: `Reval cuotaparte PÉRDIDA - Ajuste Activo | Inv. ${invId}` });
            je.commitLine({ sublistId: 'line' });
        }

        const jeId = je.save();

        record.submitFields({
            type: 'customrecord_sdb_inv_maestro',
            id: invId,
            values: {
                custrecord_sdb_inv_valor_actual: nuevaCotiz,
                custrecord_sdb_inv_monto_actual: parseFloat((cuotapartes * nuevaCotiz).toFixed(2)),
                custrecord_sdb_inv_monto_pesos: nuevoMontoPesos,
                custrecord_sdb_inv_fecha_ult_calc: fechaReval,
                custrecord_sdb_inv_ultimo_error: ''
            }
        });

        log.audit('revaluarInversion', `Inv ${invId}: ${cotizAnterior}→${nuevaCotiz} TC:${tc} difUSD:${difUSD} difARS:${difARS} LibrosARS:${montoPesosLibros}→${nuevoMontoPesos} | JE: ${jeId}`);
        return jeId;
    }

    // ─── Helpers TC + parse fecha ──────────────────────────────────────────
    function _tipoCambio(monedaId, subsidiariaId, fecha) {
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

    function _parseYmd(s) {
        // input type=date envía 'yyyy-mm-dd'
        const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) return new Date();
        return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    }

    function _labelCuenta(accountId) {
        if (!accountId) return '<span style="color:#c62828;">NO CONFIGURADA</span>';
        try {
            const rec = record.load({ type: 'account', id: accountId });
            const num = rec.getValue('acctnumber') || '';
            const name = rec.getValue('accountsearchdisplayname') || rec.getValue('name') || rec.getValue('displayname') || '';
            log.debug('_labelCuenta', `ID=${accountId} num="${num}" name="${name}"`);
            if (num && name) return `<b>${escapeHtml(num)}</b> · ${escapeHtml(name)} <span style="color:#888;">(ID ${accountId})</span>`;
            if (num) return `<b>${escapeHtml(num)}</b> <span style="color:#888;">(ID ${accountId})</span>`;
            if (name) return `${escapeHtml(name)} <span style="color:#888;">(ID ${accountId})</span>`;
        } catch (e) {
            log.error('_labelCuenta', `ID=${accountId} error: ${e.message}`);
        }
        return `ID ${accountId}`;
    }

    function _pickId(arr) {
        if (Array.isArray(arr) && arr[0]) return arr[0].value;
        return arr || '';
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
