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

define(['N/ui/serverWidget', 'N/search', 'N/record', 'N/runtime', 'N/log', 'N/url', 'N/redirect', 'N/currency'], (serverWidget, search, record, runtime, log, url, redirect, currency) => {

    const GLOBALS = {
        SUBSIDIARY_ID: '6',                                  // Subsidiaria fija para los asientos del exterior
        BASE_CURRENCY_ID: '1',                               // ARS
        CTA_INTERESES_INVERSIONES: '1025',                   // Contrapartida de alta/baja/ajuste de instrumentos
        CTA_INVERSIONES_EXTERIOR: '222',                     // (reservada — ver nota de JE pendiente)
        SUBTIPO_LIST: 'customlist_sdb_inv_ext_subtipo',
        JE_BODY_COMITENTE: 'custbody_sdb_inv_ext_comitente',
        JE_COL_INSTRUMENTO: 'custcol_sdb_inv_ext_instrumento',
        JE_COL_CASH: 'custcol_sdb_inv_ext_cash'
    };

    const EXT_COMITENTE = {
        RECORD_TYPE: 'customrecord_sdb_inv_ext_comitente',
        CUENTA_BANCO: 'custrecord_sdb_extcc_cuenta_de_banco'
    };

    const EXT_CASH = {
        RECORD_TYPE: 'customrecord_sdb_inv_ext_cash',
        COMITENTE: 'custrecord_sdb_extcash_comitente',
        MONEDA: 'custrecord_sdb_extcash_moneda',
        CTA_CONTABLE: 'custrecord_sdb_extcash_cta_contable',
        CTA_DIF_CAMBIO: 'custrecord_sdb_extcash_cta_dif_cam',
        SALDO_ACTUAL: 'custrecord_sdb_extcash_saldo_actual',
        FECHA_ACTUAL: 'custrecord_sdb_extcash_fecha_actual',
        TC: 'custrecord_sdb_extcash_tc'
    };

    const EXT_INSTRUMENTO = {
        RECORD_TYPE: 'customrecord_sdb_inv_ext_instrumento',
        COMITENTE: 'custrecord_sdb_extinst_comitente',
        ISIN: 'custrecord_sdb_extinst_isin',
        TIPO: 'custrecord_sdb_extinst_tipo',
        SUBTIPO: 'custrecord_sdb_extinst_subtipo',
        MONEDA: 'custrecord_sdb_extinst_moneda',
        CTA_CONTABLE: 'custrecord_sdb_extinst_cta_contable',
        CANTIDAD: 'custrecord_sdb_extinst_cantidad',
        VALOR_ACTUAL: 'custrecord_sdb_extinst_valor_actual',
        FECHA_ACTUAL: 'custrecord_sdb_extinst_fecha_actual',
        TC: 'custrecord_sdb_extinst_tc'
    };

    const EXT_TIPO = {
        RECORD_TYPE: 'customrecord_sdb_inv_ext_tipo',
        CTA_RESULTADO: 'custrecord_sdb_exttipo_cta_resultado'
    };

    // ─────────────────────────── ENTRY ────────────────────────────────
    function onRequest(context) {
        const { request, response } = context;

        // Endpoint JSON: TC por (moneda, fecha) → consumido por el JS de cada fila al cambiar la fecha/moneda.
        if (request.method === 'GET' && request.parameters.action === 'lookup_tc') {
            let tc = 1;
            try {
                tc = _tipoCambio(request.parameters.moneda || '', _parseTcDate(request.parameters.fecha || ''));
            } catch (error) {
                log.error('onRequest lookup_tc', error.message);
            }
            response.setHeader({ name: 'Content-Type', value: 'application/json' });
            response.write(JSON.stringify({ tc: _fmtTc(tc) }));
            return;
        }

        if (request.method === 'POST') {
            let msg = '';
            try {
                msg = procesarCierre(request);
            } catch (error) {
                log.error('onRequest POST', error.message + ' | ' + (error.stack || ''));
                msg = `ERROR: ${error.message}`;
            }
            // POST-redirect-GET: evita reprocesar al hacer F5
            const script = runtime.getCurrentScript();
            redirect.toSuitelet({
                scriptId: script.id,
                deploymentId: script.deploymentId,
                parameters: {
                    custpage_comitente: request.parameters.custpage_comitente || '',
                    custpage_tipo: request.parameters.custpage_tipo || '',
                    msg: msg.substring(0, 1800)
                }
            });
            return;
        }

        renderForm(context, request.parameters.msg || '');
    }

    // ─────────────────────────── RENDER ───────────────────────────────
    function renderForm(context, msg) {
        const form = serverWidget.createForm({ title: 'Carga Cierre Inversiones Exterior' });

        const comitenteId = context.request.parameters.custpage_comitente || '';
        const tipoId = context.request.parameters.custpage_tipo || '';
        const comitentes = buscarComitentes();
        const comitenteSel = comitentes.find(c => c.id === comitenteId);
        const ctaBancoDefault = comitenteSel ? comitenteSel.ctaBanco : '';
        const tipos = buscarTipos();

        const selCom = form.addField({ id: 'custpage_comitente', type: serverWidget.FieldType.SELECT, label: 'Cuenta Comitente' });
        selCom.addSelectOption({ value: '', text: '-- Seleccionar --' });
        comitentes.forEach(c => selCom.addSelectOption({ value: c.id, text: c.name, isSelected: c.id === comitenteId }));

        // Filtro opcional por Tipo de instrumento. Vacío = todos. Solo afecta la tabla de Instrumentos.
        const selTipo = form.addField({ id: 'custpage_tipo', type: serverWidget.FieldType.SELECT, label: 'Tipo' });
        selTipo.addSelectOption({ value: '', text: '-- Todos --' });
        tipos.forEach(t => selTipo.addSelectOption({ value: t.id, text: t.name, isSelected: t.id === tipoId }));

        if (!comitenteId) {
            const info = form.addField({ id: 'custpage_info', type: serverWidget.FieldType.INLINEHTML, label: ' ' });
            info.defaultValue = '<div style="padding:20px;">Seleccioná una cuenta comitente para empezar.</div>';
            form.addSubmitButton({ label: 'Cargar' });
            context.response.writePage(form);
            return;
        }

        const cashActual = buscarCash(comitenteId);
        const instActual = buscarInstrumentos(comitenteId, tipoId);
        const subtipos = buscarSubtipos();
        const monedas = buscarMonedas();
        const cuentas = buscarCuentas();

        // TC de hoy por moneda. La fecha por defecto de las filas es hoy e igual para todas,
        // así que se calcula una sola vez por moneda (cacheado) y se usa como default del input.
        const _tcHoyCache = {};
        const tcHoy = (monedaId) => {
            const key = String(monedaId || '');
            if (!(key in _tcHoyCache)) _tcHoyCache[key] = _tipoCambio(monedaId, new Date());
            return _tcHoyCache[key];
        };

        const tabla = form.addField({ id: 'custpage_tabla', type: serverWidget.FieldType.INLINEHTML, label: ' ' });
        // Ocupa todo el ancho del form (debajo de los filtros); sin esto el INLINEHTML cae en la 2da columna.
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
        cuentas.forEach(c => { html += `<option value="${escapeHtml(c.name)}"></option>`; });
        html += '</datalist>';

        // ─── CUENTA BANCO (maestro / default para las filas de cash) ───
        let masterBancoText = '';
        if (ctaBancoDefault) {
            const fMaster = cuentas.find(c => String(c.id) === String(ctaBancoDefault));
            if (fMaster) masterBancoText = fMaster.name;
        }
        html += '<div class="ext-h2">Cuenta Banco</div>';
        html += '<div style="margin:4px 0 12px 0;">'
            + `<input list="cuentas_datalist" name="ext_contra_master_text" value="${escapeHtml(masterBancoText)}" oninput="syncCuenta(this,'ext_contra_master'); applyContraToAll();" style="width:260px;" />`
            + `<input type="hidden" name="ext_contra_master" value="${escapeHtml(ctaBancoDefault || '')}" />`
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
        cashActual.forEach((c, i) => { html += rowCashExistente(c, i, cuentas, ctaBancoDefault, tcHoy(c.moneda)); });
        html += '</tbody></table></div>';
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
        instActual.forEach((inst, i) => { html += rowInstExistente(inst, i, cuentas, tcHoy(inst.moneda)); });
        html += '</tbody></table></div>';
        html += `<button type="button" class="ext-btn" onclick="extAddInst()">+ Agregar instrumento</button>`;

        html += `<input type="hidden" name="custpage_cash_count" id="custpage_cash_count" value="${cashActual.length}" />`;
        html += `<input type="hidden" name="custpage_inst_count" id="custpage_inst_count" value="${instActual.length}" />`;

        const _sc = runtime.getCurrentScript();
        const tcLookupUrl = url.resolveScript({ scriptId: _sc.id, deploymentId: _sc.deploymentId, params: { action: 'lookup_tc' } });
        const reloadUrl = url.resolveScript({ scriptId: _sc.id, deploymentId: _sc.deploymentId });

        html += clientScript({
            tipos, subtipos, monedas, cuentas,
            ctaBancoDefault: ctaBancoDefault || '',
            tcLookupUrl, reloadUrl,
            baseCurrencyId: GLOBALS.BASE_CURRENCY_ID,
            hoyIso: _hoyIso()
        });

        tabla.defaultValue = html;
        form.addSubmitButton({ label: 'Confirmar Cierre' });
        context.response.writePage(form);
    }

    // Bloque JS embebido del form. Se mantiene inline (el data viaja serializado); a futuro podría
    // moverse a un Client Script externo (clientScriptModulePath) como en sdb_inv_reval_moneda_cs.js.
    function clientScript(cfg) {
        return `<script>
            window._tipos = ${JSON.stringify(cfg.tipos)};
            window._subtipos = ${JSON.stringify(cfg.subtipos)};
            window._monedas = ${JSON.stringify(cfg.monedas)};
            window._cuentas = ${JSON.stringify(cfg.cuentas)};
            window._ctaBancoDefault = ${JSON.stringify(cfg.ctaBancoDefault)};
            window._tcLookupUrl = ${JSON.stringify(cfg.tcLookupUrl)};
            window._reloadUrl = ${JSON.stringify(cfg.reloadUrl)};
            window._baseCurrencyId = ${JSON.stringify(cfg.baseCurrencyId)};
            window._hoyIso = ${JSON.stringify(cfg.hoyIso)};

            // El TC siempre se muestra con 4 decimales (requerimiento PM).
            window._fmtTc = function(n){ var v = parseFloat(n); return isFinite(v) ? v.toFixed(4) : ''; };
            // Busca el TC (Moneda → ARS) de una fila y lo completa. El campo queda editable.
            window.extLookupTc = function(prefix, i){
                var fEl = document.querySelector('[name="'+prefix+'_fecha_'+i+'"]');
                var mEl = document.querySelector('[name="'+prefix+'_moneda_'+i+'"]');
                var tEl = document.querySelector('[name="'+prefix+'_tc_'+i+'"]');
                if (!fEl || !mEl || !tEl) return;
                var fecha = fEl.value, moneda = mEl.value;
                if (!fecha || !moneda) return;
                if (String(moneda) === String(window._baseCurrencyId)) { tEl.value = window._fmtTc(1); return; }
                var u = window._tcLookupUrl + '&fecha=' + encodeURIComponent(fecha) + '&moneda=' + encodeURIComponent(moneda);
                fetch(u, { credentials: 'same-origin' })
                    .then(function(r){ return r.text(); })
                    .then(function(txt){
                        var d; try { d = JSON.parse(txt); } catch(e){ console.error('[TC ext] respuesta no-JSON', txt.slice(0,120)); return; }
                        if (d && typeof d.tc !== 'undefined') tEl.value = window._fmtTc(d.tc);
                    })
                    .catch(function(e){ console.error('[TC ext] fetch', e); });
            };
            // Tacha visualmente la fila al marcar "Baja".
            window.extToggleBaja = function(cb){
                var tr = cb.closest ? cb.closest('tr') : null;
                if (tr) { if (cb.checked) tr.classList.add('baja'); else tr.classList.remove('baja'); }
            };
            window.extAddCash = function(){
                var c = document.getElementById('custpage_cash_count');
                var i = parseInt(c.value); c.value = i+1;
                var _mh = document.querySelector('input[name="ext_contra_master"]');
                var _defContra = _mh ? _mh.value : window._ctaBancoDefault;
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
                document.querySelector('#tbl_cash tbody').appendChild(tr);
            };
            window.extAddInst = function(){
                var c = document.getElementById('custpage_inst_count');
                var i = parseInt(c.value); c.value = i+1;
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
                document.querySelector('#tbl_inst tbody').appendChild(tr);
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
            // Cambiar comitente/tipo recarga por GET (no postea el cierre). Confirmar pide confirmación.
            (function(){
                function reload(){
                    var com = document.getElementById('custpage_comitente');
                    var tip = document.getElementById('custpage_tipo');
                    window.location.href = window._reloadUrl
                        + '&custpage_comitente=' + encodeURIComponent(com ? com.value : '')
                        + '&custpage_tipo=' + encodeURIComponent(tip ? tip.value : '');
                }
                ['custpage_comitente','custpage_tipo'].forEach(function(idf){
                    var el = document.getElementById(idf);
                    if (el) el.addEventListener('change', reload);
                });
                var f = document.getElementById('main_form');
                if (f) f.addEventListener('submit', function(e){
                    if (!confirm('¿Confirmás el cierre? Se generarán los asientos y se actualizarán los registros.')) e.preventDefault();
                });
            })();
        </script>`;
    }

    // ─────────────────────────── ROW HTML ─────────────────────────────
    function rowCashExistente(c, i, cuentas, ctaBancoDefault, tcDefault) {
        return `<tr>
            <td><input type="hidden" name="cash_id_${i}" value="${c.id}" />${c.id}</td>
            <td>${escapeHtml(c.monedaName)}<input type="hidden" name="cash_moneda_${i}" value="${c.moneda}" /></td>
            <td>${cuentaInputServerHtml(`cash_cta_${i}`, c.cta, cuentas)}</td>
            <td>${cuentaInputServerHtml(`cash_contra_${i}`, ctaBancoDefault, cuentas)}</td>
            <td class="num">${fmt(c.saldoActual)}</td>
            <td class="num"><input type="text" name="cash_saldo_${i}" value="" placeholder="${fmt(c.saldoActual)}" /></td>
            <td><input type="date" name="cash_fecha_${i}" value="${_hoyIso()}" onchange="extLookupTc('cash',${i})" /></td>
            <td class="num"><input type="text" name="cash_tc_${i}" value="${_fmtTc(tcDefault)}" /></td>
            <td><input type="checkbox" name="cash_baja_${i}" onchange="extToggleBaja(this)" /></td>
        </tr>`;
    }

    function rowInstExistente(inst, i, cuentas, tcDefault) {
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
            <td class="num"><input type="text" name="inst_tc_${i}" value="${_fmtTc(tcDefault)}" /></td>
            <td><input type="checkbox" name="inst_baja_${i}" onchange="extToggleBaja(this)" /></td>
        </tr>`;
    }

    // ─────────────────────────── BÚSQUEDAS ────────────────────────────
    function buscarComitentes() {
        const res = [];
        // Default de "Cuenta Banco" = EXT_COMITENTE.CUENTA_BANCO. Si el campo no existe aún, fallback sin él.
        try {
            search.create({
                type: EXT_COMITENTE.RECORD_TYPE,
                filters: [['isinactive', 'is', 'F']],
                columns: ['internalid', 'name', EXT_COMITENTE.CUENTA_BANCO]
            }).run().each(r => {
                res.push({ id: r.getValue('internalid'), name: r.getValue('name'), ctaBanco: r.getValue(EXT_COMITENTE.CUENTA_BANCO) });
                return true;
            });
        } catch (error) {
            log.audit('buscarComitentes', `Sin campo ${EXT_COMITENTE.CUENTA_BANCO}, fallback: ${error.message}`);
            res.length = 0;
            search.create({
                type: EXT_COMITENTE.RECORD_TYPE,
                filters: [['isinactive', 'is', 'F']],
                columns: ['internalid', 'name']
            }).run().each(r => {
                res.push({ id: r.getValue('internalid'), name: r.getValue('name'), ctaBanco: '' });
                return true;
            });
        }
        return res;
    }

    function buscarCash(comitenteId) {
        const res = [];
        search.create({
            type: EXT_CASH.RECORD_TYPE,
            filters: [[EXT_CASH.COMITENTE, 'anyof', comitenteId], 'AND', ['isinactive', 'is', 'F']],
            columns: ['internalid', EXT_CASH.MONEDA, EXT_CASH.CTA_CONTABLE, EXT_CASH.CTA_DIF_CAMBIO, EXT_CASH.SALDO_ACTUAL, EXT_CASH.FECHA_ACTUAL]
        }).run().each(r => {
            res.push({
                id: r.getValue('internalid'),
                moneda: r.getValue(EXT_CASH.MONEDA),
                monedaName: r.getText(EXT_CASH.MONEDA),
                cta: r.getValue(EXT_CASH.CTA_CONTABLE),
                ctaDifCambio: r.getValue(EXT_CASH.CTA_DIF_CAMBIO),
                saldoActual: r.getValue(EXT_CASH.SALDO_ACTUAL)
            });
            return true;
        });
        return res;
    }

    function buscarInstrumentos(comitenteId, tipoId) {
        const res = [];
        const filters = [[EXT_INSTRUMENTO.COMITENTE, 'anyof', comitenteId], 'AND', ['isinactive', 'is', 'F']];
        if (tipoId) filters.push('AND', [EXT_INSTRUMENTO.TIPO, 'anyof', tipoId]);
        search.create({
            type: EXT_INSTRUMENTO.RECORD_TYPE,
            filters: filters,
            columns: ['internalid', 'name', EXT_INSTRUMENTO.ISIN, EXT_INSTRUMENTO.TIPO, EXT_INSTRUMENTO.SUBTIPO,
                EXT_INSTRUMENTO.MONEDA, EXT_INSTRUMENTO.CTA_CONTABLE, EXT_INSTRUMENTO.CANTIDAD, EXT_INSTRUMENTO.VALOR_ACTUAL]
        }).run().each(r => {
            res.push({
                id: r.getValue('internalid'),
                nombre: r.getValue('name'),
                isin: r.getValue(EXT_INSTRUMENTO.ISIN),
                tipo: r.getValue(EXT_INSTRUMENTO.TIPO),
                tipoName: r.getText(EXT_INSTRUMENTO.TIPO),
                subtipo: r.getValue(EXT_INSTRUMENTO.SUBTIPO),
                subtipoName: r.getText(EXT_INSTRUMENTO.SUBTIPO),
                moneda: r.getValue(EXT_INSTRUMENTO.MONEDA),
                monedaName: r.getText(EXT_INSTRUMENTO.MONEDA),
                cta: r.getValue(EXT_INSTRUMENTO.CTA_CONTABLE),
                cantidad: r.getValue(EXT_INSTRUMENTO.CANTIDAD),
                valorActual: r.getValue(EXT_INSTRUMENTO.VALOR_ACTUAL)
            });
            return true;
        });
        return res;
    }

    function buscarTipos() {
        const res = [];
        search.create({
            type: EXT_TIPO.RECORD_TYPE,
            filters: [['isinactive', 'is', 'F']],
            columns: ['internalid', 'name', EXT_TIPO.CTA_RESULTADO]
        }).run().each(r => {
            res.push({ id: r.getValue('internalid'), name: r.getValue('name'), ctaResultado: r.getValue(EXT_TIPO.CTA_RESULTADO) });
            return true;
        });
        return res;
    }

    function buscarSubtipos() {
        const res = [];
        search.create({ type: GLOBALS.SUBTIPO_LIST, filters: [['isinactive', 'is', 'F']], columns: ['internalid', 'name'] })
            .run().each(r => { res.push({ id: r.getValue('internalid'), name: r.getValue('name') }); return true; });
        return res;
    }

    function buscarCuentas() {
        const res = [];
        search.create({
            type: 'account',
            filters: [['isinactive', 'is', 'F']],
            columns: ['internalid', search.createColumn({ name: 'number', sort: search.Sort.ASC }), 'name']
        }).run().each(r => {
            const num = r.getValue('number');
            res.push({ id: r.getValue('internalid'), name: (num ? num + ' ' : '') + r.getValue('name') });
            return true;
        });
        return res;
    }

    function buscarMonedas() {
        const res = [];
        search.create({ type: 'currency', filters: [['isinactive', 'is', 'F']], columns: ['internalid', 'name', 'symbol'] })
            .run().each(r => { res.push({ id: r.getValue('internalid'), name: r.getValue('symbol') || r.getValue('name') }); return true; });
        return res;
    }

    // ─────────────────────────── PROCESAR CIERRE ─────────────────────
    /**
     * Parsea el form, hace upsert sobre los records, ajusta el saldo de cash y arma el JE consolidado.
     * Reglas de impacto en cash (instrumentos), por moneda de la cuenta comitente:
     *  - Alta: valida que el cash alcance y debita el valor.
     *  - Update que sube: valida que alcance y debita la diferencia. Que baja: acredita la diferencia.
     *  - Baja total: acredita el valor anterior completo.
     *  - Baja de cash con instrumentos vivos en esa moneda: queda en cero pero activo.
     * Nota: el JE aún no refleja el fondeo/retorno de cash (contrapartida fija) — pendiente de definición.
     */
    function procesarCierre(request) {
        const comitenteId = request.parameters.custpage_comitente;
        if (!comitenteId) return 'No se seleccionó cuenta comitente.';

        const cashCount = parseInt(request.parameters.custpage_cash_count || '0', 10);
        const instCount = parseInt(request.parameters.custpage_inst_count || '0', 10);

        // ── Carga única (evita N+1): mapas por id y por moneda ──
        const cashList = buscarCash(comitenteId);
        const instList = buscarInstrumentos(comitenteId, '');       // todos, sin filtro de tipo
        const cashById = {}, cashByMoneda = {}, instById = {}, monedasConInst = {}, ctaResByTipo = {};
        cashList.forEach(c => { cashById[c.id] = c; if (!(String(c.moneda) in cashByMoneda)) cashByMoneda[String(c.moneda)] = c.id; });
        instList.forEach(x => { instById[x.id] = x; monedasConInst[String(x.moneda)] = true; });
        buscarTipos().forEach(t => { ctaResByTipo[t.id] = t.ctaResultado; });

        const jeLines = [];
        const cambios = { altas: 0, updates: 0, bajas: 0 };
        const errores = [];
        const saldoDisp = {};          // saldo de cash disponible en memoria (running balance)
        const cashAActualizar = {};    // saldos finales a persistir por impacto de instrumentos
        let fechaCierre = null;

        const _cashIdDeMoneda = (m) => cashByMoneda[String(m || '')] || '';
        const _hayInstrumentoEnMoneda = (m) => !!monedasConInst[String(m || '')];
        const _saldoCash = (cashId) => {
            if (!(cashId in saldoDisp)) {
                const c = cashById[cashId];
                saldoDisp[cashId] = c ? (parseNum(c.saldoActual) || 0) : 0;
            }
            return saldoDisp[cashId];
        };
        // delta>0 acredita (devuelve), delta<0 debita (consume). Se persiste al final.
        const _aplicarACash = (cashId, delta) => {
            saldoDisp[cashId] = parseFloat((_saldoCash(cashId) + delta).toFixed(2));
            cashAActualizar[cashId] = saldoDisp[cashId];
        };
        const _trackFecha = (fecha) => {
            const f = parseDate(fecha);
            if (f && (!fechaCierre || f > fechaCierre)) fechaCierre = f;
        };

        // ─── CASH ─────────────────────────────────────────────────
        for (let i = 0; i < cashCount; i++) {
            try { procesarFilaCash(i); } catch (error) {
                errores.push(`Cash fila ${i}: ${error.message}`);
                log.error('procesarFilaCash', error.message);
            }
        }
        // ─── INSTRUMENTOS ────────────────────────────────────────
        for (let i = 0; i < instCount; i++) {
            try { procesarFilaInstrumento(i); } catch (error) {
                errores.push(`Instrumento fila ${i}: ${error.message}`);
                log.error('procesarFilaInstrumento', error.message);
            }
        }

        // Persistir el saldo de cash ajustado por instrumentos.
        Object.keys(cashAActualizar).forEach(cashId => {
            try {
                record.submitFields({ type: EXT_CASH.RECORD_TYPE, id: cashId, values: { [EXT_CASH.SALDO_ACTUAL]: cashAActualizar[cashId] } });
            } catch (error) {
                errores.push(`No se pudo actualizar el saldo del cash ${cashId}: ${error.message}`);
            }
        });

        let jeSkippedMsg = '';
        let jeUrls = [];
        if (jeLines.length > 0) {
            const jeResult = crearJournalEntry(jeLines, comitenteId, fechaCierre);
            jeUrls = jeResult.urls || [];
            if (jeResult.skipped > 0) jeSkippedMsg = ` ${jeResult.skipped} línea(s) sin contrapartida — registrar JE manualmente.`;
        }

        let msg = `Procesado. Altas: ${cambios.altas} · Updates: ${cambios.updates} · Bajas: ${cambios.bajas}.${jeSkippedMsg}`;
        if (errores.length) msg += ` <span style="color:#c62828;">⚠ ${escapeHtml(errores.join(' | '))}</span>`;
        if (jeUrls.length) {
            const links = jeUrls.map((u, i) => `<a href="${u}" target="_blank">Ver JE${jeUrls.length > 1 ? ' ' + (i + 1) : ''}</a>`).join(' · ');
            msg += ` ${links}`;
        }
        return msg;

        // ── Handlers por fila (closures sobre el estado del cierre) ──
        function procesarFilaCash(i) {
            const id = request.parameters[`cash_id_${i}`] || '';
            const moneda = request.parameters[`cash_moneda_${i}`];
            const cta = request.parameters[`cash_cta_${i}`];
            const ctaContra = request.parameters[`cash_contra_${i}`];
            const saldoIn = parseNum(request.parameters[`cash_saldo_${i}`]);
            const fecha = request.parameters[`cash_fecha_${i}`];
            const tc = parseNum(request.parameters[`cash_tc_${i}`]);
            const baja = _esBaja(request.parameters[`cash_baja_${i}`]);
            _trackFecha(fecha);

            // Baja: queda en cero; se desactiva solo si NO hay instrumentos vivos en esa moneda.
            if (id && baja) {
                const c = cashById[id];
                const saldoAnt = c ? (parseNum(c.saldoActual) || 0) : 0;
                const hayInstrumentos = _hayInstrumentoEnMoneda(moneda);
                const values = { [EXT_CASH.SALDO_ACTUAL]: 0 };
                if (!hayInstrumentos) {
                    values.isinactive = true;
                    if (cashByMoneda[String(moneda)] === id) delete cashByMoneda[String(moneda)];
                }
                record.submitFields({ type: EXT_CASH.RECORD_TYPE, id, values });
                saldoDisp[id] = 0;
                jeLines.push({ kind: 'cash_baja', cta: c ? c.cta : '', ctaContra, monto: saldoAnt, cashId: id, moneda, tc });
                cambios.bajas++;
                return;
            }

            // Update de saldo
            if (id && saldoIn !== null) {
                const c = cashById[id];
                const saldoAnt = c ? (parseNum(c.saldoActual) || 0) : 0;
                const dif = parseFloat((saldoIn - saldoAnt).toFixed(2));
                saldoDisp[id] = saldoIn;     // que el fondeo de instrumentos vea el saldo nuevo
                if (dif !== 0) {
                    record.submitFields({
                        type: EXT_CASH.RECORD_TYPE, id,
                        values: { [EXT_CASH.SALDO_ACTUAL]: saldoIn, [EXT_CASH.FECHA_ACTUAL]: parseDate(fecha), [EXT_CASH.TC]: tc || '' }
                    });
                    jeLines.push({ kind: 'cash_update', cta, ctaContra: c ? c.ctaDifCambio : '', monto: dif, cashId: id, moneda, tc });
                    cambios.updates++;
                }
                return;
            }

            // Alta
            if (!id && saldoIn !== null && saldoIn !== 0) {
                const nuevo = record.create({ type: EXT_CASH.RECORD_TYPE });
                nuevo.setValue('name', buildCashName(comitenteId, moneda));
                nuevo.setValue(EXT_CASH.COMITENTE, comitenteId);
                nuevo.setValue(EXT_CASH.MONEDA, moneda);
                nuevo.setValue(EXT_CASH.CTA_CONTABLE, cta);
                nuevo.setValue(EXT_CASH.SALDO_ACTUAL, saldoIn);
                nuevo.setValue(EXT_CASH.FECHA_ACTUAL, parseDate(fecha));
                if (tc) nuevo.setValue(EXT_CASH.TC, tc);
                const nuevoCashId = nuevo.save();
                // Registrar en mapas para que un instrumento de la misma moneda pueda fondearse.
                cashById[nuevoCashId] = { id: nuevoCashId, moneda, cta, ctaDifCambio: '', saldoActual: saldoIn };
                if (!(String(moneda) in cashByMoneda)) cashByMoneda[String(moneda)] = nuevoCashId;
                saldoDisp[nuevoCashId] = saldoIn;
                jeLines.push({ kind: 'cash_alta', cta, ctaContra, monto: saldoIn, cashId: nuevoCashId, moneda, tc });
                cambios.altas++;
            }
        }

        function procesarFilaInstrumento(i) {
            const id = request.parameters[`inst_id_${i}`] || '';
            const nombre = request.parameters[`inst_nombre_${i}`];
            const isin = request.parameters[`inst_isin_${i}`];
            const tipo = request.parameters[`inst_tipo_${i}`];
            const subtipo = request.parameters[`inst_subtipo_${i}`];
            const moneda = request.parameters[`inst_moneda_${i}`];
            const cta = request.parameters[`inst_cta_${i}`];
            const cant = parseNum(request.parameters[`inst_cant_${i}`]);
            const valor = parseNum(request.parameters[`inst_valor_${i}`]);
            const fecha = request.parameters[`inst_fecha_${i}`];
            const tc = parseNum(request.parameters[`inst_tc_${i}`]);
            const baja = _esBaja(request.parameters[`inst_baja_${i}`]);
            _trackFecha(fecha);

            // Baja total → devolver el valor anterior completo al cash de la misma moneda.
            if (id && baja) {
                const x = instById[id];
                const valorAnt = x ? (parseNum(x.valorActual) || 0) : 0;
                record.submitFields({ type: EXT_INSTRUMENTO.RECORD_TYPE, id, values: { isinactive: true, [EXT_INSTRUMENTO.VALOR_ACTUAL]: 0 } });
                if (valorAnt > 0) {
                    const cashId = _cashIdDeMoneda(moneda);
                    if (cashId) _aplicarACash(cashId, valorAnt);
                    else errores.push(`Instrumento ${id}: baja sin cash en esa moneda; no se pudo devolver ${valorAnt}.`);
                }
                jeLines.push({ kind: 'inst_baja', cta: x ? x.cta : '', ctaContra: GLOBALS.CTA_INTERESES_INVERSIONES, monto: valorAnt, instId: id, moneda, tc });
                cambios.bajas++;
                return;
            }

            // Update de valor y/o cantidad
            if (id && (valor !== null || cant !== null)) {
                const x = instById[id];
                const valorAnt = x ? (parseNum(x.valorActual) || 0) : 0;
                const dif = valor !== null ? parseFloat((valor - valorAnt).toFixed(2)) : 0;
                const labelInst = nombre || `Instrumento ${id}`;
                const cashId = _cashIdDeMoneda(moneda);

                // Si el valor sube, validar que el cash alcance ANTES de tocar el record.
                if (dif > 0) {
                    if (!cashId) { errores.push(`"${labelInst}": no hay cash en esa moneda para descontar la diferencia; no se actualizó.`); return; }
                    if (dif > _saldoCash(cashId)) {
                        errores.push(`"${labelInst}": la diferencia (${dif}) supera el saldo de cash disponible (${_saldoCash(cashId)}) en esa moneda; no se actualizó.`);
                        return;
                    }
                }

                const values = { [EXT_INSTRUMENTO.FECHA_ACTUAL]: parseDate(fecha), [EXT_INSTRUMENTO.TC]: tc || '' };
                if (valor !== null) values[EXT_INSTRUMENTO.VALOR_ACTUAL] = valor;
                if (cant !== null) values[EXT_INSTRUMENTO.CANTIDAD] = cant;
                record.submitFields({ type: EXT_INSTRUMENTO.RECORD_TYPE, id, values });

                // Impacto en cash y JE solo si cambió el valor (sube → debita; baja → acredita).
                if (dif !== 0) {
                    if (cashId) _aplicarACash(cashId, -dif);
                    else errores.push(`"${labelInst}": no hay cash en esa moneda; no se pudo devolver la diferencia (${Math.abs(dif)}).`);
                    jeLines.push({ kind: 'inst_update', cta: x ? x.cta : '', ctaContra: ctaResByTipo[tipo] || '', monto: dif, instId: id, moneda, tc });
                }
                cambios.updates++;
                return;
            }

            // Alta → fondeada con el cash de la misma moneda.
            if (!id && valor !== null && valor !== 0 && nombre) {
                const cashId = _cashIdDeMoneda(moneda);
                if (!cashId) { errores.push(`"${nombre}": no hay cash en esa moneda para la cuenta comitente; no se registró.`); return; }
                if (valor > _saldoCash(cashId)) {
                    errores.push(`"${nombre}": el valor (${valor}) supera el saldo de cash disponible (${_saldoCash(cashId)}) en esa moneda; no se registró.`);
                    return;
                }
                const nuevo = record.create({ type: EXT_INSTRUMENTO.RECORD_TYPE });
                nuevo.setValue('name', nombre);
                nuevo.setValue(EXT_INSTRUMENTO.COMITENTE, comitenteId);
                nuevo.setValue(EXT_INSTRUMENTO.ISIN, isin || '');
                nuevo.setValue(EXT_INSTRUMENTO.TIPO, tipo);
                if (subtipo) nuevo.setValue(EXT_INSTRUMENTO.SUBTIPO, subtipo);
                nuevo.setValue(EXT_INSTRUMENTO.MONEDA, moneda);
                nuevo.setValue(EXT_INSTRUMENTO.CTA_CONTABLE, cta);
                if (cant !== null) nuevo.setValue(EXT_INSTRUMENTO.CANTIDAD, cant);
                nuevo.setValue(EXT_INSTRUMENTO.VALOR_ACTUAL, valor);
                nuevo.setValue(EXT_INSTRUMENTO.FECHA_ACTUAL, parseDate(fecha));
                if (tc) nuevo.setValue(EXT_INSTRUMENTO.TC, tc);
                const nuevoInstId = nuevo.save();
                _aplicarACash(cashId, -valor);
                monedasConInst[String(moneda)] = true;
                jeLines.push({ kind: 'inst_alta', cta, ctaContra: GLOBALS.CTA_INTERESES_INVERSIONES, monto: valor, instId: nuevoInstId, moneda, tc });
                cambios.altas++;
            }
        }
    }

    // ─────────────────────────── JE ───────────────────────────────────
    /**
     * Arma el JE consolidado del cierre. Un JE de NetSuite es mono-moneda, así que se agrupa por
     * moneda y se genera un JE por cada una. Cada `kind` define el sentido D/H de la línea:
     *   inst_update / cash_update → cta (D/H según signo de la dif) + ctaContra (inverso)
     *   inst_alta / cash_alta     → D cta / H ctaContra
     *   inst_baja / cash_baja     → H cta / D ctaContra
     * Las líneas sin cta o ctaContra se saltean y se reportan para registro manual.
     */
    function crearJournalEntry(lines, comitenteId, fechaCierre) {
        const lineasValidas = [];
        let skipped = 0;
        lines.forEach(l => { if (!l.cta || !l.ctaContra) skipped++; else lineasValidas.push(l); });
        if (lineasValidas.length === 0) return { urls: [], skipped };

        const grupos = {};
        lineasValidas.forEach(l => { const m = String(l.moneda || ''); (grupos[m] = grupos[m] || []).push(l); });

        const urls = [];
        Object.keys(grupos).forEach(monedaId => {
            const grupo = grupos[monedaId];
            const je = record.create({ type: record.Type.JOURNAL_ENTRY, isDynamic: true });
            je.setValue({ fieldId: 'subsidiary', value: GLOBALS.SUBSIDIARY_ID });
            je.setValue({ fieldId: 'trandate', value: fechaCierre || new Date() });
            je.setValue({ fieldId: 'memo', value: `Cierre Exterior - Cta. Comitente ${comitenteId}` });
            if (comitenteId) je.setValue({ fieldId: GLOBALS.JE_BODY_COMITENTE, value: comitenteId });

            // currency + exchangerate VAN ÚLTIMOS: si trandate se setea DESPUÉS del rate,
            // NetSuite re-sourcea el rate por la fecha y pisa el TC manual de la fila.
            if (monedaId && monedaId !== GLOBALS.BASE_CURRENCY_ID) {
                je.setValue({ fieldId: 'currency', value: monedaId });
                const tc = _tcDelGrupo(grupo);
                if (tc > 0) je.setValue({ fieldId: 'exchangerate', value: tc });
            }

            grupo.forEach(l => {
                const monto = Math.abs(l.monto);
                const dirCta = (l.kind === 'inst_update' || l.kind === 'cash_update')
                    ? (l.monto > 0 ? 'debit' : 'credit')
                    : ((l.kind === 'inst_alta' || l.kind === 'cash_alta') ? 'debit' : 'credit');
                _jeLinea(je, l.cta, dirCta, monto, l.kind, l);
                _jeLinea(je, l.ctaContra, dirCta === 'debit' ? 'credit' : 'debit', monto, l.kind + ' (contra)', l);
            });

            const id = je.save({ enableSourcing: true, ignoreMandatoryFields: false });
            urls.push(url.resolveRecord({ recordType: 'journalentry', recordId: id }));
        });

        return { urls: urls, skipped: skipped };
    }

    function _jeLinea(je, cuenta, dir, monto, memo, l) {
        je.selectNewLine({ sublistId: 'line' });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: cuenta });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: dir, value: monto });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: memo });
        if (l.instId) je.setCurrentSublistValue({ sublistId: 'line', fieldId: GLOBALS.JE_COL_INSTRUMENTO, value: l.instId });
        if (l.cashId) je.setCurrentSublistValue({ sublistId: 'line', fieldId: GLOBALS.JE_COL_CASH, value: l.cashId });
        je.commitLine({ sublistId: 'line' });
    }

    function _tcDelGrupo(grupo) {
        for (let i = 0; i < grupo.length; i++) {
            const t = parseFloat(grupo[i].tc || 0);
            if (t > 0) return t;
        }
        return 0;
    }

    // ─────────────────────────── HELPERS ──────────────────────────────
    function buildCashName(comitenteId, monedaId) {
        let comNombre = `Cta ${comitenteId}`;
        let monSimbolo = String(monedaId || '');
        try {
            const c = search.lookupFields({ type: EXT_COMITENTE.RECORD_TYPE, id: comitenteId, columns: ['name'] });
            if (c && c.name) comNombre = c.name;
        } catch (error) { /* noop */ }
        try {
            const m = search.lookupFields({ type: 'currency', id: monedaId, columns: ['symbol', 'name'] });
            if (m && (m.symbol || m.name)) monSimbolo = m.symbol || m.name;
        } catch (error) { /* noop */ }
        return `${comNombre} - ${monSimbolo}`;
    }

    function parseNum(s) {
        if (s === undefined || s === null || s === '') return null;
        const n = parseFloat(String(s).replace(',', '.'));
        return isNaN(n) ? null : n;
    }

    // Parsea 'yyyy-mm-dd' como fecha LOCAL (evita el corrimiento de día por UTC). null si es inválida/vacía.
    function parseDate(s) {
        if (!s) return null;
        const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m) return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
        const d = new Date(s);
        return isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }

    function _esBaja(v) { return v === 'T' || v === 'on' || v === true; }

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

    function escapeHtml(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // TC de (moneda → ARS) a una fecha. Devuelve 1 si es la moneda base o si falla el lookup.
    function _tipoCambio(monedaId, fecha) {
        if (!monedaId || String(monedaId) === GLOBALS.BASE_CURRENCY_ID) return 1;
        try {
            const rate = currency.exchangeRate({ source: monedaId, target: GLOBALS.BASE_CURRENCY_ID, date: fecha || new Date() });
            return rate > 0 ? rate : 1;
        } catch (error) {
            log.error('_tipoCambio', `moneda=${monedaId} fecha=${fecha} err=${error.message}`);
            return 1;
        }
    }

    // El TC siempre se muestra con 4 decimales (requerimiento PM). Ej: 1000.5 → "1000.5000".
    function _fmtTc(n) {
        const v = parseFloat(n);
        return isFinite(v) ? v.toFixed(4) : '';
    }

    function _hoyIso() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function _parseTcDate(s) {
        const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m) return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
        const d = new Date(s);
        return isNaN(d.getTime()) ? new Date() : d;
    }

    return { onRequest };
});
