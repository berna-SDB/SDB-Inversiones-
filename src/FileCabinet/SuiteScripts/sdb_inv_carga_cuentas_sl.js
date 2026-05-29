/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * Carga masiva de Cuentas Contables (Chart of Accounts) desde el WIP UCA.
 * Crea las cuentas que no existan. Si ya existen (match por acctnumber), no hace nada.
 */
define(['N/ui/serverWidget', 'N/search', 'N/record', 'N/log'],
(serverWidget, search, record, log) => {

    const SUBSIDIARY_ID = '6'; // ARG
    const CURRENCY_ARS = 1;
    const CURRENCY_USD = 2;

    const CUENTAS = [
        // ─── Bancos pesos ─────────────────────────────────────────
        { num: '111.11.03', name: 'Valores a Depositar - M/L',                 type: 'OthCurrAsset', currency: CURRENCY_ARS },
        { num: '111.21.04', name: 'Banco Galicia c/c 53398/4/999/7',           type: 'Bank',         currency: CURRENCY_ARS },
        { num: '111.21.19', name: 'Banco Galicia c/c 71084-0 999-3 Fundraising', type: 'Bank',       currency: CURRENCY_ARS },
        { num: '111.21.58', name: 'Alic Balanz $',                             type: 'Bank',         currency: CURRENCY_ARS },

        // ─── Bancos dólares ──────────────────────────────────────
        { num: '111.22.02', name: 'Banco Santander c/c (u$s) 250-750710/8',    type: 'Bank',         currency: CURRENCY_USD },
        { num: '111.22.03', name: 'Alic Balanz U$S',                           type: 'Bank',         currency: CURRENCY_USD },
        { num: '111.22.07', name: 'Banco Santander c/c (u$s) 575-045269/6',    type: 'Bank',         currency: CURRENCY_USD },

        // ─── Títulos ──────────────────────────────────────────────
        { num: '112.11.05', name: 'Títulos Alic Balanz',                       type: 'OthCurrAsset', currency: CURRENCY_USD },

        // ─── Plazo Fijo pesos ─────────────────────────────────────
        { num: '112.21.01', name: 'Plazo Fijo Comafi Pesos',                   type: 'OthCurrAsset', currency: CURRENCY_ARS },
        { num: '112.21.02', name: 'Plazo Fijo Rio Pesos',                      type: 'OthCurrAsset', currency: CURRENCY_ARS },
        { num: '112.21.03', name: 'Plazo Fijo Galicia Pesos',                  type: 'OthCurrAsset', currency: CURRENCY_ARS },
        { num: '112.21.04', name: 'Plazo Fijo Frances Pesos',                  type: 'OthCurrAsset', currency: CURRENCY_ARS },
        { num: '112.21.05', name: 'Plazo Fijo Banco Macro Pesos',              type: 'OthCurrAsset', currency: CURRENCY_ARS },
        { num: '112.21.06', name: 'Plazo Fijo Macro (Dcho. Rosario) Pesos',    type: 'OthCurrAsset', currency: CURRENCY_ARS },
        { num: '112.21.07', name: 'Plazo Fijo Bco. Credicoop (Paraná) Pesos',  type: 'OthCurrAsset', currency: CURRENCY_ARS },
        { num: '112.21.08', name: 'Plazo Fijo Bco. Bersa (Paraná) Pesos',      type: 'OthCurrAsset', currency: CURRENCY_ARS },
        { num: '112.21.09', name: 'Plazo Fijo HSBC Pesos',                     type: 'OthCurrAsset', currency: CURRENCY_ARS },
        { num: '112.21.10', name: 'Plazo Fijo Bco Municipal Rosario Pesos',    type: 'OthCurrAsset', currency: CURRENCY_ARS },
        { num: '112.21.12', name: 'Plazo Fijo Bco. Santander Rio (Paraná) Pesos', type: 'OthCurrAsset', currency: CURRENCY_ARS },
        { num: '112.21.50', name: 'Int. a Devengar Plazo Fijo Pesos',          type: 'OthCurrAsset', currency: CURRENCY_ARS },

        // ─── Plazo Fijo dólares ──────────────────────────────────
        { num: '112.22.01', name: 'Plazo Fijo Santander Dólares',              type: 'OthCurrAsset', currency: CURRENCY_USD },
        { num: '112.22.02', name: 'Plazo Fijo Macro Dólares',                  type: 'OthCurrAsset', currency: CURRENCY_USD },
        { num: '112.22.50', name: 'Int. a Devengar Plazo Fijo U$S',            type: 'OthCurrAsset', currency: CURRENCY_USD },

        // ─── Fondos de Inversión pesos ───────────────────────────
        { num: '112.41.01', name: 'Fondo de Inversión Santander Rio Pesos',    type: 'OthCurrAsset', currency: CURRENCY_ARS },
        { num: '112.41.02', name: 'Fondo de Inversión Galicia Pesos',          type: 'OthCurrAsset', currency: CURRENCY_ARS },
        { num: '112.41.03', name: 'Fondo de Inversión Francés Pesos',          type: 'OthCurrAsset', currency: CURRENCY_ARS },
        { num: '112.41.04', name: 'Fondo de Inversión Comafi Pesos',           type: 'OthCurrAsset', currency: CURRENCY_ARS },
        { num: '112.41.05', name: 'Fondo de Inversión Macro Pesos',            type: 'OthCurrAsset', currency: CURRENCY_ARS },
        { num: '112.41.06', name: 'Fondo de Inversión HSBC Pesos',             type: 'OthCurrAsset', currency: CURRENCY_ARS },
        { num: '112.41.07', name: 'Fondo de Inversión Galicia Pesos UCA Tec',  type: 'OthCurrAsset', currency: CURRENCY_ARS },
        { num: '112.41.08', name: 'Fondo de Inversión Galicia Pesos Red de Universidades Católicas', type: 'OthCurrAsset', currency: CURRENCY_ARS },
        { num: '112.41.09', name: 'Fondo de Inversión Supervielle Pesos',      type: 'OthCurrAsset', currency: CURRENCY_ARS },
        { num: '112.41.10', name: 'Fondo de Inversión Galicia Pesos Fundraising', type: 'OthCurrAsset', currency: CURRENCY_ARS },

        // ─── Fondos de Inversión dólares ──────────────────────────
        { num: '112.42.01', name: 'Fondo de Inversión Santander Rio Dólares',  type: 'OthCurrAsset', currency: CURRENCY_USD },
        { num: '112.42.02', name: 'Fondo de Inversión Galicia Dólares',        type: 'OthCurrAsset', currency: CURRENCY_USD },
        { num: '112.42.03', name: 'Fondo de Inversión Francés Dólares',        type: 'OthCurrAsset', currency: CURRENCY_USD },
        { num: '112.42.04', name: 'Fondo de Inversión Comafi Dólares',         type: 'OthCurrAsset', currency: CURRENCY_USD },
        { num: '112.42.05', name: 'Fondo de Inversión Macro Dólares',          type: 'OthCurrAsset', currency: CURRENCY_USD },

        // ─── Comisiones ──────────────────────────────────────────
        { num: '785.00.14', name: 'Comisiones por servicio de recaudación bancaria', type: 'Expense', currency: CURRENCY_ARS },

        // ─── Intereses ───────────────────────────────────────────
        { num: '812.00.02', name: 'Intereses p/depósitos a plazo fijo - pesos', type: 'Income',     currency: CURRENCY_ARS },

        // ─── Diferencias de Cambio / Cotización ──────────────────
        { num: '813.00.01', name: 'Diferencia de Cotización',                  type: 'OthIncome',    currency: CURRENCY_ARS },
        { num: '813.00.02', name: 'Diferencia de Cambio',                      type: 'OthIncome',    currency: CURRENCY_ARS },
        { num: '822.00.02', name: 'Diferencia de Cambio',                      type: 'OthExpense',   currency: CURRENCY_ARS }
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
        const form = serverWidget.createForm({ title: 'Carga Masiva de Cuentas Contables' });
        const html = form.addField({ id: 'custpage_info', type: serverWidget.FieldType.INLINEHTML, label: ' ' });
        let body = '<div style="padding:10px 14px;font-size:14px;">';
        body += `<p>Crea <b>${CUENTAS.length}</b> cuentas en SB2 (subsidiary ARG). Si ya existen (match por acctnumber), las salta.</p>`;
        if (resultadoMsg) {
            body += `<div style="margin:10px 0;padding:10px;border:1px solid #c9cdd4;background:#f5f6f8;">${resultadoMsg}</div>`;
        }
        body += '</div>';
        html.defaultValue = body;
        form.addSubmitButton({ label: 'Cargar' });
        context.response.writePage(form);
    }

    function procesarCarga() {
        const filas = [];
        let creadas = 0, existian = 0, errores = 0;

        CUENTAS.forEach(c => {
            try {
                const existingId = _findAccountByNumber(c.num);
                if (existingId) {
                    filas.push({ num: c.num, name: c.name, action: 'EXISTS', id: existingId });
                    existian++;
                    return;
                }
                const id = _createAccount(c);
                filas.push({ num: c.num, name: c.name, action: 'CREATED', id: id });
                creadas++;
            } catch (e) {
                filas.push({ num: c.num, name: c.name, action: 'ERROR', error: e.message });
                errores++;
                log.error(`Cuenta ${c.num}`, e.message);
            }
        });

        let html = `<b>Resumen:</b> ${creadas} creadas, ${existian} ya existían, ${errores} errores.`;
        html += '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:8px;">';
        html += '<thead><tr style="background:#f4f6f8;">';
        html += '<th style="border:1px solid #c9cdd4;padding:5px;text-align:left;">Número</th>';
        html += '<th style="border:1px solid #c9cdd4;padding:5px;text-align:left;">Nombre</th>';
        html += '<th style="border:1px solid #c9cdd4;padding:5px;text-align:left;">Acción</th>';
        html += '<th style="border:1px solid #c9cdd4;padding:5px;text-align:left;">ID / Error</th>';
        html += '</tr></thead><tbody>';
        filas.forEach(f => {
            const color = f.action === 'ERROR' ? '#c62828' : (f.action === 'CREATED' ? '#2e7d32' : '#888');
            const last = f.error ? `<span style="color:#c62828;">${escapeHtml(f.error)}</span>` : f.id;
            html += `<tr><td style="border:1px solid #c9cdd4;padding:5px;font-family:monospace;">${escapeHtml(f.num)}</td>`;
            html += `<td style="border:1px solid #c9cdd4;padding:5px;">${escapeHtml(f.name)}</td>`;
            html += `<td style="border:1px solid #c9cdd4;padding:5px;color:${color};font-weight:600;">${f.action}</td>`;
            html += `<td style="border:1px solid #c9cdd4;padding:5px;">${last}</td></tr>`;
        });
        html += '</tbody></table>';
        return html;
    }

    function _findAccountByNumber(num) {
        try {
            const res = search.create({
                type: 'account',
                filters: [['acctnumber', 'is', num], 'AND', ['isinactive', 'is', 'F']],
                columns: ['internalid']
            }).run().getRange({ start: 0, end: 1 });
            if (res.length > 0) return res[0].id;
        } catch (e) {
            log.error(`_findAccountByNumber ${num}`, e.message);
        }
        return null;
    }

    function _createAccount(c) {
        const rec = record.create({ type: 'account' });
        rec.setValue('acctnumber', c.num);
        rec.setValue('acctname', c.name);
        rec.setValue('accttype', c.type);
        rec.setValue('currency', c.currency);
        rec.setValue('subsidiary', [SUBSIDIARY_ID]);
        return rec.save();
    }

    function escapeHtml(s) {
        return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    return { onRequest };
});
