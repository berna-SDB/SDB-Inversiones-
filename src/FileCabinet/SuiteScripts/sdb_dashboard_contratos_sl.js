/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * Dashboard de contratos ACLIMATAR V3 agrupado por PO.
 * Muestra Bills + Payment + Receipt (USD) por cada Purchase Order V2.
 */
define(['N/ui/serverWidget', 'N/search', 'N/url'], (ui, search, url) => {

    const VENDOR_ID = 22384;

    const buscarTx = (type, filters, columns) => {
        try {
            return search.create({ type, filters, columns }).run().getRange({ start: 0, end: 500 });
        } catch (e) {
            return [];
        }
    };

    const linkTx = (recordType, id, labelOpt) => {
        if (!id) return '';
        const u = url.resolveRecord({ recordType, recordId: id });
        return `<a href="${u}" target="_blank" class="tx-link">${labelOpt || id}</a>`;
    };

    const fmt = (n) => {
        if (n === null || n === undefined || n === '') return '—';
        const num = typeof n === 'number' ? n : parseFloat(String(n).replace(/,/g, ''));
        if (isNaN(num)) return String(n);
        return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const onRequest = (context) => {
        if (context.request.method !== 'GET') return;

        const form = ui.createForm({ title: 'Dashboard Contratos ACLIMATAR V3 (por PO)' });

        // ─── POs V2 ──────────────────────────────────────────────────────
        const pos = buscarTx('purchaseorder', [
            ['externalidstring', 'contains', '_V2'], 'AND',
            ['mainline', 'is', 'T'], 'AND',
            ['entity', 'anyof', VENDOR_ID]
        ], ['internalid', 'externalid', 'tranid', 'trandate', 'amount', 'currency', 'memo']);

        const poIdsForBills = pos.map(p => p.getValue('internalid'));

        // ─── Bills colgadas de las POs V2 (sin importar externalId convention) ───
        const bills = poIdsForBills.length > 0 ? buscarTx('vendorbill', [
            ['createdfrom', 'anyof', poIdsForBills], 'AND',
            ['mainline', 'is', 'T'], 'AND',
            ['entity', 'anyof', VENDOR_ID]
        ], ['internalid', 'externalid', 'tranid', 'trandate', 'amount', 'currency', 'memo', 'custbody_sdb_factura_anticipo', 'createdfrom']) : [];

        const billIds = bills.map(b => b.getValue('internalid'));
        const billExtIdToId = {};
        bills.forEach(b => { billExtIdToId[b.getValue('externalid')] = b.getValue('internalid'); });

        // ─── Mapeo Bill → Payment ──────────────────────────────────────
        const paymentByBillId = {};
        if (billIds.length > 0) {
            const applyLines = search.create({
                type: 'vendorpayment',
                filters: [['appliedtotransaction', 'anyof', billIds]],
                columns: ['internalid', 'appliedtotransaction']
            }).run().getRange({ start: 0, end: 1000 });
            applyLines.forEach(r => {
                const payId = r.getValue('internalid');
                const billId = r.getValue('appliedtotransaction');
                if (billId && !paymentByBillId[billId]) paymentByBillId[billId] = payId;
            });
        }

        // ─── Info mainline de los payments ──────────────────────────────
        const uniquePaymentIds = Object.values(paymentByBillId);
        const paymentInfo = {};
        if (uniquePaymentIds.length > 0) {
            const payments = buscarTx('vendorpayment', [
                ['internalid', 'anyof', uniquePaymentIds], 'AND',
                ['mainline', 'is', 'T']
            ], ['internalid', 'tranid', 'trandate', 'amount', 'currency', 'memo']);
            payments.forEach(p => {
                paymentInfo[p.getValue('internalid')] = {
                    tranid: p.getValue('tranid'),
                    trandate: p.getValue('trandate'),
                    amount: p.getValue('amount'),
                    currency: p.getText('currency'),
                    memo: p.getValue('memo')
                };
            });
        }

        // ─── Item Receipts (vinculados a Bill via custbody_sdb_bill_origen) ────
        const receipts = billIds.length > 0 ? buscarTx('itemreceipt', [
            ['custbody_sdb_bill_origen', 'anyof', billIds], 'AND',
            ['mainline', 'is', 'T']
        ], ['internalid', 'externalid', 'tranid', 'trandate', 'amount', 'memo', 'custbody_sdb_bill_origen']) : [];
        // key: bill internalId (del custbody)
        const receiptByBillId = {};
        receipts.forEach(r => {
            const billOrigen = r.getValue('custbody_sdb_bill_origen');
            if (billOrigen && !receiptByBillId[billOrigen]) receiptByBillId[billOrigen] = r;
        });

        // ─── Agrupar bills por PO ─────────────────────────────────────
        const billsByPoId = {};
        bills.forEach(b => {
            const poId = b.getValue('createdfrom');
            if (!poId) return;
            if (!billsByPoId[poId]) billsByPoId[poId] = [];
            billsByPoId[poId].push(b);
        });

        // ─── Journal Entries vinculados a las POs V2 (custbody_sdb_oc_asiento_tc) ──
        const jes = poIdsForBills.length > 0 ? buscarTx('journalentry', [
            ['custbody_sdb_oc_asiento_tc', 'anyof', poIdsForBills], 'AND',
            ['mainline', 'is', 'T']
        ], ['internalid', 'tranid', 'trandate', 'amount', 'currency', 'memo', 'custbody_sdb_oc_asiento_tc']) : [];
        const jesByPoId = {};
        const jeIdsSeen = new Set();
        jes.forEach(je => {
            const poId = je.getValue('custbody_sdb_oc_asiento_tc');
            const jeId = je.getValue('internalid');
            if (!poId || !jeId) return;
            if (jeIdsSeen.has(jeId)) return; // dedup: 1 línea por JE
            jeIdsSeen.add(jeId);
            if (!jesByPoId[poId]) jesByPoId[poId] = [];
            jesByPoId[poId].push(je);
        });

        // ─── Render por PO ─────────────────────────────────────────────
        const renderPoSection = (po) => {
            const poId = po.getValue('internalid');
            const billsOfPo = billsByPoId[poId] || [];

            const billRows = billsOfPo.map(b => {
                const billId = b.getValue('internalid');
                const billExtId = b.getValue('externalid');
                const isAnt = b.getValue('custbody_sdb_factura_anticipo');
                const badge = isAnt
                    ? '<span class="badge anticipo">Anticipo</span>'
                    : '<span class="badge cert">Certificado</span>';
                const ccy = b.getText('currency') === 'Dólar Estadounidense' ? 'USD' :
                            b.getText('currency') === 'Peso Argentino' ? 'ARS' :
                            (b.getText('currency') || '');

                const payId = paymentByBillId[billId];
                const payInfo = payId ? paymentInfo[payId] : null;
                const payCell = payInfo
                    ? `${linkTx('vendorpayment', payId, payInfo.tranid || payId)} <span class="sub">${fmt(payInfo.amount)} ${payInfo.currency === 'Dólar Estadounidense' ? 'USD' : payInfo.currency === 'Peso Argentino' ? 'ARS' : ''}</span>`
                    : '<span class="empty">—</span>';

                const rcp = receiptByBillId[billId];
                const rcpCell = rcp
                    ? `${linkTx('itemreceipt', rcp.getValue('internalid'), rcp.getValue('tranid') || rcp.getValue('internalid'))} <span class="sub">${fmt(rcp.getValue('amount'))}</span>`
                    : '<span class="empty">—</span>';

                return `
                <tr>
                    <td>${linkTx('vendorbill', billId)}</td>
                    <td>${billExtId || ''}</td>
                    <td>${b.getValue('tranid') || ''}</td>
                    <td>${b.getValue('trandate') || ''}</td>
                    <td>${badge}</td>
                    <td>${ccy}</td>
                    <td class="num">${fmt(b.getValue('amount'))}</td>
                    <td class="memo">${b.getValue('memo') || ''}</td>
                    <td>${payCell}</td>
                    <td>${rcpCell}</td>
                </tr>`;
            }).join('');

            const totalBills = billsOfPo.reduce((s, b) => s + parseFloat(b.getValue('amount') || 0), 0);
            const poCcy = po.getText('currency') === 'Dólar Estadounidense' ? 'USD' :
                          po.getText('currency') === 'Peso Argentino' ? 'ARS' :
                          (po.getText('currency') || '');

            const jesOfPo = jesByPoId[poId] || [];
            const jeRows = jesOfPo.map(je => {
                const jeId = je.getValue('internalid');
                const jeCcy = je.getText('currency') === 'Dólar Estadounidense' ? 'USD' :
                              je.getText('currency') === 'Peso Argentino' ? 'ARS' :
                              (je.getText('currency') || '');
                return `
                <tr>
                    <td>${linkTx('journalentry', jeId)}</td>
                    <td>${je.getValue('tranid') || ''}</td>
                    <td>${je.getValue('trandate') || ''}</td>
                    <td>${jeCcy}</td>
                    <td class="num">${fmt(je.getValue('amount'))}</td>
                    <td class="memo">${je.getValue('memo') || ''}</td>
                </tr>`;
            }).join('');

            return `
<div class="po-card">
    <div class="po-header">
        <div class="po-title">
            ${linkTx('purchaseorder', poId)} · <strong>${po.getValue('externalid')}</strong>
            <span class="po-meta">${po.getValue('tranid') || ''} · ${po.getValue('trandate') || ''} · ${poCcy}</span>
        </div>
        <div class="po-totals">
            <div><span class="po-label">PO total:</span> <span class="po-value">${fmt(po.getValue('amount'))}</span></div>
            <div><span class="po-label">Bills (${billsOfPo.length}):</span> <span class="po-value">${fmt(totalBills)}</span></div>
            <div><span class="po-label">JEs (${jesOfPo.length}):</span> <span class="po-value">${fmt(jesOfPo.reduce((s, j) => s + parseFloat(j.getValue('amount') || 0), 0))}</span></div>
        </div>
    </div>
    ${billsOfPo.length > 0 ? `
    <table class="dash-table">
        <thead>
            <tr>
                <th>Bill ID</th><th>External ID</th><th>Nº</th><th>Fecha</th>
                <th>Tipo</th><th>Ccy</th><th>Monto</th><th>Memo</th>
                <th>Payment</th><th>Receipt</th>
            </tr>
        </thead>
        <tbody>${billRows}</tbody>
    </table>` : '<p class="empty-state">Sin bills asociadas</p>'}
    ${jesOfPo.length > 0 ? `
    <div class="je-section">
        <div class="je-header">Asientos de diferencia de cambio asociados</div>
        <table class="dash-table">
            <thead>
                <tr>
                    <th>JE ID</th><th>Nº</th><th>Fecha</th><th>Ccy</th><th>Monto</th><th>Memo</th>
                </tr>
            </thead>
            <tbody>${jeRows}</tbody>
        </table>
    </div>` : ''}
</div>`;
        };

        const poSections = pos.map(renderPoSection).join('');

        const html = `
<style>
    .dash-wrap { padding: 10px 0; }
    .po-card { background: white; border: 1px solid #d7dae4; border-radius: 8px; margin-bottom: 20px; overflow: hidden; }
    .po-header { padding: 14px 18px; background: #1f2937; color: white; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }
    .po-title { font-size: 14px; }
    .po-title strong { color: #fbbf24; }
    .po-meta { color: #9ca3af; font-size: 12px; margin-left: 10px; }
    .po-totals { display: flex; gap: 20px; font-size: 12px; font-family: monospace; }
    .po-label { color: #9ca3af; }
    .po-value { color: #fbbf24; font-weight: 600; }
    table.dash-table { width: 100%; border-collapse: collapse; background: white; font-size: 12px; }
    table.dash-table th { background: #f3f4f6; color: #374151; padding: 8px 10px; text-align: left; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #d1d5db; }
    table.dash-table td { padding: 8px 10px; border-top: 1px solid #e5e7eb; vertical-align: top; }
    table.dash-table tr:hover { background: #f9fafb; }
    table.dash-table .tx-link, .po-header .tx-link { color: #fbbf24; font-weight: 600; font-family: monospace; text-decoration: none; }
    table.dash-table .tx-link { color: #2563eb; }
    .tx-link:hover { text-decoration: underline; }
    .num { font-family: monospace; text-align: right; }
    .badge { padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
    .badge.anticipo { background: #fef3c7; color: #92400e; }
    .badge.cert { background: #dbeafe; color: #1e40af; }
    .memo { color: #6b7280; font-size: 11px; font-style: italic; max-width: 260px; }
    .empty { color: #9ca3af; font-style: italic; }
    .sub { color: #6b7280; font-size: 11px; margin-left: 4px; }
    .empty-state { padding: 20px; color: #9ca3af; font-style: italic; text-align: center; }
    .summary-bar { background: #f4f6fb; border: 1px solid #d7dae4; border-radius: 6px; padding: 12px 18px; margin-bottom: 16px; display: flex; gap: 24px; flex-wrap: wrap; font-size: 13px; }
    .summary-bar span strong { font-family: monospace; color: #1f2937; }
    .je-section { border-top: 2px solid #e5e7eb; background: #fafbfc; }
    .je-header { padding: 8px 14px; font-size: 12px; font-weight: 600; color: #374151; background: #f3f4f6; border-bottom: 1px solid #d1d5db; text-transform: uppercase; letter-spacing: 0.5px; }
</style>
<div class="dash-wrap">
    <div class="summary-bar">
        <span>POs V2: <strong>${pos.length}</strong></span>
        <span>Bills V3: <strong>${bills.length}</strong></span>
        <span>Payments: <strong>${Object.keys(paymentInfo).length}</strong></span>
        <span>Item Receipts: <strong>${receipts.length}</strong></span>
        <span>Journal Entries: <strong>${jes.length}</strong></span>
    </div>
    ${poSections || '<p class="empty-state">Sin POs encontradas</p>'}
</div>`;

        form.addField({
            id: 'custpage_dashboard',
            type: ui.FieldType.INLINEHTML,
            label: 'Dashboard'
        }).defaultValue = html;

        context.response.writePage(form);
    };

    return { onRequest };
});
