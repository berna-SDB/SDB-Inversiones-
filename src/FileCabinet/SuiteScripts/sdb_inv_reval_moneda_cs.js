/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 *
 * Client Script del Suitelet "Revaluación de Moneda".
 * Al cambiar la fecha, completa el Tipo de Cambio con el exchange rate de la cuenta
 * (endpoint action=lookup_tc del propio Suitelet → currency.exchangeRate). El campo
 * queda editable: el usuario puede pisar el valor a mano.
 *
 * La URL del endpoint la provee el Suitelet (campo oculto custpage_lookup_url, resuelto
 * con url.resolveScript) para que el fetch lleve script/deploy/hash correctos.
 */
define([], function () {

    function isoDate(d) {
        var y = d.getFullYear();
        var m = ('0' + (d.getMonth() + 1)).slice(-2);
        var day = ('0' + d.getDate()).slice(-2);
        return y + '-' + m + '-' + day;
    }

    function actualizarTc(rec, soloSiVacio) {
        var fecha = rec.getValue({ fieldId: 'custpage_fecha_reval' });
        if (!fecha || !(fecha instanceof Date)) return;
        if (soloSiVacio) {
            var cur = rec.getValue({ fieldId: 'custpage_tc' });
            if (cur && parseFloat(cur) > 0) return;
        }
        var base = rec.getValue({ fieldId: 'custpage_lookup_url' }) || '';
        if (!base) { console.error('[TC reval-moneda] sin custpage_lookup_url'); return; }
        var u = base + '&fecha=' + encodeURIComponent(isoDate(fecha));
        fetch(u, { credentials: 'same-origin' })
            .then(function (r) { return r.text(); })
            .then(function (txt) {
                var d;
                try { d = JSON.parse(txt); } catch (e) { console.error('[TC reval-moneda] respuesta no-JSON', txt.slice(0, 120)); return; }
                if (d && typeof d.tc !== 'undefined') {
                    rec.setValue({ fieldId: 'custpage_tc', value: parseFloat(d.tc) || 0, ignoreFieldChange: true });
                }
            })
            .catch(function (e) { console.error('[TC reval-moneda] fetch err', e); });
    }

    function pageInit(context) {
        try { actualizarTc(context.currentRecord, true); } catch (e) { console.error('[TC reval-moneda] pageInit', e); }
    }

    function fieldChanged(context) {
        if (context.fieldId === 'custpage_fecha_reval') {
            try { actualizarTc(context.currentRecord, false); } catch (e) { console.error('[TC reval-moneda] fieldChanged', e); }
        }
    }

    return { pageInit: pageInit, fieldChanged: fieldChanged };
});
