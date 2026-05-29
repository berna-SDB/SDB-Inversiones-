/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 * @NModuleScope SameAccount
 *
 * Borra bills sin pagos y las recrea vinculadas a las POs
 * NO borra bills que ya tengan payments
 * Fix: NO remueve líneas del transform para mantener el vínculo con PO
 */
define(['N/record', 'N/search', 'N/log'], (record, search, log) => {

    const CONFIG = {
        vendor: 22384,
        item: 5013,
        subsidiary: 6,
        location: 125,
        department: 433737,
        letraDoc: 2,
        puntoDeVenta: 1,

        po: {
            ODC12606_USD: 132056,
            ODC12606_ARS: 132057,
            ODC12607_USD: 132058,
            ODC12607_ARS: 132059
        }
    };

    const BILL_DATA = [
        {
            order: 1, externalId: 'ANTI_12606', oldId: 121932,
            poId: CONFIG.po.ODC12606_USD, exchangeRate: 126, date: '06/01/2025',
            memo: 'Anticipo 35% ODC 12606',
            isAnticipo: true, porcentajeAnticipo: 35, montoAvanceObra: 109044.12,
            quantity: 1, rate: 109044.12, description: 'Anticipo financiero 35% - ODC 12606'
        },
        {
            order: 2, externalId: 'ANTI_12607', oldId: 121933,
            poId: CONFIG.po.ODC12607_USD, exchangeRate: 126, date: '06/01/2025',
            memo: 'Anticipo 35% ODC 12607',
            isAnticipo: true, porcentajeAnticipo: 35, montoAvanceObra: 104131.67,
            quantity: 1, rate: 104131.67, description: 'Anticipo financiero 35% - ODC 12607'
        },
        {
            order: 3, externalId: 'C1_ARS_12606', oldId: 121934,
            poId: CONFIG.po.ODC12606_ARS, exchangeRate: 1, date: '07/01/2025',
            memo: 'Certificado 1 ($) ODC 12606',
            isAnticipo: false,
            quantity: 1, rate: 529670.31, description: 'Cert 1 ARS - Sin desacopio anticipo'
        },
        {
            order: 4, externalId: 'MC1_ARS_12606', oldId: 121935,
            poId: CONFIG.po.ODC12606_ARS, exchangeRate: 1, date: '07/01/2025',
            memo: 'Mayores Costos Cert 1 ($) ODC 12606',
            isAnticipo: false,
            quantity: 1, rate: 55241.11, description: 'Mayores Costos Cert 1 ARS'
        },
        {
            order: 5, externalId: 'C1_USD_12606', oldId: 121922,
            poId: CONFIG.po.ODC12606_USD, exchangeRate: 130.25, date: '07/01/2025',
            memo: 'Certificado 1 (U$S) ODC 12606',
            isAnticipo: false,
            quantity: 1, rate: 1263.72, description: 'Cert 1 USD - Desacopio 35% = U$S 680.46'
        },
        {
            order: 6, externalId: 'C2_ARS_12606', oldId: 121936,
            poId: CONFIG.po.ODC12606_ARS, exchangeRate: 1, date: '09/01/2025',
            memo: 'Certificado 2 ($) ODC 12606',
            isAnticipo: false,
            quantity: 1, rate: 3365745.99, description: 'Cert 2 ARS'
        },
        {
            order: 7, externalId: 'MC2_ARS_12606', oldId: 121923,
            poId: CONFIG.po.ODC12606_ARS, exchangeRate: 1, date: '09/01/2025',
            memo: 'Mayores Costos Cert 2 ($) ODC 12606',
            isAnticipo: false,
            quantity: 1, rate: 874115.22, description: 'Mayores Costos Cert 2 ARS'
        },
        {
            order: 8, externalId: 'C2_USD_12606', oldId: 121924,
            poId: CONFIG.po.ODC12606_USD, exchangeRate: 145, date: '09/01/2025',
            memo: 'Certificado 2 (U$S) ODC 12606',
            isAnticipo: false,
            quantity: 1, rate: 3698.56, description: 'Cert 2 USD - Desacopio 35% = U$S 1991.53'
        },
        {
            order: 9, externalId: 'C3_ARS_12606', oldId: 121925,
            poId: CONFIG.po.ODC12606_ARS, exchangeRate: 1, date: '10/01/2025',
            memo: 'Certificado 3 ($) ODC 12606',
            isAnticipo: false,
            quantity: 1, rate: 379294.80, description: 'Cert 3 ARS'
        },
        {
            order: 10, externalId: 'MC3_ARS_12606', oldId: 121926,
            poId: CONFIG.po.ODC12606_ARS, exchangeRate: 1, date: '10/01/2025',
            memo: 'Mayores Costos Cert 3 ($) ODC 12606',
            isAnticipo: false,
            quantity: 1, rate: 98506.35, description: 'Mayores Costos Cert 3 ARS'
        },
        {
            order: 11, externalId: 'C3_USD_12606', oldId: 121927,
            poId: CONFIG.po.ODC12606_USD, exchangeRate: 153.25, date: '10/01/2025',
            memo: 'Certificado 3 (U$S) ODC 12606',
            isAnticipo: false,
            quantity: 1, rate: 533.15, description: 'Cert 3 USD - Desacopio 35% = U$S 287.08'
        },
        {
            order: 12, externalId: 'C4_ARS_12606', oldId: 121928,
            poId: CONFIG.po.ODC12606_ARS, exchangeRate: 1, date: '11/01/2025',
            memo: 'Certificado 4 ($) ODC 12606',
            isAnticipo: false,
            quantity: 1, rate: 7021740.11, description: 'Cert 4 ARS'
        },
        {
            order: 13, externalId: 'C1_ARS_12607', oldId: 121929,
            poId: CONFIG.po.ODC12607_ARS, exchangeRate: 1, date: '11/01/2025',
            memo: 'Certificado 1 ($) ODC 12607',
            isAnticipo: false,
            quantity: 1, rate: 2551102.24, description: 'Cert 1 ARS ODC 12607'
        },
        {
            order: 14, externalId: 'C4_USD_12606', oldId: 121930,
            poId: CONFIG.po.ODC12606_USD, exchangeRate: 164, date: '11/01/2025',
            memo: 'Certificado 4 (U$S) ODC 12606',
            isAnticipo: false,
            quantity: 1, rate: 31269.87, description: 'Cert 4 USD - Desacopio 35% = U$S 16837.62'
        },
        {
            order: 15, externalId: 'C1_USD_12607', oldId: 121931,
            poId: CONFIG.po.ODC12607_USD, exchangeRate: 164, date: '11/01/2025',
            memo: 'Certificado 1 (U$S) ODC 12607',
            isAnticipo: false,
            quantity: 1, rate: 26952.48, description: 'Cert 1 USD ODC 12607 - Desacopio 35% = U$S 14512.87'
        },
        // ─── V3: bills nuevas transformadas desde POs V2, fechas +1 mes ──────────────
        {
            order: 16, externalId: 'ANTI_12606_V3', oldId: 0,
            poId: CONFIG.po.ODC12606_USD, exchangeRate: 126, date: '07/01/2025',
            memo: 'Anticipo 35% ODC 12606 (V3)',
            isAnticipo: true, porcentajeAnticipo: 35, montoAvanceObra: 109044.12,
            quantity: 1, rate: 109044.12, description: 'Anticipo financiero 35% - ODC 12606'
        },
        {
            order: 17, externalId: 'ANTI_12607_V3', oldId: 0,
            poId: CONFIG.po.ODC12607_USD, exchangeRate: 126, date: '07/01/2025',
            memo: 'Anticipo 35% ODC 12607 (V3)',
            isAnticipo: true, porcentajeAnticipo: 35, montoAvanceObra: 104131.67,
            quantity: 1, rate: 104131.67, description: 'Anticipo financiero 35% - ODC 12607'
        },
        {
            order: 18, externalId: 'C1_ARS_12606_V3', oldId: 0,
            poId: CONFIG.po.ODC12606_ARS, exchangeRate: 1, date: '08/01/2025',
            memo: 'Certificado 1 ($) ODC 12606 (V3)',
            isAnticipo: false,
            quantity: 1, rate: 529670.31, description: 'Cert 1 ARS - Sin desacopio anticipo'
        },
        {
            order: 19, externalId: 'MC1_ARS_12606_V3', oldId: 0,
            poId: CONFIG.po.ODC12606_ARS, exchangeRate: 1, date: '08/01/2025',
            memo: 'Mayores Costos Cert 1 ($) ODC 12606 (V3)',
            isAnticipo: false,
            quantity: 1, rate: 55241.11, description: 'Mayores Costos Cert 1 ARS'
        },
        {
            order: 20, externalId: 'C1_USD_12606_V3', oldId: 0,
            poId: CONFIG.po.ODC12606_USD, exchangeRate: 130.25, date: '08/01/2025',
            memo: 'Certificado 1 (U$S) ODC 12606 (V3)',
            isAnticipo: false,
            quantity: 1, rate: 1263.72, description: 'Cert 1 USD - Desacopio 35% = U$S 680.46'
        },
        {
            order: 21, externalId: 'C2_ARS_12606_V3', oldId: 0,
            poId: CONFIG.po.ODC12606_ARS, exchangeRate: 1, date: '10/01/2025',
            memo: 'Certificado 2 ($) ODC 12606 (V3)',
            isAnticipo: false,
            quantity: 1, rate: 3365745.99, description: 'Cert 2 ARS'
        },
        {
            order: 22, externalId: 'MC2_ARS_12606_V3', oldId: 0,
            poId: CONFIG.po.ODC12606_ARS, exchangeRate: 1, date: '10/01/2025',
            memo: 'Mayores Costos Cert 2 ($) ODC 12606 (V3)',
            isAnticipo: false,
            quantity: 1, rate: 874115.22, description: 'Mayores Costos Cert 2 ARS'
        },
        {
            order: 23, externalId: 'C2_USD_12606_V3', oldId: 0,
            poId: CONFIG.po.ODC12606_USD, exchangeRate: 145, date: '10/01/2025',
            memo: 'Certificado 2 (U$S) ODC 12606 (V3)',
            isAnticipo: false,
            quantity: 1, rate: 3698.56, description: 'Cert 2 USD - Desacopio 35% = U$S 1991.53'
        },
        {
            order: 24, externalId: 'C3_ARS_12606_V3', oldId: 0,
            poId: CONFIG.po.ODC12606_ARS, exchangeRate: 1, date: '11/01/2025',
            memo: 'Certificado 3 ($) ODC 12606 (V3)',
            isAnticipo: false,
            quantity: 1, rate: 379294.80, description: 'Cert 3 ARS'
        },
        {
            order: 25, externalId: 'MC3_ARS_12606_V3', oldId: 0,
            poId: CONFIG.po.ODC12606_ARS, exchangeRate: 1, date: '11/01/2025',
            memo: 'Mayores Costos Cert 3 ($) ODC 12606 (V3)',
            
            isAnticipo: false,
            quantity: 1, rate: 98506.35, description: 'Mayores Costos Cert 3 ARS'
        },
        {
            order: 26, externalId: 'C3_USD_12606_V3', oldId: 0,
            poId: CONFIG.po.ODC12606_USD, exchangeRate: 153.25, date: '11/01/2025',
            memo: 'Certificado 3 (U$S) ODC 12606 (V3)',
            isAnticipo: false,
            quantity: 1, rate: 533.15, description: 'Cert 3 USD - Desacopio 35% = U$S 287.08'
        },
        {
            order: 27, externalId: 'C4_ARS_12606_V3', oldId: 0,
            poId: CONFIG.po.ODC12606_ARS, exchangeRate: 1, date: '12/01/2025',
            memo: 'Certificado 4 ($) ODC 12606 (V3)',
            isAnticipo: false,
            quantity: 1, rate: 7021740.11, description: 'Cert 4 ARS'
        },
        {
            order: 28, externalId: 'C1_ARS_12607_V3', oldId: 0,
            poId: CONFIG.po.ODC12607_ARS, exchangeRate: 1, date: '12/01/2025',
            memo: 'Certificado 1 ($) ODC 12607 (V3)',
            isAnticipo: false,
            quantity: 1, rate: 2551102.24, description: 'Cert 1 ARS ODC 12607'
        },
        {
            order: 29, externalId: 'C4_USD_12606_V3', oldId: 0,
            poId: CONFIG.po.ODC12606_USD, exchangeRate: 164, date: '12/01/2025',
            memo: 'Certificado 4 (U$S) ODC 12606 (V3)',
            isAnticipo: false,
            quantity: 1, rate: 31269.87, description: 'Cert 4 USD - Desacopio 35% = U$S 16837.62'
        },
        {
            order: 30, externalId: 'C1_USD_12607_V3', oldId: 0,
            poId: CONFIG.po.ODC12607_USD, exchangeRate: 164, date: '12/01/2025',
            memo: 'Certificado 1 (U$S) ODC 12607 (V3)',
            isAnticipo: false,
            quantity: 1, rate: 26952.48, description: 'Cert 1 USD ODC 12607 - Desacopio 35% = U$S 14512.87'
        }
    ];

    // MODE = 'BILLS' | 'CREATE_POS' | 'CREATE_POS_FROM_SCRATCH' | 'CREATE_ANTICIPOS' | 'CREATE_CERTS' | 'CREATE_RECEIPTS' | 'DELETE_RECEIPTS' | 'DELETE_PAYMENTS'
    const MODE = 'CREATE_CERTS';

    /**
     * Busca PO por externalId (evita duplicados al re-correr)
     */
    const buscarPoPorExternalId = (externalId) => {
        try {
            const results = search.create({
                type: search.Type.PURCHASE_ORDER,
                filters: [['externalid', 'is', externalId]],
                columns: ['internalid']
            }).run().getRange({ start: 0, end: 1 });
            return results.length > 0 ? results[0].id : null;
        } catch (e) {
            return null;
        }
    };

    /**
     * Copia una PO existente cambiando quantity=10 en cada línea y asignando nuevo externalId
     */
    const copiarPOConQty10 = (originalPoId, newExternalId) => {
        const existente = buscarPoPorExternalId(newExternalId);
        if (existente) {
            log.audit({ title: `PO V2 ya existe`, details: `ExtId: ${newExternalId} → ID: ${existente}` });
            return { id: existente, action: 'ALREADY_EXISTS' };
        }

        try {
            const po = record.copy({
                type: record.Type.PURCHASE_ORDER,
                id: originalPoId,
                isDynamic: true
            });

            po.setValue({ fieldId: 'externalid', value: newExternalId });

            const lineCount = po.getLineCount({ sublistId: 'item' });
            for (let i = 0; i < lineCount; i++) {
                po.selectLine({ sublistId: 'item', line: i });
                const rate = po.getCurrentSublistValue({ sublistId: 'item', fieldId: 'rate' });
                po.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: 10 });
                if (rate) {
                    po.setCurrentSublistValue({ sublistId: 'item', fieldId: 'amount', value: rate * 10 });
                }
                po.commitLine({ sublistId: 'item' });
            }

            const newId = po.save({ enableSourcing: true, ignoreMandatoryFields: false });
            log.audit({ title: `PO V2 creada`, details: `Original: ${originalPoId} → New: ${newId} | ExtId: ${newExternalId}` });
            return { id: newId, action: 'CREATED' };
        } catch (e) {
            log.error({ title: `Error copiando PO ${originalPoId}`, details: `${e.name}: ${e.message}` });
            return { id: null, action: 'FAILED', error: e.message };
        }
    };

    /**
     * Crea una PO desde cero (sin copiar de otra existente)
     */
    const crearPODesdeZero = (externalId, currency, exchangeRate) => {
        const existente = buscarPoPorExternalId(externalId);
        if (existente) {
            log.audit({ title: `PO ya existe`, details: `ExtId: ${externalId} → ID: ${existente}` });
            return { id: existente, action: 'ALREADY_EXISTS' };
        }

        try {
            const po = record.create({ type: record.Type.PURCHASE_ORDER, isDynamic: true });
            po.setValue({ fieldId: 'entity', value: CONFIG.vendor });
            po.setValue({ fieldId: 'subsidiary', value: CONFIG.subsidiary });
            po.setValue({ fieldId: 'currency', value: currency });
            if (exchangeRate) po.setValue({ fieldId: 'exchangerate', value: exchangeRate });
            po.setValue({ fieldId: 'externalid', value: externalId });

            po.selectNewLine({ sublistId: 'item' });
            po.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: CONFIG.item });
            po.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: 10 });
            po.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate', value: 1 });
            po.setCurrentSublistValue({ sublistId: 'item', fieldId: 'amount', value: 10 });
            if (CONFIG.location) po.setCurrentSublistValue({ sublistId: 'item', fieldId: 'location', value: CONFIG.location });
            if (CONFIG.department) po.setCurrentSublistValue({ sublistId: 'item', fieldId: 'department', value: CONFIG.department });
            po.commitLine({ sublistId: 'item' });

            const newId = po.save({ enableSourcing: true, ignoreMandatoryFields: false });
            log.audit({ title: `PO creada desde cero`, details: `ExtId: ${externalId} → ID: ${newId} | curr ${currency} | TC ${exchangeRate || 1}` });
            return { id: newId, action: 'CREATED' };
        } catch (e) {
            log.error({ title: `Error creando PO ${externalId}`, details: `${e.name}: ${e.message}` });
            return { id: null, action: 'FAILED', error: e.message };
        }
    };

    /**
     * Crea las 4 POs V2 desde cero (sin copiar nada — para sandbox refresheado)
     */
    const crearTodasLasPOsDesdeZero = () => {
        const USD = 2, ARS = 1;
        const mapping = [
            { externalId: 'ODC12606_USD_V2', currency: USD, exchangeRate: 126 },
            { externalId: 'ODC12606_ARS_V2', currency: ARS, exchangeRate: 1 },
            { externalId: 'ODC12607_USD_V2', currency: USD, exchangeRate: 126 },
            { externalId: 'ODC12607_ARS_V2', currency: ARS, exchangeRate: 1 }
        ];

        const results = mapping.map(m => {
            const r = crearPODesdeZero(m.externalId, m.currency, m.exchangeRate);
            return { externalId: m.externalId, newId: r.id, action: r.action, error: r.error };
        });

        log.audit({ title: 'RESULTADO POs from scratch', details: JSON.stringify(results, null, 2) });
        const created = results.filter(r => r.action === 'CREATED').length;
        const existed = results.filter(r => r.action === 'ALREADY_EXISTS').length;
        const failed = results.filter(r => r.action === 'FAILED').length;
        log.audit({ title: 'FIN POs', details: `Creadas: ${created} | Ya existían: ${existed} | Errores: ${failed}` });
    };

    /**
     * Crea las 4 POs V2 basadas en las existentes con quantity=10
     */
    const crearTodasLasPOsV2 = () => {
        const mapping = [
            { originalId: CONFIG.po.ODC12606_USD, externalId: 'ODC12606_USD_V2' },
            { originalId: CONFIG.po.ODC12606_ARS, externalId: 'ODC12606_ARS_V2' },
            { originalId: CONFIG.po.ODC12607_USD, externalId: 'ODC12607_USD_V2' },
            { originalId: CONFIG.po.ODC12607_ARS, externalId: 'ODC12607_ARS_V2' }
        ];

        const results = mapping.map(m => {
            const r = copiarPOConQty10(m.originalId, m.externalId);
            return { originalId: m.originalId, externalId: m.externalId, newId: r.id, action: r.action };
        });

        log.audit({ title: 'RESULTADO POs V2', details: JSON.stringify(results, null, 2) });
        const created = results.filter(r => r.action === 'CREATED').length;
        const existed = results.filter(r => r.action === 'ALREADY_EXISTS').length;
        const failed = results.filter(r => r.action === 'FAILED').length;
        log.audit({ title: 'FIN POs', details: `Creadas: ${created} | Ya existían: ${existed} | Errores: ${failed}` });
    };

    /**
     * Busca todas las bills por externalId (puede haber duplicados si falló una corrida previa)
     */
    const buscarBillsPorExternalId = (externalId) => {
        try {
            const results = search.create({
                type: search.Type.VENDOR_BILL,
                filters: [['externalid', 'is', externalId]],
                columns: ['internalid']
            }).run().getRange({ start: 0, end: 100 });
            return results.map(r => r.id);
        } catch (e) {
            log.error({ title: `Error buscando bill por externalId ${externalId}`, details: e.message });
            return [];
        }
    };

    /**
     * Verifica si una bill tiene payments aplicados
     */
    const tienePayment = (billId) => {
        try {
            const results = search.create({
                type: search.Type.VENDOR_PAYMENT,
                filters: [
                    ['appliedtotransaction', 'anyof', [billId]]
                ],
                columns: ['internalid']
            }).run().getRange({ start: 0, end: 1 });
            return results.length > 0;
        } catch (e) {
            return false;
        }
    };

    /**
     * Borra una bill
     */
    const borrarBill = (billId) => {
        try {
            record.delete({ type: record.Type.VENDOR_BILL, id: billId });
            log.audit({ title: 'Bill BORRADA', details: `ID: ${billId}` });
            return true;
        } catch (e) {
            log.error({ title: `Error borrando bill ${billId}`, details: e.message });
            return false;
        }
    };

    /**
     * Crea una bill desde PO usando transform SIN remover líneas
     */
    const crearBill = (data) => {
        try {
            const bill = record.transform({
                fromType: record.Type.PURCHASE_ORDER,
                fromId: data.poId,
                toType: record.Type.VENDOR_BILL,
                isDynamic: true
            });

            // Header
            bill.setValue({ fieldId: 'trandate', value: new Date(data.date) });
            bill.setValue({ fieldId: 'exchangerate', value: data.exchangeRate });
            bill.setValue({ fieldId: 'memo', value: data.memo });
            bill.setValue({ fieldId: 'externalid', value: data.externalId });
            if (CONFIG.location) bill.setValue({ fieldId: 'location', value: CONFIG.location });
            if (CONFIG.department) bill.setValue({ fieldId: 'department', value: CONFIG.department });

            // Localización
            bill.setValue({ fieldId: 'custbody_sdb_fecha_factura_prov', value: new Date(data.date) });
            bill.setValue({ fieldId: 'custbody_sdb_ar_letra_documento', value: CONFIG.letraDoc });
            bill.setValue({ fieldId: 'custbody_sdb_ar_punto_de_venta', value: CONFIG.puntoDeVenta });
            bill.setValue({ fieldId: 'custbody_sdb_ar_numero', value: String(data.order) });

            // Contrato de obra
            bill.setValue({ fieldId: 'custbody_sdb_contrato_obra_', value: true });

            // Anticipo
            if (data.isAnticipo) {
                bill.setValue({ fieldId: 'custbody_sdb_factura_anticipo', value: true });
                bill.setValue({ fieldId: 'custbody_sdb_porcentaje_anticipo_', value: data.porcentajeAnticipo });
                if (data.montoAvanceObra) {
                    bill.setValue({ fieldId: 'custbody_sdb_ar_monto_de_avance_obra', value: data.montoAvanceObra });
                }
            } else {
                bill.setValue({ fieldId: 'custbody_sdb_factura_anticipo', value: false });
            }

            // Modificar la primera línea del transform (NO borrar)
            const lineCount = bill.getLineCount({ sublistId: 'item' });

            // Ajustar primera línea
            if (lineCount > 0) {
                bill.selectLine({ sublistId: 'item', line: 0 });
                bill.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: data.quantity });
                bill.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate', value: data.rate });
                bill.setCurrentSublistValue({ sublistId: 'item', fieldId: 'amount', value: data.rate * data.quantity });
                bill.setCurrentSublistValue({ sublistId: 'item', fieldId: 'description', value: data.description });
                bill.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_sdb_ar_regimen_fiscal_select', value: 3844 });

                const montoBruto = data.rate * data.quantity;
                const subtotalSinIVA = montoBruto / 1.21;
                const montoIVA = montoBruto - subtotalSinIVA;
                bill.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_ar_ar_monto_bruto_calculo', value: montoBruto });
                bill.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_ar_subtotal_sin_iva_ficticio', value: subtotalSinIVA });
                bill.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_sdb_ar_monto_iva_ficticio', value: montoIVA });

                if (CONFIG.location) {
                    bill.setCurrentSublistValue({ sublistId: 'item', fieldId: 'location', value: CONFIG.location });
                }
                if (CONFIG.department) {
                    bill.setCurrentSublistValue({ sublistId: 'item', fieldId: 'department', value: CONFIG.department });
                }

                bill.commitLine({ sublistId: 'item' });
            }

            // Remover líneas extras (de atrás para adelante, dejando la primera)
            for (let i = lineCount - 1; i > 0; i--) {
                bill.removeLine({ sublistId: 'item', line: i });
            }

            const billId = bill.save({ enableSourcing: true, ignoreMandatoryFields: false });

            log.audit({
                title: `Bill #${data.order} Creada`,
                details: `${data.externalId} → ID: ${billId} | PO: ${data.poId} | ${data.isAnticipo ? 'ANTICIPO' : 'CERT'} | TC: ${data.exchangeRate}`
            });

            return billId;

        } catch (e) {
            log.error({
                title: `Error creando bill #${data.order} ${data.externalId}`,
                details: `${e.name}: ${e.message}`
            });
            return null;
        }
    };

    /**
     * Busca un Item Receipt por externalId
     */
    const buscarReceiptPorExternalId = (externalId) => {
        try {
            const results = search.create({
                type: search.Type.ITEM_RECEIPT,
                filters: [['externalid', 'is', externalId]],
                columns: ['internalid']
            }).run().getRange({ start: 0, end: 1 });
            return results.length > 0 ? results[0].id : null;
        } catch (e) {
            return null;
        }
    };

    // Mapeo de PO V1 → externalId de V2 (para resolver la V2 real, que es la que acepta IR)
    const PO_V1_TO_V2_EXTID = {
        [CONFIG.po.ODC12606_USD]: 'ODC12606_USD_V2',
        [CONFIG.po.ODC12606_ARS]: 'ODC12606_ARS_V2',
        [CONFIG.po.ODC12607_USD]: 'ODC12607_USD_V2',
        [CONFIG.po.ODC12607_ARS]: 'ODC12607_ARS_V2'
    };

    /**
     * Crea un Item Receipt desde la PO V2 (resuelta por externalId), qty=1 en línea 0, externalId = RCP_<billExternalId>
     */
    const crearItemReceipt = (data) => {
        const extIdReceipt = `RCP_${data.externalId}`;
        const existente = buscarReceiptPorExternalId(extIdReceipt);
        if (existente) {
            log.audit({ title: `IR ya existe`, details: `${extIdReceipt} → ID ${existente}` });
            return { id: existente, action: 'ALREADY_EXISTS' };
        }

        // Resolver PO V2 (la V1 no acepta IR → INVALID_INITIALIZE_REF)
        const poV2ExtId = PO_V1_TO_V2_EXTID[data.poId];
        if (!poV2ExtId) {
            log.error({ title: `Mapeo faltante V1→V2`, details: `poId ${data.poId} no tiene mapeo` });
            return { id: null, action: 'FAILED', error: `PO V1 ${data.poId} sin mapeo V2` };
        }
        const poV2Id = buscarPoPorExternalId(poV2ExtId);
        if (!poV2Id) {
            log.error({ title: `PO V2 no encontrada`, details: `ExtId: ${poV2ExtId}` });
            return { id: null, action: 'FAILED', error: `PO V2 ${poV2ExtId} no existe en NS` };
        }

        try {
            const ir = record.transform({
                fromType: record.Type.PURCHASE_ORDER,
                fromId: poV2Id,
                toType: record.Type.ITEM_RECEIPT,
                isDynamic: true
            });

            ir.setValue({ fieldId: 'trandate', value: new Date(data.date) });
            ir.setValue({ fieldId: 'externalid', value: extIdReceipt });
            ir.setValue({ fieldId: 'memo', value: `Recepción ${data.memo || data.externalId}` });

            const lineCount = ir.getLineCount({ sublistId: 'item' });
            if (lineCount === 0) {
                throw new Error('IR sin líneas disponibles (PO ya recibida totalmente)');
            }

            // Marcar solo la primera línea, qty=1; las demás desmarcadas
            for (let i = 0; i < lineCount; i++) {
                ir.selectLine({ sublistId: 'item', line: i });
                if (i === 0) {
                    ir.setCurrentSublistValue({ sublistId: 'item', fieldId: 'itemreceive', value: true });
                    ir.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: 1 });
                    if (CONFIG.location) ir.setCurrentSublistValue({ sublistId: 'item', fieldId: 'location', value: CONFIG.location });
                    if (CONFIG.department) ir.setCurrentSublistValue({ sublistId: 'item', fieldId: 'department', value: CONFIG.department });
                } else {
                    ir.setCurrentSublistValue({ sublistId: 'item', fieldId: 'itemreceive', value: false });
                }
                ir.commitLine({ sublistId: 'item' });
            }

            const irId = ir.save({ enableSourcing: true, ignoreMandatoryFields: false });
            log.audit({ title: `IR Creado`, details: `${extIdReceipt} → ID ${irId} | PO V2 ${poV2Id} (${poV2ExtId}) | Bill ${data.externalId}` });
            return { id: irId, action: 'CREATED' };
        } catch (e) {
            log.error({ title: `Error creando IR ${extIdReceipt}`, details: `${e.name}: ${e.message}` });
            return { id: null, action: 'FAILED', error: e.message };
        }
    };

    /**
     * Borra TODOS los item receipts con externalId RCP_*
     */
    const borrarTodosReceipts = () => {
        const receipts = search.create({
            type: search.Type.ITEM_RECEIPT,
            filters: [
                ['externalidstring', 'startswith', 'RCP_'],
                'AND', ['mainline', 'is', 'T']
            ],
            columns: ['internalid', 'externalid']
        }).run().getRange({ start: 0, end: 1000 });

        let ok = 0; const errs = [];
        receipts.forEach(r => {
            const id = r.getValue('internalid');
            try {
                record.delete({ type: record.Type.ITEM_RECEIPT, id: id });
                log.audit({ title: 'IR borrado', details: `ID ${id} (${r.getValue('externalid')})` });
                ok++;
            } catch (e) {
                log.error({ title: `Error borrando IR ${id}`, details: e.message });
                errs.push(`${id}: ${e.message}`);
            }
        });
        log.audit({ title: 'FIN DELETE_RECEIPTS', details: `Encontrados: ${receipts.length} | Borrados: ${ok} | Errores: ${errs.length}` });
        if (errs.length) log.audit({ title: 'Errores detalle', details: errs.join(' | ') });
    };

    /**
     * Borra TODOS los vendor payments aplicados a bills V3 del vendor
     */
    const borrarTodosPaymentsV3 = () => {
        const bills = search.create({
            type: search.Type.VENDOR_BILL,
            filters: [
                ['externalidstring', 'contains', '_V3'],
                'AND', ['mainline', 'is', 'T'],
                'AND', ['entity', 'anyof', CONFIG.vendor]
            ],
            columns: ['internalid']
        }).run().getRange({ start: 0, end: 500 });
        const billIds = bills.map(b => b.getValue('internalid'));

        if (billIds.length === 0) {
            log.audit({ title: 'DELETE_PAYMENTS', details: 'No hay bills V3' });
            return;
        }

        const applyLines = search.create({
            type: search.Type.VENDOR_PAYMENT,
            filters: [['appliedtotransaction', 'anyof', billIds]],
            columns: ['internalid']
        }).run().getRange({ start: 0, end: 1000 });

        const uniquePayIds = Array.from(new Set(applyLines.map(r => r.getValue('internalid'))));

        let ok = 0; const errs = [];
        uniquePayIds.forEach(id => {
            try {
                record.delete({ type: record.Type.VENDOR_PAYMENT, id: id });
                log.audit({ title: 'Payment borrado', details: `ID ${id}` });
                ok++;
            } catch (e) {
                log.error({ title: `Error borrando Payment ${id}`, details: e.message });
                errs.push(`${id}: ${e.message}`);
            }
        });
        log.audit({ title: 'FIN DELETE_PAYMENTS', details: `Bills V3: ${billIds.length} | Payments únicos: ${uniquePayIds.length} | Borrados: ${ok} | Errores: ${errs.length}` });
        if (errs.length) log.audit({ title: 'Errores detalle', details: errs.join(' | ') });
    };

    /**
     * Entry point
     */
    const execute = (context) => {
        if (MODE === 'CREATE_POS') {
            log.audit({ title: 'INICIO', details: 'Modo: CREATE_POS (crea 4 POs V2 con qty 10)' });
            crearTodasLasPOsV2();
            return;
        }

        if (MODE === 'CREATE_POS_FROM_SCRATCH') {
            log.audit({ title: 'INICIO', details: 'Modo: CREATE_POS_FROM_SCRATCH (crea 4 POs desde cero)' });
            crearTodasLasPOsDesdeZero();
            return;
        }

        if (MODE === 'CREATE_CERTS') {
            log.audit({ title: 'INICIO', details: 'Modo: CREATE_CERTS (crea bills NO-anticipo, set V2)' });
            const certs = BILL_DATA.filter(d => !d.isAnticipo && !d.externalId.includes('_V3'));
            const results = [];
            certs.forEach(data => {
                const existentes = buscarBillsPorExternalId(data.externalId);
                if (existentes.length > 0) {
                    log.audit({ title: `Cert ${data.externalId} ya existe`, details: `IDs: ${existentes.join(',')}` });
                    results.push({ order: data.order, externalId: data.externalId, newId: existentes[0], action: 'ALREADY_EXISTS' });
                    return;
                }
                const newId = crearBill(data);
                results.push({ order: data.order, externalId: data.externalId, poId: data.poId, newId: newId, action: newId ? 'CREATED' : 'FAILED' });
            });
            log.audit({ title: 'RESULTADO CERTS', details: JSON.stringify(results, null, 2) });
            const created = results.filter(r => r.action === 'CREATED').length;
            const existed = results.filter(r => r.action === 'ALREADY_EXISTS').length;
            const failed = results.filter(r => r.action === 'FAILED').length;
            log.audit({ title: 'FIN CERTS', details: `Creados: ${created} | Ya existían: ${existed} | Errores: ${failed}` });
            return;
        }

        if (MODE === 'CREATE_ANTICIPOS') {
            log.audit({ title: 'INICIO', details: 'Modo: CREATE_ANTICIPOS (crea solo bills isAnticipo, set V2)' });
            const anticipos = BILL_DATA.filter(d => d.isAnticipo && !d.externalId.includes('_V3'));
            const results = [];
            anticipos.forEach(data => {
                const existentes = buscarBillsPorExternalId(data.externalId);
                if (existentes.length > 0) {
                    log.audit({ title: `Anticipo ${data.externalId} ya existe`, details: `IDs: ${existentes.join(',')}` });
                    results.push({ order: data.order, externalId: data.externalId, newId: existentes[0], action: 'ALREADY_EXISTS' });
                    return;
                }
                const newId = crearBill(data);
                results.push({ order: data.order, externalId: data.externalId, poId: data.poId, newId: newId, action: newId ? 'CREATED' : 'FAILED' });
            });
            log.audit({ title: 'RESULTADO ANTICIPOS', details: JSON.stringify(results, null, 2) });
            const created = results.filter(r => r.action === 'CREATED').length;
            const existed = results.filter(r => r.action === 'ALREADY_EXISTS').length;
            const failed = results.filter(r => r.action === 'FAILED').length;
            log.audit({ title: 'FIN ANTICIPOS', details: `Creados: ${created} | Ya existían: ${existed} | Errores: ${failed}` });
            return;
        }

        if (MODE === 'DELETE_RECEIPTS') {
            log.audit({ title: 'INICIO', details: 'Modo: DELETE_RECEIPTS (borra todos los IR RCP_*)' });
            borrarTodosReceipts();
            return;
        }

        if (MODE === 'DELETE_PAYMENTS') {
            log.audit({ title: 'INICIO', details: 'Modo: DELETE_PAYMENTS (borra payments aplicados a bills V3)' });
            borrarTodosPaymentsV3();
            return;
        }

        if (MODE === 'CREATE_RECEIPTS') {
            log.audit({ title: 'INICIO', details: 'Modo: CREATE_RECEIPTS (genera IR RCP_* por cada bill NO-ANTICIPO)' });
            const results = [];
            BILL_DATA.forEach(data => {
                if (data.deleteOnly) return;
                if (data.isAnticipo) {
                    log.audit({ title: `Bill ${data.externalId} SKIP`, details: 'Anticipo → no lleva IR' });
                    results.push({ order: data.order, externalId: data.externalId, poId: data.poId, irId: null, action: 'SKIP_ANTICIPO' });
                    return;
                }
                const r = crearItemReceipt(data);
                results.push({ order: data.order, externalId: data.externalId, poId: data.poId, irId: r.id, action: r.action, error: r.error });
            });
            log.audit({ title: 'RESULTADO IRs', details: JSON.stringify(results, null, 2) });
            const created = results.filter(r => r.action === 'CREATED').length;
            const existed = results.filter(r => r.action === 'ALREADY_EXISTS').length;
            const skipped = results.filter(r => r.action === 'SKIP_ANTICIPO').length;
            const failed = results.filter(r => r.action === 'FAILED').length;
            log.audit({ title: 'FIN IRs', details: `Creados: ${created} | Ya existían: ${existed} | Anticipos skip: ${skipped} | Errores: ${failed}` });
            return;
        }

        log.audit({ title: 'INICIO', details: 'Borrar bills sin pago y recrear' });

        const results = [];

        BILL_DATA.forEach(data => {
            // Buscar todas las bills que existan con ese externalId (corridas previas pueden haber dejado duplicados)
            const existentes = buscarBillsPorExternalId(data.externalId);
            const candidatos = existentes.length > 0
                ? existentes
                : (data.oldId > 0 ? [data.oldId] : []);

            // Si alguna de las bills existentes tiene payment, la dejamos como está y skip
            const conPayment = candidatos.find(id => tienePayment(id));
            if (conPayment) {
                log.audit({ title: `Bill #${data.order} SKIP`, details: `ExtId ${data.externalId} tiene bill con payment (ID ${conPayment}) — no se toca` });
                results.push({ order: data.order, externalId: data.externalId, oldId: data.oldId, newId: conPayment, action: 'KEPT' });
                return;
            }

            // Borrar todas las existentes (sin payment)
            let algunaBorrada = false;
            let errorBorrado = false;
            candidatos.forEach(id => {
                if (borrarBill(id)) {
                    algunaBorrada = true;
                } else {
                    // Si falla borrar una que sí existe, marcamos error
                    const sigueExistiendo = buscarBillsPorExternalId(data.externalId).indexOf(id) !== -1;
                    if (sigueExistiendo) errorBorrado = true;
                }
            });

            if (errorBorrado) {
                results.push({ order: data.order, externalId: data.externalId, oldId: data.oldId, newId: null, action: 'DELETE_FAILED' });
                return;
            }

            // deleteOnly: borrar sin recrear
            if (data.deleteOnly) {
                results.push({
                    order: data.order,
                    externalId: data.externalId,
                    oldId: data.oldId,
                    newId: null,
                    action: algunaBorrada ? 'DELETED_ONLY' : 'NOT_FOUND'
                });
                return;
            }

            // Recrear
            const newId = crearBill(data);
            results.push({
                order: data.order,
                externalId: data.externalId,
                oldId: data.oldId,
                newId: newId,
                action: newId ? (algunaBorrada ? 'RECREATED' : 'CREATED_FRESH') : 'CREATE_FAILED'
            });
        });

        log.audit({ title: 'RESULTADO', details: JSON.stringify(results, null, 2) });

        const recreated = results.filter(r => r.action === 'RECREATED').length;
        const createdFresh = results.filter(r => r.action === 'CREATED_FRESH').length;
        const kept = results.filter(r => r.action === 'KEPT').length;
        const failed = results.filter(r => r.action.includes('FAILED')).length;

        log.audit({ title: 'FIN', details: `Recreadas: ${recreated} | Nuevas: ${createdFresh} | Mantenidas (con pago): ${kept} | Errores: ${failed}` });
    };

    return { execute };
});