/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * Carga masiva de Instituciones Financieras del WIP UCA.
 * IDs de cuentas hardcodeados (resueltos via SuiteQL en SB2).
 * Idempotente: si la institución existe (match por name), actualiza; sino crea.
 */
define(['N/ui/serverWidget', 'N/search', 'N/record', 'N/log'],
(serverWidget, search, record, log) => {

    const TIPO_NAC = 1; // val_nacional
    const TIPO_EXT = 2; // val_exterior
    const ARS = 1;
    const USD = 2;

    // Mapping cuenta_numero → internal ID en SB2 (resuelto 2026-05-14 via SuiteQL)
    const A = {
        '111.11.03': 136, '111.21.04': 149, '111.21.19': 164, '111.21.58': 184,
        '111.22.02': 195, '111.22.03': 196, '111.22.04': 197, '111.22.06': 199, '111.22.07': 200,
        '112.11.05': 205,
        '112.21.01': 207, '112.21.02': 208, '112.21.03': 209, '112.21.04': 210,
        '112.21.05': 211, '112.21.06': 212, '112.21.07': 213, '112.21.08': 214,
        '112.21.09': 215, '112.21.10': 216, '112.21.12': 217, '112.21.50': 218,
        '112.22.01': 219, '112.22.02': 220, '112.22.50': 221,
        '112.41.01': 223, '112.41.02': 224, '112.41.03': 225, '112.41.04': 226,
        '112.41.05': 227, '112.41.06': 228, '112.41.07': 229, '112.41.08': 1443,
        '112.41.09': 230, '112.41.10': 231,
        '112.42.01': 232, '112.42.02': 233, '112.42.03': 234, '112.42.04': 235, '112.42.05': 236
    };

    const INSTITUCIONES = [
        { name: 'Galicia', tipo: TIPO_NAC, moneda: ARS, f: {
            custrecord_sdb_instfin_cta_banco_ars: A['111.21.04'],
            custrecord_sdb_instfin_cta_banco_usd: A['111.22.04'],
            custrecord_sdb_instfin_cta_act_pf_ars: A['112.21.03'],
            custrecord_sdb_instfin_cta_act_fci_ars: A['112.41.02'],
            custrecord_sdb_instfin_cta_act_fci_usd: A['112.42.02'],
            custrecord_sdb_instfin_cta_int_dev_ars: A['112.21.50'],
            custrecord_sdb_instfin_cta_int_dev_usd: A['112.22.50']
        }},
        { name: 'Santander Río', tipo: TIPO_NAC, moneda: ARS, f: {
            custrecord_sdb_instfin_cta_banco_usd: A['111.22.02'],
            custrecord_sdb_instfin_cta_act_pf_ars: A['112.21.02'],
            custrecord_sdb_instfin_cta_act_pf_usd: A['112.22.01'],
            custrecord_sdb_instfin_cta_act_fci_ars: A['112.41.01'],
            custrecord_sdb_instfin_cta_act_fci_usd: A['112.42.01'],
            custrecord_sdb_instfin_cta_int_dev_ars: A['112.21.50'],
            custrecord_sdb_instfin_cta_int_dev_usd: A['112.22.50']
        }},
        { name: 'Comafi', tipo: TIPO_NAC, moneda: ARS, f: {
            custrecord_sdb_instfin_cta_act_pf_ars: A['112.21.01'],
            custrecord_sdb_instfin_cta_act_fci_ars: A['112.41.04'],
            custrecord_sdb_instfin_cta_act_fci_usd: A['112.42.04'],
            custrecord_sdb_instfin_cta_int_dev_ars: A['112.21.50'],
            custrecord_sdb_instfin_cta_int_dev_usd: A['112.22.50']
        }},
        { name: 'Francés (BBVA)', tipo: TIPO_NAC, moneda: ARS, f: {
            custrecord_sdb_instfin_cta_act_pf_ars: A['112.21.04'],
            custrecord_sdb_instfin_cta_act_fci_ars: A['112.41.03'],
            custrecord_sdb_instfin_cta_act_fci_usd: A['112.42.03'],
            custrecord_sdb_instfin_cta_int_dev_ars: A['112.21.50'],
            custrecord_sdb_instfin_cta_int_dev_usd: A['112.22.50']
        }},
        { name: 'Macro', tipo: TIPO_NAC, moneda: ARS, f: {
            custrecord_sdb_instfin_cta_banco_usd: A['111.22.06'],
            custrecord_sdb_instfin_cta_act_pf_ars: A['112.21.05'],
            custrecord_sdb_instfin_cta_act_pf_usd: A['112.22.02'],
            custrecord_sdb_instfin_cta_act_fci_ars: A['112.41.05'],
            custrecord_sdb_instfin_cta_act_fci_usd: A['112.42.05'],
            custrecord_sdb_instfin_cta_int_dev_ars: A['112.21.50'],
            custrecord_sdb_instfin_cta_int_dev_usd: A['112.22.50']
        }},
        { name: 'Macro Dcho. Rosario', tipo: TIPO_NAC, moneda: ARS, f: {
            custrecord_sdb_instfin_cta_act_pf_ars: A['112.21.06'],
            custrecord_sdb_instfin_cta_int_dev_ars: A['112.21.50']
        }},
        { name: 'Credicoop (Paraná)', tipo: TIPO_NAC, moneda: ARS, f: {
            custrecord_sdb_instfin_cta_act_pf_ars: A['112.21.07'],
            custrecord_sdb_instfin_cta_int_dev_ars: A['112.21.50']
        }},
        { name: 'Bersa (Paraná)', tipo: TIPO_NAC, moneda: ARS, f: {
            custrecord_sdb_instfin_cta_act_pf_ars: A['112.21.08'],
            custrecord_sdb_instfin_cta_int_dev_ars: A['112.21.50']
        }},
        { name: 'HSBC', tipo: TIPO_NAC, moneda: ARS, f: {
            custrecord_sdb_instfin_cta_act_pf_ars: A['112.21.09'],
            custrecord_sdb_instfin_cta_act_fci_ars: A['112.41.06'],
            custrecord_sdb_instfin_cta_int_dev_ars: A['112.21.50'],
            custrecord_sdb_instfin_cta_int_dev_usd: A['112.22.50']
        }},
        { name: 'Bco Municipal Rosario', tipo: TIPO_NAC, moneda: ARS, f: {
            custrecord_sdb_instfin_cta_act_pf_ars: A['112.21.10'],
            custrecord_sdb_instfin_cta_int_dev_ars: A['112.21.50']
        }},
        { name: 'Supervielle', tipo: TIPO_NAC, moneda: ARS, f: {
            custrecord_sdb_instfin_cta_act_fci_ars: A['112.41.09']
        }},
        { name: 'Balanz (Alic)', tipo: TIPO_NAC, moneda: ARS, f: {
            custrecord_sdb_instfin_cta_banco_ars: A['111.21.58'],
            custrecord_sdb_instfin_cta_banco_usd: A['111.22.03'],
            custrecord_sdb_instfin_cta_act_bono_usd: A['112.11.05']
        }},
        { name: 'PICTET', tipo: TIPO_EXT, moneda: USD, f: {} },
        { name: 'JP Morgan', tipo: TIPO_EXT, moneda: USD, f: {} }
    ];

    function onRequest(context) {
        let resultadoMsg = '';
        if (context.request.method === 'POST') {
            try {
                resultadoMsg = procesarCarga();
            } catch (e) {
                log.error('procesarCarga', e.message + ' | ' + (e.stack || ''));
                resultadoMsg = `<span style="color:#c62828;">ERROR: ${escapeHtml(e.message)}</span>`;
            }
        }
        mostrarForm(context, resultadoMsg);
    }

    function mostrarForm(context, resultadoMsg) {
        const form = serverWidget.createForm({ title: 'Carga Masiva de Instituciones Financieras' });
        const html = form.addField({ id: 'custpage_info', type: serverWidget.FieldType.INLINEHTML, label: ' ' });
        let body = '<div style="padding:10px 14px;font-size:14px;">';
        body += `<p>Crea/actualiza <b>${INSTITUCIONES.length}</b> instituciones del WIP UCA. IDs de cuentas hardcodeados.</p>`;
        body += '<p>Idempotente: match por nombre. Si existe → UPDATE, sino → CREATE.</p>';
        if (resultadoMsg) {
            body += `<div style="margin:10px 0;padding:10px;border:1px solid #c9cdd4;background:#f5f6f8;">${resultadoMsg}</div>`;
        }
        body += '</div>';
        html.defaultValue = body;
        form.addSubmitButton({ label: 'Cargar / Actualizar' });
        context.response.writePage(form);
    }

    function procesarCarga() {
        const filas = [];
        let creadas = 0, actualizadas = 0, errores = 0;

        INSTITUCIONES.forEach(inst => {
            try {
                const values = Object.assign({
                    custrecord_sdb_instfin_tipo: inst.tipo,
                    custrecord_sdb_instfin_moneda: inst.moneda
                }, inst.f);

                const existingId = _findInstByName(inst.name);
                let recId, action;
                if (existingId) {
                    record.submitFields({
                        type: 'customrecord_sdb_inv_inst_financiera',
                        id: existingId,
                        values: values
                    });
                    recId = existingId;
                    action = 'UPDATED';
                    actualizadas++;
                } else {
                    const rec = record.create({ type: 'customrecord_sdb_inv_inst_financiera' });
                    rec.setValue('name', inst.name);
                    Object.keys(values).forEach(fid => rec.setValue(fid, values[fid]));
                    recId = rec.save();
                    action = 'CREATED';
                    creadas++;
                }

                filas.push({ name: inst.name, action: action, id: recId });
                log.audit('Inst', `${inst.name} ${action} ID=${recId}`);
            } catch (e) {
                filas.push({ name: inst.name, action: 'ERROR', id: '', error: e.message });
                errores++;
                log.error(`Inst ${inst.name}`, e.message);
            }
        });

        let html = `<b>Resumen:</b> ${creadas} creadas, ${actualizadas} actualizadas, ${errores} errores.`;
        html += '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:8px;">';
        html += '<thead><tr style="background:#f4f6f8;">';
        html += '<th style="border:1px solid #c9cdd4;padding:5px;text-align:left;">Institución</th>';
        html += '<th style="border:1px solid #c9cdd4;padding:5px;text-align:left;">Acción</th>';
        html += '<th style="border:1px solid #c9cdd4;padding:5px;text-align:left;">ID / Error</th>';
        html += '</tr></thead><tbody>';
        filas.forEach(f => {
            const color = f.action === 'ERROR' ? '#c62828' : (f.action === 'CREATED' ? '#2e7d32' : '#1565c0');
            const last = f.error ? `<span style="color:#c62828;">${escapeHtml(f.error)}</span>` : f.id;
            html += `<tr><td style="border:1px solid #c9cdd4;padding:5px;">${escapeHtml(f.name)}</td>`;
            html += `<td style="border:1px solid #c9cdd4;padding:5px;color:${color};font-weight:600;">${f.action}</td>`;
            html += `<td style="border:1px solid #c9cdd4;padding:5px;">${last}</td></tr>`;
        });
        html += '</tbody></table>';
        return html;
    }

    function _findInstByName(name) {
        try {
            const res = search.create({
                type: 'customrecord_sdb_inv_inst_financiera',
                filters: [['name', 'is', name], 'AND', ['isinactive', 'is', 'F']],
                columns: ['internalid']
            }).run().getRange({ start: 0, end: 1 });
            if (res.length > 0) return res[0].id;
        } catch (e) {
            log.error(`_findInstByName ${name}`, e.message);
        }
        return null;
    }

    function escapeHtml(s) {
        return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    return { onRequest };
});
