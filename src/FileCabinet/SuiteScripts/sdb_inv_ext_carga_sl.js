/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * Carga de cierre de inversiones del exterior.
 * Muestra el estado actual de cada cuenta comitente (cash + instrumentos) y permite:
 *  - actualizar valor/saldo de líneas existentes
 *  - dar de alta líneas nuevas
 *  - dar de baja líneas existentes
 * Al confirmar genera un Journal Entry con las diferencias y actualiza los records.
 */
define(['N/ui/serverWidget', 'N/search', 'N/record', 'N/runtime', 'N/log', 'N/url', 'N/redirect', 'N/currency'],
(serverWidget, search, record, runtime, log, url, redirect, currency) => {

    const REC_COMITENTE    = 'customrecord_sdb_inv_ext_comitente';
    const REC_INSTRUMENTO  = 'customrecord_sdb_inv_ext_instrumento';
    const REC_CASH         = 'customrecord_sdb_inv_ext_cash';
    const REC_TIPO         = 'customrecord_sdb_inv_ext_tipo';
    const SUBSIDIARY_ID    = '6';  // Subsidiaria fija para los asientos del exterior
    const BASE_CURRENCY_ID = '1';  // ARS

    const CUENTA_INTERESES_INVERSIONES = '1025';
    const CUENTA_INVERSIONES_EXTERIOR = '222';

    // ─────────────────────────── ENTRY ────────────────────────────────
    function onRequest(context) {
        // Endpoint JSON: TC por (moneda, fecha) → consumido por el JS de cada fila al cambiar la fecha.
        if (context.request.method === 'GET' && context.request.parameters.action === 'lookup_tc') {
            const fechaStr = context.request.parameters.fecha || '';
            const monedaId = context.request.parameters.moneda || '';
            let tc = 1;
            try {
                tc = _tipoCambio(monedaId, _parseTcDate(fechaStr));
            } catch (e) { /* silent */ }
            context.response.setHeader({ name: 'Content-Type', value: 'application/json' });
            context.response.write(JSON.stringify({ tc: tc }));
            return;
        }

        if (context.request.method === 'POST') {
            let msg = '';
            try {
                msg = procesarCierre(context.request);
            } catch (e) {
                log.error('onRequest POST', e.message + ' | ' + (e.stack || ''));
                msg = `ERROR: ${e.message}`;
            }
            // POST-redirect-GET: evita reprocesar al hacer F5
            const script = runtime.getCurrentScript();
            redirect.toSuitelet({
                scriptId: script.id,
                deploymentId: script.deploymentId,
                parameters: {
                    custpage_comitente: context.request.parameters.custpage_comitente || '',
                    custpage_tipo: context.request.parameters.custpage_tipo || '',
                    msg: msg.substring(0, 1800)
                }
            });
            return;
        }
        const msg = context.request.parameters.msg || '';
        renderForm(context, msg);
    }

    // ─────────────────────────── RENDER ───────────────────────────────
    function renderForm(context, msg) {
        const form = serverWidget.createForm({ title: 'Carga Cierre Inversiones Exterior' });

        const comitenteId = context.request.parameters.custpage_comitente || '';
        const tipoId = context.request.parameters.custpage_tipo || '';
        const comitentes = buscarComitentes();
        const comitenteSel = comitentes.find(c => c.id === comitenteId);
        const ctaOrigenDefault = comitenteSel ? comitenteSel.ctaOrigen : '';
        const tipos = buscarTipos();

        const selCom = form.addField({
            id: 'custpage_comitente',
            type: serverWidget.FieldType.SELECT,
            label: 'Cuenta Comitente'
        });
        selCom.addSelectOption({ value: '', text: '-- Seleccionar --' });
        comitentes.forEach(c => selCom.addSelectOption({
            value: c.id,
            text: c.name,
            isSelected: c.id === comitenteId
        }));

        // Filtro opcional por Tipo de instrumento. Vacío = todos (comportamiento actual).
        // Solo afecta la tabla de Instrumentos; Cash no se filtra.
        const selTipo = form.addField({
            id: 'custpage_tipo',
            type: serverWidget.FieldType.SELECT,
            label: 'Tipo'
        });
        selTipo.addSelectOption({ value: '', text: '-- Todos --' });
        tipos.forEach(t => selTipo.addSelectOption({
            value: t.id,
            text: t.name,
            isSelected: t.id === tipoId
        }));

        if (!comitenteId) {
            const info = form.addField({
                id: 'custpage_info',
                type: serverWidget.FieldType.INLINEHTML,
                label: ' '
            });
            info.defaultValue = '<div style="padding:20px;">Seleccioná una cuenta comitente para empezar.</div>';
            form.addSubmitButton({ label: 'Cargar' });
            context.response.writePage(form);
            return;
        }

        const cashActual  = buscarCash(comitenteId);
        const instActual  = buscarInstrumentos(comitenteId, tipoId);
        const subtipos    = buscarSubtipos();
        const monedas     = buscarMonedas();
        const cuentas     = buscarCuentas();

        // TC de hoy por moneda. La fecha por defecto de las filas es hoy y es igual para todas,
        // así que el TC se calcula una sola vez por moneda (cacheado) y se usa como default del input.
        const _tcHoyCache = {};
        const tcHoy = (monedaId) => {
            const key = String(monedaId || '');
            if (!(key in _tcHoyCache)) _tcHoyCache[key] = _tipoCambio(monedaId, new Date());
            return _tcHoyCache[key];
        };

        const tabla = form.addField({
            id: 'custpage_tabla',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' '
        });
        // Ocupa todo el ancho del form (debajo del comitente); sin esto el INLINEHTML cae en la 2da columna y corta las tablas
        tabla.updateLayoutType({ layoutType: serverWidget.FieldLayoutType.OUTSIDEBELOW });
        tabla.updateBreakType({ breakType: serverWidget.FieldBreakType.STARTROW });

        let html = `<style>
            .ext-wrap{width:100%;overflow-x:auto;}
            .ext-tbl{border-collapse:collapse;font-size:13px;margin:8px 0 20px 0;}
            .ext-tbl th,.ext-tbl td{border:1px solid #c9cdd4;padding:5px 7px;text-align:left;vertical-align:top;}
            .ext-tbl th{background:#f4f6f8;font-weight:600;color:#222;}
            .ext-tbl input,.ext-tbl select{padding:3px 5px;font-size:13px;border:1px solid #c9cdd4;}
            .ext-tbl .num{text-align:right;font-variant-numeric:tabular-nums;}
            .ext-tbl tr.baja{background:#fde2e4;text-decoration:line-through;}
            .ext-h2{font-size:15px;font-weight:600;margin:12px 0 4px 0;}
            .ext-btn{margin:6px 0;padding:5px 10px;cursor:pointer;}
        </style>`;

        if (msg) {
            html += `<div style="padding:10px 14px;margin:8px 0;border:1px solid #c9cdd4;background:#f5f6f8;"><b>Resultado:</b> ${msg}</div>`;
        }

        // Datalist compartido con todas las cuentas — autocomplete por texto
        html += '<datalist id="cuentas_datalist">';
        cuentas.forEach(c => {
            html += `<option value="${escapeHtml(c.name)}"></option>`;
        });
        html += '</datalist>';

        // ─── CUENTA CONTRA (maestro / default para todas las filas) ───
        let masterContraText = '';
        if (ctaOrigenDefault) {
            const fMaster = cuentas.find(c => String(c.id) === String(ctaOrigenDefault));
            if (fMaster) masterContraText = fMaster.name;
        }
        html += '<div class="ext-h2">Cuenta Banco</div>';
        html += '<div style="margin:4px 0 12px 0;">'
              + `<input list="cuentas_datalist" name="ext_contra_master_text" value="${escapeHtml(masterContraText)}" oninput="syncCuenta(this,'ext_contra_master'); applyContraToAll();" style="width:260px;" />`
              + `<input type="hidden" name="ext_contra_master" value="${escapeHtml(ctaOrigenDefault || '')}" />`
              + '<span style="margin-left:10px;color:#666;font-size:12px;">Se aplica a las filas de cash. Podés editar cada fila después.</span>'
              + '</div>';

        // ─── FECHA (maestro / default para todas las filas) ───
        html += '<div class="ext-h2">Fecha</div>';
        html += '<div style="margin:4px 0 12px 0;">'
              + '<input type="date" name="ext_fecha_master" value="' + _hoyIso() + '" onchange="applyFechaToAll()" style="width:200px;" />'
              + '<span style="margin-left:10px;color:#666;font-size:12px;">Se aplica a la fecha de todas las filas (cash e instrumentos) y recalcula el TC. Podés editar cada fila después.</span>'
              + '</div>';

        // ─── CASH ──────────────────────────────────────────────────
        html += '<div class="ext-h2">Cash</div>';
        html += '<div class="ext-wrap">';
        html += '<table class="ext-tbl" id="tbl_cash"><thead><tr>'
              + '<th>ID</th><th>Moneda</th><th>Cuenta Contable</th><th>Cuenta Banco</th>'
              + '<th class="num">Saldo Actual</th><th class="num">Saldo Nuevo</th>'
              + '<th>Fecha</th><th class="num">TC</th><th>Baja</th>'
              + '</tr></thead><tbody>';
        cashActual.forEach((c, i) => {
            html += rowCashExistente(c, i, monedas, cuentas, ctaOrigenDefault, tcHoy(c.moneda));
        });
        html += '</tbody></table>';
        html += '</div>';
        html += `<button type="button" class="ext-btn" onclick="extAddCash()">+ Agregar cash</button>`;

        // ─── INSTRUMENTOS ─────────────────────────────────────────
        html += '<div class="ext-h2">Instrumentos</div>';
        html += '<div class="ext-wrap">';
        html += '<table class="ext-tbl" id="tbl_inst"><thead><tr>'
              + '<th>ID</th><th>Nombre</th><th>ISIN</th><th>Tipo</th><th>Subtipo</th>'
              + '<th>Moneda</th><th>Cuenta Contable</th>'
              + '<th class="num">Cant. Actual</th><th class="num">Cant. Nueva</th>'
              + '<th class="num">Valor Actual</th><th class="num">Valor Nuevo</th>'
              + '<th>Fecha</th><th class="num">TC</th><th>Baja</th>'
              + '</tr></thead><tbody>';
        instActual.forEach((inst, i) => {
            html += rowInstExistente(inst, i, tipos, subtipos, monedas, cuentas, tcHoy(inst.moneda));
        });
        html += '</tbody></table>';
        html += '</div>';
        html += `<button type="button" class="ext-btn" onclick="extAddInst()">+ Agregar instrumento</button>`;

        html += `<input type="hidden" name="custpage_cash_count" id="custpage_cash_count" value="${cashActual.length}" />`;
        html += `<input type="hidden" name="custpage_inst_count" id="custpage_inst_count" value="${instActual.length}" />`;

        // JS de agregar filas
        const _sc = runtime.getCurrentScript();
        const tcLookupUrl = url.resolveScript({
            scriptId: _sc.id,
            deploymentId: _sc.deploymentId,
            params: { action: 'lookup_tc' }
        });

        html += `<script>
            window._tipos = ${JSON.stringify(tipos)};
            window._subtipos = ${JSON.stringify(subtipos)};
            window._monedas = ${JSON.stringify(monedas)};
            window._cuentas = ${JSON.stringify(cuentas)};
            window._ctaOrigenDefault = ${JSON.stringify(ctaOrigenDefault || '')};
            window._tcLookupUrl = ${JSON.stringify(tcLookupUrl)};
            window._baseCurrencyId = ${JSON.stringify(BASE_CURRENCY_ID)};
            window._hoyIso = ${JSON.stringify(_hoyIso())};
            // Al cambiar la fecha de una fila, busca el TC (Moneda → ARS) y lo completa.
            // Editable: el usuario puede pisar el valor a mano después.
            window.extLookupTc = function(prefix, i){
                var fEl = document.querySelector('[name="'+prefix+'_fecha_'+i+'"]');
                var mEl = document.querySelector('[name="'+prefix+'_moneda_'+i+'"]');
                var tEl = document.querySelector('[name="'+prefix+'_tc_'+i+'"]');
                if (!fEl || !mEl || !tEl) return;
                var fecha = fEl.value, moneda = mEl.value;
                if (!fecha || !moneda) return;
                if (String(moneda) === String(window._baseCurrencyId)) { tEl.value = '1'; return; }
                var u = window._tcLookupUrl + '&fecha=' + encodeURIComponent(fecha) + '&moneda=' + encodeURIComponent(moneda);
                fetch(u, { credentials: 'same-origin' })
                    .then(function(r){ return r.text(); })
                    .then(function(txt){
                        var d; try { d = JSON.parse(txt); } catch(e){ console.error('[TC ext] respuesta no-JSON', txt.slice(0,120)); return; }
                        if (d && typeof d.tc !== 'undefined') tEl.value = d.tc;
                    })
                    .catch(function(e){ console.error('[TC ext] fetch', e); });
            };
            window.extAddCash = function(){
                var c = document.getElementById('custpage_cash_count');
                var i = parseInt(c.value); c.value = i+1;
                var tb = document.querySelector('#tbl_cash tbody');
                var _mh = document.querySelector('input[name="ext_contra_master"]');
                var _defContra = _mh ? _mh.value : window._ctaOrigenDefault;
                var tr = document.createElement('tr');
                tr.innerHTML = '<td><input type="hidden" name="cash_id_'+i+'" value="" />NUEVO</td>'
                    + '<td>'+selectHtml('cash_moneda_'+i, window._monedas, 'onchange="extLookupTc(&#39;cash&#39;,'+i+')"')+'</td>'
                    + '<td>'+cuentaInputHtml('cash_cta_'+i, '')+'</td>'
                    + '<td>'+cuentaInputHtml('cash_contra_'+i, _defContra)+'</td>'
                    + '<td class="num">-</td>'
                    + '<td class="num"><input type="text" name="cash_saldo_'+i+'" /></td>'
                    + '<td><input type="date" name="cash_fecha_'+i+'" value="'+window._hoyIso+'" onchange="extLookupTc(&#39;cash&#39;,'+i+')" /></td>'
                    + '<td class="num"><input type="text" name="cash_tc_'+i+'" /></td>'
                    + '<td><input type="checkbox" name="cash_baja_'+i+'" disabled /></td>';
                tb.appendChild(tr);
            };
            window.extAddInst = function(){
                var c = document.getElementById('custpage_inst_count');
                var i = parseInt(c.value); c.value = i+1;
                var tb = document.querySelector('#tbl_inst tbody');
                var tr = document.createElement('tr');
                tr.innerHTML = '<td><input type="hidden" name="inst_id_'+i+'" value="" />NUEVO</td>'
                    + '<td><input type="text" name="inst_nombre_'+i+'" /></td>'
                    + '<td><input type="text" name="inst_isin_'+i+'" /></td>'
                    + '<td>'+selectHtml('inst_tipo_'+i, window._tipos)+'</td>'
                    + '<td>'+selectHtml('inst_subtipo_'+i, window._subtipos)+'</td>'
                    + '<td>'+selectHtml('inst_moneda_'+i, window._monedas, 'onchange="extLookupTc(&#39;inst&#39;,'+i+')"')+'</td>'
                    + '<td>'+cuentaInputHtml('inst_cta_'+i, '')+'</td>'
                    + '<td class="num">-</td>'
                    + '<td class="num"><input type="text" name="inst_cant_'+i+'" /></td>'
                    + '<td class="num">-</td>'
                    + '<td class="num"><input type="text" name="inst_valor_'+i+'" /></td>'
                    + '<td><input type="date" name="inst_fecha_'+i+'" value="'+window._hoyIso+'" onchange="extLookupTc(&#39;inst&#39;,'+i+')" /></td>'
                    + '<td class="num"><input type="text" name="inst_tc_'+i+'" /></td>'
                    + '<td><input type="checkbox" name="inst_baja_'+i+'" disabled /></td>';
                tb.appendChild(tr);
            };
            function selectHtml(name, opts, attrs){
                var s = '<select name="'+name+'"'+(attrs ? ' '+attrs : '')+'><option value=""></option>';
                opts.forEach(function(o){ s += '<option value="'+o.id+'">'+o.name+'</option>'; });
                return s + '</select>';
            }
            function cuentaInputHtml(name, selectedId){
                var sel = String(selectedId || '');
                var selText = '';
                if (sel) {
                    for (var k=0; k<window._cuentas.length; k++){
                        if (String(window._cuentas[k].id) === sel){ selText = window._cuentas[k].name; break; }
                    }
                }
                return '<input list="cuentas_datalist" name="'+name+'_text" value="'+selText.replace(/"/g,'&quot;')+'" oninput="syncCuenta(this,&#39;'+name+'&#39;)" style="width:220px;" />'
                     + '<input type="hidden" name="'+name+'" value="'+sel+'" />';
            }
            window.syncCuenta = function(input, hiddenName){
                var hidden = document.querySelector('input[name="'+hiddenName+'"][type="hidden"]');
                if (!hidden) return;
                var match = null;
                for (var k=0; k<window._cuentas.length; k++){
                    if (window._cuentas[k].name === input.value){ match = window._cuentas[k]; break; }
                }
                hidden.value = match ? match.id : '';
            };
            window.applyContraToAll = function(){
                var mh = document.querySelector('input[name="ext_contra_master"]');
                var mt = document.querySelector('input[name="ext_contra_master_text"]');
                if (!mh || !mt) return;
                var id = mh.value, txt = mt.value;
                var hiddens = document.querySelectorAll('input[type="hidden"][name^="cash_contra_"]');
                for (var k=0; k<hiddens.length; k++){
                    hiddens[k].value = id;
                    var t = document.querySelector('input[name="'+hiddens[k].name+'_text"]');
                    if (t) t.value = txt;
                }
            };
            // Copia la fecha maestra a todas las filas (cash e inst) y recalcula el TC de cada una.
            window.applyFechaToAll = function(){
                var mf = document.querySelector('input[name="ext_fecha_master"]');
                if (!mf) return;
                var fecha = mf.value;
                var dates = document.querySelectorAll('input[type="date"][name^="cash_fecha_"], input[type="date"][name^="inst_fecha_"]');
                for (var k=0; k<dates.length; k++){
                    dates[k].value = fecha;
                    var parts = dates[k].name.split('_'); // ['cash'|'inst','fecha','<i>']
                    if (window.extLookupTc) window.extLookupTc(parts[0], parts[2]);
                }
            };
        </script>`;

        tabla.defaultValue = html;
        form.addSubmitButton({ label: 'Confirmar Cierre' });
        context.response.writePage(form);
    }

    // ─────────────────────────── ROW HTML ─────────────────────────────
    function rowCashExistente(c, i, monedas, cuentas, ctaOrigenDefault, tcDefault) {
        return `<tr>
            <td><input type="hidden" name="cash_id_${i}" value="${c.id}" />${c.id}</td>
            <td>${escapeHtml(c.monedaName)}<input type="hidden" name="cash_moneda_${i}" value="${c.moneda}" /></td>
            <td>${cuentaInputServerHtml(`cash_cta_${i}`, c.cta, cuentas)}</td>
            <td>${cuentaInputServerHtml(`cash_contra_${i}`, ctaOrigenDefault, cuentas)}</td>
            <td class="num">${fmt(c.saldoActual)}</td>
            <td class="num"><input type="text" name="cash_saldo_${i}" value="" placeholder="${fmt(c.saldoActual)}" /></td>
            <td><input type="date" name="cash_fecha_${i}" value="${_hoyIso()}" onchange="extLookupTc('cash',${i})" /></td>
            <td class="num"><input type="text" name="cash_tc_${i}" value="${tcDefault != null ? tcDefault : ''}" /></td>
            <td><input type="checkbox" name="cash_baja_${i}" /></td>
        </tr>`;
    }

    function rowInstExistente(inst, i, tipos, subtipos, monedas, cuentas, tcDefault) {
        return `<tr>
            <td><input type="hidden" name="inst_id_${i}" value="${inst.id}" />${inst.id}</td>
            <td>${escapeHtml(inst.nombre)}</td>
            <td>${escapeHtml(inst.isin || '')}</td>
            <td>${escapeHtml(inst.tipoName)}<input type="hidden" name="inst_tipo_${i}" value="${inst.tipo}" /></td>
            <td>${escapeHtml(inst.subtipoName || '')}<input type="hidden" name="inst_subtipo_${i}" value="${inst.subtipo || ''}" /></td>
            <td>${escapeHtml(inst.monedaName)}<input type="hidden" name="inst_moneda_${i}" value="${inst.moneda}" /></td>
            <td>${cuentaInputServerHtml(`inst_cta_${i}`, inst.cta, cuentas)}</td>
            <td class="num">${fmt(inst.cantidad)}</td>
            <td class="num"><input type="text" name="inst_cant_${i}" value="" placeholder="${fmt(inst.cantidad)}" /></td>
            <td class="num">${fmt(inst.valorActual)}</td>
            <td class="num"><input type="text" name="inst_valor_${i}" value="" placeholder="${fmt(inst.valorActual)}" /></td>
            <td><input type="date" name="inst_fecha_${i}" value="${_hoyIso()}" onchange="extLookupTc('inst',${i})" /></td>
            <td class="num"><input type="text" name="inst_tc_${i}" value="${tcDefault != null ? tcDefault : ''}" /></td>
            <td><input type="checkbox" name="inst_baja_${i}" /></td>
        </tr>`;
    }

    // ─────────────────────────── BÚSQUEDAS ────────────────────────────
    function buscarComitentes() {
        const res = [];
        // Default de "Cuenta Banco" = custrecord_sdb_extcc_cuenta_de_banco del comitente.
        // Si el campo todavía no existe, fallback sin él.
        let columns = ['internalid', 'name', 'custrecord_sdb_extcc_cuenta_de_banco'];
        let withOrigen = true;
        try {
            search.create({ type: REC_COMITENTE, filters: [['isinactive', 'is', 'F']], columns }).run().each(r => {
                res.push({
                    id: r.getValue('internalid'),
                    name: r.getValue('name'),
                    ctaOrigen: r.getValue('custrecord_sdb_extcc_cuenta_de_banco')
                });
                return true;
            });
        } catch (e) {
            withOrigen = false;
            res.length = 0;
        }
        if (!withOrigen) {
            search.create({ type: REC_COMITENTE, filters: [['isinactive', 'is', 'F']], columns: ['internalid', 'name'] }).run().each(r => {
                res.push({ id: r.getValue('internalid'), name: r.getValue('name'), ctaOrigen: '' });
                return true;
            });
        }
        return res;
    }

    function buscarCash(comitenteId) {
        const res = [];
        search.create({
            type: REC_CASH,
            filters: [
                ['custrecord_sdb_extcash_comitente', 'anyof', comitenteId],
                'AND', ['isinactive', 'is', 'F']
            ],
            columns: [
                'internalid',
                'custrecord_sdb_extcash_moneda',
                'custrecord_sdb_extcash_cta_contable',
                'custrecord_sdb_extcash_saldo_actual',
                'custrecord_sdb_extcash_fecha_actual'
            ]
        }).run().each(r => {
            res.push({
                id: r.getValue('internalid'),
                moneda: r.getValue('custrecord_sdb_extcash_moneda'),
                monedaName: r.getText('custrecord_sdb_extcash_moneda'),
                cta: r.getValue('custrecord_sdb_extcash_cta_contable'),
                ctaName: r.getText('custrecord_sdb_extcash_cta_contable'),
                saldoActual: r.getValue('custrecord_sdb_extcash_saldo_actual'),
                fechaActual: r.getValue('custrecord_sdb_extcash_fecha_actual')
            });
            return true;
        });
        return res;
    }

    function buscarInstrumentos(comitenteId, tipoId) {
        const res = [];
        const filters = [
            ['custrecord_sdb_extinst_comitente', 'anyof', comitenteId],
            'AND', ['isinactive', 'is', 'F']
        ];
        if (tipoId) filters.push('AND', ['custrecord_sdb_extinst_tipo', 'anyof', tipoId]);
        search.create({
            type: REC_INSTRUMENTO,
            filters: filters,
            columns: [
                'internalid', 'name',
                'custrecord_sdb_extinst_isin',
                'custrecord_sdb_extinst_tipo',
                'custrecord_sdb_extinst_subtipo',
                'custrecord_sdb_extinst_moneda',
                'custrecord_sdb_extinst_cta_contable',
                'custrecord_sdb_extinst_cantidad',
                'custrecord_sdb_extinst_valor_actual'
            ]
        }).run().each(r => {
            res.push({
                id: r.getValue('internalid'),
                nombre: r.getValue('name'),
                isin: r.getValue('custrecord_sdb_extinst_isin'),
                tipo: r.getValue('custrecord_sdb_extinst_tipo'),
                tipoName: r.getText('custrecord_sdb_extinst_tipo'),
                subtipo: r.getValue('custrecord_sdb_extinst_subtipo'),
                subtipoName: r.getText('custrecord_sdb_extinst_subtipo'),
                moneda: r.getValue('custrecord_sdb_extinst_moneda'),
                monedaName: r.getText('custrecord_sdb_extinst_moneda'),
                cta: r.getValue('custrecord_sdb_extinst_cta_contable'),
                ctaName: r.getText('custrecord_sdb_extinst_cta_contable'),
                cantidad: r.getValue('custrecord_sdb_extinst_cantidad'),
                valorActual: r.getValue('custrecord_sdb_extinst_valor_actual')
            });
            return true;
        });
        return res;
    }

    function buscarTipos() {
        const res = [];
        search.create({
            type: REC_TIPO,
            filters: [['isinactive', 'is', 'F']],
            columns: ['internalid', 'name', 'custrecord_sdb_exttipo_cta_resultado']
        }).run().each(r => {
            res.push({
                id: r.getValue('internalid'),
                name: r.getValue('name'),
                ctaResultado: r.getValue('custrecord_sdb_exttipo_cta_resultado')
            });
            return true;
        });
        return res;
    }

    function buscarSubtipos() {
        const res = [];
        search.create({
            type: 'customlist_sdb_inv_ext_subtipo',
            filters: [['isinactive', 'is', 'F']],
            columns: ['internalid', 'name']
        }).run().each(r => {
            res.push({ id: r.getValue('internalid'), name: r.getValue('name') });
            return true;
        });
        return res;
    }

    function buscarCuentas() {
        const res = [];
        search.create({
            type: 'account',
            filters: [['isinactive', 'is', 'F']],
            columns: [
                'internalid',
                search.createColumn({ name: 'number', sort: search.Sort.ASC }),
                'name'
            ]
        }).run().each(r => {
            const num = r.getValue('number');
            const nm  = r.getValue('name');
            res.push({ id: r.getValue('internalid'), name: (num ? num + ' ' : '') + nm });
            return true;
        });
        return res;
    }

    function buscarMonedas() {
        const res = [];
        search.create({
            type: 'currency',
            filters: [['isinactive', 'is', 'F']],
            columns: ['internalid', 'name', 'symbol']
        }).run().each(r => {
            res.push({ id: r.getValue('internalid'), name: r.getValue('symbol') || r.getValue('name') });
            return true;
        });
        return res;
    }

    // ─────────────────────────── PROCESAR CIERRE ─────────────────────
    /**
     * Parsea el form, hace upsert sobre los records y arma el JE consolidado.
     * Reglas:
     *  - Update de valor (valor_nuevo distinto): D/H cuenta del instrumento × diferencia,
     *    contrapartida = cta_resultado del tipo (instr) o cta_dif_cambio (cash).
     *  - Alta (id vacío): D cuenta del instrumento × valor inicial; H cash de la misma
     *    cuenta comitente en misma moneda. Si no existe cash de esa moneda, se omite la
     *    contrapartida y se marca para revisión.
     *  - Baja (checkbox tildado): H cuenta del instrumento × valor anterior; D cash misma
     *    cuenta comitente. Setea isinactive=T y deja saldo en 0.
     */
    function procesarCierre(request) {
        const comitenteId = request.parameters.custpage_comitente;
        if (!comitenteId) return 'No se seleccionó cuenta comitente.';

        const cashCount = parseInt(request.parameters.custpage_cash_count || '0', 10);
        const instCount = parseInt(request.parameters.custpage_inst_count || '0', 10);

        const jeLines = [];
        const cambios = { altas: 0, updates: 0, bajas: 0 };
        const errores = [];
        // Saldo de cash disponible por cuenta (en memoria), para validar y descontar las altas
        // de instrumentos. Se persiste al final. cashAActualizar = saldos finales a guardar.
        const saldoDisp = {};
        const cashAActualizar = {};
        // Saldo disponible del cash (lazy desde DB, ya refleja lo actualizado en el loop de Cash).
        const _saldoCash = (cashId) => {
            if (!(cashId in saldoDisp)) saldoDisp[cashId] = parseNum(getFieldValue(REC_CASH, cashId, 'custrecord_sdb_extcash_saldo_actual')) || 0;
            return saldoDisp[cashId];
        };
        // Impacta el cash: delta>0 acredita (devuelve), delta<0 debita (consume). Persiste al final.
        const _aplicarACash = (cashId, delta) => {
            saldoDisp[cashId] = parseFloat((_saldoCash(cashId) + delta).toFixed(2));
            cashAActualizar[cashId] = saldoDisp[cashId];
        };
        let fechaCierre = null;

        // ─── CASH ─────────────────────────────────────────────────
        for (let i = 0; i < cashCount; i++) {
            const id        = request.parameters[`cash_id_${i}`] || '';
            const moneda    = request.parameters[`cash_moneda_${i}`];
            const cta       = request.parameters[`cash_cta_${i}`];
            const ctaContra = request.parameters[`cash_contra_${i}`];
            const saldoIn   = parseNum(request.parameters[`cash_saldo_${i}`]);
            const fecha     = request.parameters[`cash_fecha_${i}`];
            const tc        = parseNum(request.parameters[`cash_tc_${i}`]);
            const baja      = request.parameters[`cash_baja_${i}`] === 'T' || request.parameters[`cash_baja_${i}`] === 'on';

            const fechaParsed = parseDate(fecha);
            if (fechaParsed && (!fechaCierre || fechaParsed > fechaCierre)) fechaCierre = fechaParsed;

            if (id && baja) {
                const saldoAnt = parseNum(getFieldValue(REC_CASH, id, 'custrecord_sdb_extcash_saldo_actual'));
                const ctaAnt = getFieldValue(REC_CASH, id, 'custrecord_sdb_extcash_cta_contable');
                // Si todavía hay instrumentos en esa moneda, el cash queda en cero pero activo
                // (para poder recibir el valor que devuelvan esas bajas/ajustes de instrumentos).
                const hayInstrumentos = existeInstrumentoActivoEnMoneda(comitenteId, moneda);
                const valuesBaja = { custrecord_sdb_extcash_saldo_actual: 0 };
                if (!hayInstrumentos) valuesBaja.isinactive = true;
                record.submitFields({ type: REC_CASH, id, values: valuesBaja });
                jeLines.push({ kind: 'cash_baja', cta: ctaAnt, ctaContra, monto: saldoAnt, cashId: id, moneda, tc });
                cambios.bajas++;
                continue;
            }

            if (id && saldoIn !== null) {
                const saldoAnt = parseNum(getFieldValue(REC_CASH, id, 'custrecord_sdb_extcash_saldo_actual'));
                const dif = saldoIn - (saldoAnt || 0);
                if (dif !== 0) {
                    const ctaDif = getFieldValue(REC_CASH, id, 'custrecord_sdb_extcash_cta_dif_cam');
                    record.submitFields({
                        type: REC_CASH, id,
                        values: {
                            custrecord_sdb_extcash_saldo_actual: saldoIn,
                            custrecord_sdb_extcash_fecha_actual: parseDate(fecha),
                            custrecord_sdb_extcash_tc: tc || ''
                        }
                    });
                    jeLines.push({ kind: 'cash_update', cta, ctaContra: ctaDif, monto: dif, cashId: id, moneda, tc });
                    cambios.updates++;
                }
                continue;
            }

            if (!id && saldoIn !== null && saldoIn !== 0) {
                const nuevo = record.create({ type: REC_CASH });
                nuevo.setValue('name', buildCashName(comitenteId, moneda));
                nuevo.setValue('custrecord_sdb_extcash_comitente', comitenteId);
                nuevo.setValue('custrecord_sdb_extcash_moneda', moneda);
                nuevo.setValue('custrecord_sdb_extcash_cta_contable', cta);
                nuevo.setValue('custrecord_sdb_extcash_saldo_actual', saldoIn);
                nuevo.setValue('custrecord_sdb_extcash_fecha_actual', parseDate(fecha));
                if (tc) nuevo.setValue('custrecord_sdb_extcash_tc', tc);
                const nuevoCashId = nuevo.save();
                jeLines.push({ kind: 'cash_alta', cta, ctaContra, monto: saldoIn, cashId: nuevoCashId, moneda, tc });
                cambios.altas++;
            }
        }

        // ─── INSTRUMENTOS ────────────────────────────────────────
        for (let i = 0; i < instCount; i++) {
            const id        = request.parameters[`inst_id_${i}`] || '';
            const nombre    = request.parameters[`inst_nombre_${i}`];
            const isin      = request.parameters[`inst_isin_${i}`];
            const tipo      = request.parameters[`inst_tipo_${i}`];
            const subtipo   = request.parameters[`inst_subtipo_${i}`];
            const moneda    = request.parameters[`inst_moneda_${i}`];
            const cta       = request.parameters[`inst_cta_${i}`];
            const cant      = parseNum(request.parameters[`inst_cant_${i}`]);
            const valor     = parseNum(request.parameters[`inst_valor_${i}`]);
            const fecha     = request.parameters[`inst_fecha_${i}`];
            const tc        = parseNum(request.parameters[`inst_tc_${i}`]);
            const baja      = request.parameters[`inst_baja_${i}`] === 'T' || request.parameters[`inst_baja_${i}`] === 'on';

            const fechaInstParsed = parseDate(fecha);
            if (fechaInstParsed && (!fechaCierre || fechaInstParsed > fechaCierre)) fechaCierre = fechaInstParsed;

            if (id && baja) {
                const valorAnt = parseNum(getFieldValue(REC_INSTRUMENTO, id, 'custrecord_sdb_extinst_valor_actual')) || 0;
                const ctaInst = getFieldValue(REC_INSTRUMENTO, id, 'custrecord_sdb_extinst_cta_contable');
                record.submitFields({ type: REC_INSTRUMENTO, id, values: { isinactive: true, custrecord_sdb_extinst_valor_actual: 0 } });
                // Baja total → devolver el valor anterior completo al cash de la misma moneda.
                if (valorAnt > 0) {
                    const cashIdFondeo = findCashByComitenteMoneda(comitenteId, moneda);
                    if (cashIdFondeo) _aplicarACash(cashIdFondeo, valorAnt);
                    else errores.push(`Instrumento ${id}: baja sin cash en esa moneda; no se pudo devolver ${valorAnt}.`);
                }
                jeLines.push({ kind: 'inst_baja', cta: ctaInst, ctaContra: CUENTA_INTERESES_INVERSIONES, monto: valorAnt, instId: id, moneda, tc });
                cambios.bajas++;
                continue;
            }

            if (id && valor !== null) {
                const valorAnt = parseNum(getFieldValue(REC_INSTRUMENTO, id, 'custrecord_sdb_extinst_valor_actual')) || 0;
                const dif = parseFloat((valor - valorAnt).toFixed(2));
                if (dif !== 0) {
                    const labelInst = nombre || `Instrumento ${id}`;
                    const cashIdFondeo = findCashByComitenteMoneda(comitenteId, moneda);
                    // Escenario 2: si el valor sube, descontar la diferencia del cash (validando que alcance).
                    if (dif > 0) {
                        if (!cashIdFondeo) {
                            errores.push(`"${labelInst}": no hay cash en esa moneda para descontar la diferencia; no se actualizó.`);
                            continue;
                        }
                        if (dif > _saldoCash(cashIdFondeo)) {
                            errores.push(`"${labelInst}": la diferencia (${dif}) supera el saldo de cash disponible (${_saldoCash(cashIdFondeo)}) en esa moneda; no se actualizó.`);
                            continue;
                        }
                    }
                    const ctaInst = getFieldValue(REC_INSTRUMENTO, id, 'custrecord_sdb_extinst_cta_contable');
                    const ctaRes = getCtaResultadoTipo(tipo);
                    record.submitFields({
                        type: REC_INSTRUMENTO, id,
                        values: {
                            custrecord_sdb_extinst_valor_actual: valor,
                            custrecord_sdb_extinst_cantidad: cant !== null ? cant : '',
                            custrecord_sdb_extinst_fecha_actual: parseDate(fecha),
                            custrecord_sdb_extinst_tc: tc || ''
                        }
                    });
                    // Impacto en cash: sube → debita la diferencia; baja → acredita |diferencia|.
                    if (cashIdFondeo) _aplicarACash(cashIdFondeo, -dif);
                    else errores.push(`"${labelInst}": no hay cash en esa moneda; no se pudo devolver la diferencia (${Math.abs(dif)}).`);
                    jeLines.push({ kind: 'inst_update', cta: ctaInst, ctaContra: ctaRes, monto: dif, instId: id, moneda, tc });
                    cambios.updates++;
                }
                continue;
            }

            if (!id && valor !== null && valor !== 0 && nombre) {
                // Escenario 1: el alta se fondea con el cash de la misma moneda de la cuenta comitente.
                const cashIdFondeo = findCashByComitenteMoneda(comitenteId, moneda);
                if (!cashIdFondeo) {
                    errores.push(`"${nombre}": no hay cash en esa moneda para la cuenta comitente; no se registró.`);
                    continue;
                }
                if (valor > _saldoCash(cashIdFondeo)) {
                    errores.push(`"${nombre}": el valor (${valor}) supera el saldo de cash disponible (${_saldoCash(cashIdFondeo)}) en esa moneda; no se registró.`);
                    continue;
                }

                const nuevo = record.create({ type: REC_INSTRUMENTO });
                nuevo.setValue('name', nombre);
                nuevo.setValue('custrecord_sdb_extinst_comitente', comitenteId);
                nuevo.setValue('custrecord_sdb_extinst_isin', isin || '');
                nuevo.setValue('custrecord_sdb_extinst_tipo', tipo);
                if (subtipo) nuevo.setValue('custrecord_sdb_extinst_subtipo', subtipo);
                nuevo.setValue('custrecord_sdb_extinst_moneda', moneda);
                nuevo.setValue('custrecord_sdb_extinst_cta_contable', cta);
                if (cant !== null) nuevo.setValue('custrecord_sdb_extinst_cantidad', cant);
                nuevo.setValue('custrecord_sdb_extinst_valor_actual', valor);
                nuevo.setValue('custrecord_sdb_extinst_fecha_actual', parseDate(fecha));
                if (tc) nuevo.setValue('custrecord_sdb_extinst_tc', tc);
                const nuevoInstId = nuevo.save();

                // Descontar el valor del cash de fondeo (se persiste al final del proceso).
                _aplicarACash(cashIdFondeo, -valor);

                jeLines.push({ kind: 'inst_alta', cta, ctaContra: CUENTA_INTERESES_INVERSIONES, monto: valor, instId: nuevoInstId, moneda, tc });
                cambios.altas++;
            }
        }

        // Persistir el descuento de saldo en los cash de fondeo (Escenario 1).
        Object.keys(cashAActualizar).forEach(cashId => {
            try {
                record.submitFields({ type: REC_CASH, id: cashId, values: { custrecord_sdb_extcash_saldo_actual: cashAActualizar[cashId] } });
            } catch (e) {
                errores.push(`No se pudo actualizar el saldo del cash ${cashId}: ${e.message}`);
            }
        });

        let jeUrls = [];
        let jeSkippedMsg = '';
        if (jeLines.length > 0) {
            const jeResult = crearJournalEntry(jeLines, comitenteId, fechaCierre);
            jeUrls = jeResult.urls || [];
            if (jeResult.skipped > 0) {
                jeSkippedMsg = ` ${jeResult.skipped} línea(s) sin contrapartida — registrar JE manualmente.`;
            }
        }

        let msg = `Procesado. Altas: ${cambios.altas} · Updates: ${cambios.updates} · Bajas: ${cambios.bajas}.${jeSkippedMsg}`;
        if (errores.length) msg += ` <span style="color:#c62828;">⚠ ${escapeHtml(errores.join(' | '))}</span>`;
        if (jeUrls.length) {
            const links = jeUrls.map((u, i) => `<a href="${u}" target="_blank">Ver JE${jeUrls.length > 1 ? ' ' + (i + 1) : ''}</a>`).join(' · ');
            msg += ` ${links}`;
        }
        return msg;
    }

    // ─────────────────────────── JE ───────────────────────────────────
    /**
     * TODO: completar con subsidiary, currency y validaciones reales.
     * Por ahora arma un JE básico con las líneas crudas. Cada `kind` define el sentido:
     *   inst_update / cash_update → línea cta (D/H según signo de dif) + línea ctaContra (inverso)
     *   inst_alta  → D cta. Para contrapartida buscar cash del mismo comitente en misma moneda.
     *   inst_baja  → H cta. Misma lógica de contrapartida.
     *   cash_alta  → D cta. Contrapartida queda pendiente (ingreso externo) — generar línea
     *                contra cuenta transitoria de transferencias del exterior.
     *   cash_baja  → H cta. Idem inversa.
     */
    function crearJournalEntry(lines, comitenteId, fechaCierre) {
        // Cada línea debe traer cta + ctaContra; las que no, se saltean
        const lineasValidas = [];
        let skipped = 0;
        lines.forEach(l => {
            if (!l.cta || !l.ctaContra) { skipped++; return; }
            lineasValidas.push(l);
        });

        if (lineasValidas.length === 0) {
            return { urls: [], skipped };
        }

        // Un JE de NetSuite es mono-moneda: agrupo por moneda y genero un JE por cada una.
        const grupos = {};
        lineasValidas.forEach(l => {
            const m = String(l.moneda || '');
            (grupos[m] = grupos[m] || []).push(l);
        });

        const urls = [];
        Object.keys(grupos).forEach(monedaId => {
            const grupo = grupos[monedaId];
            const je = record.create({ type: record.Type.JOURNAL_ENTRY, isDynamic: true });
            je.setValue({ fieldId: 'subsidiary', value: SUBSIDIARY_ID });
            je.setValue({ fieldId: 'trandate', value: fechaCierre || new Date() });
            je.setValue({ fieldId: 'memo', value: `Cierre Exterior - Cta. Comitente ${comitenteId}` });
            if (comitenteId) je.setValue({ fieldId: 'custbody_sdb_inv_ext_comitente', value: comitenteId });

            // currency + exchangerate VAN ÚLTIMOS: si se setea trandate DESPUÉS del exchangerate,
            // NetSuite re-sourcea el rate por la fecha y pisa el TC manual de la fila.
            if (monedaId && monedaId !== BASE_CURRENCY_ID) {
                je.setValue({ fieldId: 'currency', value: monedaId });
                const tc = _tcDelGrupo(grupo);
                if (tc > 0) je.setValue({ fieldId: 'exchangerate', value: tc });
            }

            grupo.forEach(l => {
                const monto = Math.abs(l.monto);
                const dirCta = (l.kind === 'inst_update' || l.kind === 'cash_update')
                    ? (l.monto > 0 ? 'debit' : 'credit')
                    : ((l.kind === 'inst_alta' || l.kind === 'cash_alta') ? 'debit' : 'credit');

                je.selectNewLine({ sublistId: 'line' });
                je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: l.cta });
                je.setCurrentSublistValue({ sublistId: 'line', fieldId: dirCta, value: monto });
                je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: l.kind });
                if (l.instId) je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'custcol_sdb_inv_ext_instrumento', value: l.instId });
                if (l.cashId) je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'custcol_sdb_inv_ext_cash', value: l.cashId });
                je.commitLine({ sublistId: 'line' });

                const dirContra = dirCta === 'debit' ? 'credit' : 'debit';
                je.selectNewLine({ sublistId: 'line' });
                je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: l.ctaContra });
                je.setCurrentSublistValue({ sublistId: 'line', fieldId: dirContra, value: monto });
                je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: l.kind + ' (contra)' });
                if (l.instId) je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'custcol_sdb_inv_ext_instrumento', value: l.instId });
                if (l.cashId) je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'custcol_sdb_inv_ext_cash', value: l.cashId });
                je.commitLine({ sublistId: 'line' });
            });

            const id = je.save({ enableSourcing: true, ignoreMandatoryFields: false });
            urls.push(url.resolveRecord({ recordType: 'journalentry', recordId: id }));
        });

        return { urls: urls, skipped: skipped };
    }

    function _tcDelGrupo(grupo) {
        for (let i = 0; i < grupo.length; i++) {
            const t = parseFloat(grupo[i].tc || 0);
            if (t > 0) return t;
        }
        return 0;
    }

    function findCashByComitenteMoneda(comitenteId, monedaId) {
        if (!comitenteId || !monedaId) return '';
        let id = '';
        search.create({
            type: REC_CASH,
            filters: [
                ['custrecord_sdb_extcash_comitente', 'anyof', comitenteId],
                'AND', ['custrecord_sdb_extcash_moneda', 'anyof', monedaId],
                'AND', ['isinactive', 'is', 'F']
            ],
            columns: ['internalid']
        }).run().each(r => { id = r.getValue('internalid'); return false; });
        return id;
    }

    // ¿Hay al menos un instrumento activo de esa cuenta comitente en esa moneda?
    function existeInstrumentoActivoEnMoneda(comitenteId, monedaId) {
        if (!comitenteId || !monedaId) return false;
        let existe = false;
        search.create({
            type: REC_INSTRUMENTO,
            filters: [
                ['custrecord_sdb_extinst_comitente', 'anyof', comitenteId],
                'AND', ['custrecord_sdb_extinst_moneda', 'anyof', monedaId],
                'AND', ['isinactive', 'is', 'F']
            ],
            columns: ['internalid']
        }).run().each(() => { existe = true; return false; });
        return existe;
    }

    function getSubsidiaryDeAccount(accountId) {
        if (!accountId) return '';
        try {
            const r = search.lookupFields({ type: 'account', id: accountId, columns: ['subsidiary'] });
            const v = r.subsidiary;
            if (Array.isArray(v) && v.length) return v[0].value;
        } catch (e) { /* noop */ }
        return '';
    }

    // ─────────────────────────── HELPERS ──────────────────────────────
    function getFieldValue(type, id, field) {
        const r = search.lookupFields({ type, id, columns: [field] });
        const v = r[field];
        if (Array.isArray(v)) return v.length ? v[0].value : '';
        return v || '';
    }

    function buildCashName(comitenteId, monedaId) {
        let comNombre = `Cta ${comitenteId}`;
        let monSimbolo = String(monedaId || '');
        try {
            const c = search.lookupFields({ type: REC_COMITENTE, id: comitenteId, columns: ['name'] });
            if (c && c.name) comNombre = c.name;
        } catch (e) { /* noop */ }
        try {
            const m = search.lookupFields({ type: 'currency', id: monedaId, columns: ['symbol', 'name'] });
            if (m && (m.symbol || m.name)) monSimbolo = m.symbol || m.name;
        } catch (e) { /* noop */ }
        return `${comNombre} - ${monSimbolo}`;
    }

    function getCtaResultadoTipo(tipoId) {
        if (!tipoId) return '';
        return getFieldValue(REC_TIPO, tipoId, 'custrecord_sdb_exttipo_cta_resultado');
    }

    function parseNum(s) {
        if (s === undefined || s === null || s === '') return null;
        const n = parseFloat(String(s).replace(',', '.'));
        return isNaN(n) ? null : n;
    }

    function parseDate(s) {
        if (!s) return null;
        const d = new Date(s);
        return isNaN(d.getTime()) ? null : d;
    }

    function fmt(n) {
        if (n === null || n === undefined || n === '') return '';
        const num = parseFloat(n);
        if (isNaN(num)) return '';
        return num.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function cuentaInputServerHtml(name, selectedId, cuentas) {
        let selectedText = '';
        if (selectedId) {
            const found = cuentas.find(c => String(c.id) === String(selectedId));
            if (found) selectedText = found.name;
        }
        return `<input list="cuentas_datalist" name="${name}_text" value="${escapeHtml(selectedText)}" `
            + `oninput="syncCuenta(this,'${name}')" style="width:220px;" />`
            + `<input type="hidden" name="${name}" value="${escapeHtml(selectedId || '')}" />`;
    }

    function selectServerHtml(name, opts, selectedId) {
        const sel = String(selectedId || '');
        let s = `<select name="${name}"><option value=""></option>`;
        opts.forEach(o => {
            const isSel = String(o.id) === sel ? ' selected' : '';
            s += `<option value="${escapeHtml(o.id)}"${isSel}>${escapeHtml(o.name)}</option>`;
        });
        return s + '</select>';
    }

    function escapeHtml(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // TC de (moneda → ARS) a una fecha. Devuelve 1 si es la moneda base o si falla el lookup.
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

    // Fecha de hoy como 'yyyy-mm-dd' (local), para usar como default en los inputs date.
    function _hoyIso() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    // Parsea 'yyyy-mm-dd' como fecha local (evita el corrimiento de día por UTC).
    function _parseTcDate(s) {
        const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m) return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
        const d = new Date(s);
        return isNaN(d.getTime()) ? new Date() : d;
    }

    return { onRequest };
});
