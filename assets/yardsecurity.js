/* Yard Security plugin page. Loaded by status.php with a version in the URL. */
(function () {
    'use strict';

    var API = 'api/plugin/fpp-plugin-YardSecurity/';
    var FAN_DEG = 60;      // LD2450 sees about +/-60 degrees
    var VIEW_FT = 22;      // how far the drawing goes

    var DEFAULTS = {
        enabled: false,
        logLevel: 'info',
        show: { host: '', username: 'admin' },
        arming: { mode: 'afterShow', graceMinutes: 2, startTime: '', endTime: '' },
        mqtt: { mode: 'builtin', host: '127.0.0.1', port: 1883, username: 'yardsecurity', topicPrefix: 'yardsecurity' },
        areas: []
    };
    var AREA_DEFAULTS = {
        id: '', name: '', enabled: true, sensor: '', minFt: 0, maxFt: 15, leftFt: 0, rightFt: 0,
        enterMs: 300, holdSec: 5, cooldownSec: 30, onEnter: { type: 'none' }, onExit: { type: 'none' }
    };

    var cfg = null;
    var presetInfo = { loaded: false, ok: false, count: 0, error: '' };
    var brokerInfo = { loaded: false, configured: false, active: false, wanted: false };
    var configInfo = { hasMqttPassword: false, hasShowPassword: false, walkthroughDone: true };
    var lastStatus = null;
    var dirty = false;

    function $(id) { return document.getElementById(id); }

    function esc(s) {
        return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function merge(def, val) {
        var out = {};
        Object.keys(def).forEach(function (k) {
            var d = def[k];
            var v = val && Object.prototype.hasOwnProperty.call(val, k) ? val[k] : undefined;
            if (d && typeof d === 'object' && !Array.isArray(d)) {
                out[k] = merge(d, v && typeof v === 'object' ? v : {});
            } else {
                out[k] = v === undefined ? JSON.parse(JSON.stringify(d)) : v;
            }
        });
        return out;
    }

    function toast(msg, ok) {
        if (window.jQuery && jQuery.jGrowl) {
            jQuery.jGrowl(msg, { themeState: ok === false ? 'danger' : 'success' });
        } else {
            window.alert(msg);
        }
    }

    function api(path, method, body) {
        var opts = { method: method || 'GET', headers: {} };
        if (body !== undefined) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }
        return fetch(API + path, opts).then(function (r) { return r.json(); });
    }

    function setDirty(v) {
        dirty = v;
        $('ys-dirty').classList.toggle('d-none', !v);
    }

    // ------------------------------------------------------------------ areas

    function newId() {
        var used = {};
        cfg.areas.forEach(function (a) { used[a.id] = true; });
        for (var i = 1; ; i++) {
            if (!used['area' + i]) { return 'area' + i; }
        }
    }

    function actionHtml(prefix, a) {
        a = a || { type: 'none' };
        var args = (a.args || []).join('\n');
        return '' +
            '<div class="row g-2 align-items-start">' +
            '  <div class="col-12 col-sm-4">' +
            '    <select class="form-select" data-f="' + prefix + 'Type">' +
            '      <option value="none"' + (a.type === 'none' ? ' selected' : '') + '>Do nothing</option>' +
            '      <option value="preset"' + (a.type === 'preset' ? ' selected' : '') + '>Command Preset</option>' +
            '      <option value="command"' + (a.type === 'command' ? ' selected' : '') + '>FPP command</option>' +
            '    </select>' +
            '  </div>' +
            '  <div class="col-12 col-sm-8 ys-act-preset' + (a.type === 'preset' ? '' : ' d-none') + '">' +
            '    <input class="form-control" list="ys-preset-list" data-f="' + prefix + 'Preset" placeholder="Preset name on the show player" value="' + esc(a.preset || '') + '">' +
            '  </div>' +
            '  <div class="col-12 col-sm-8 ys-act-command' + (a.type === 'command' ? '' : ' d-none') + '">' +
            '    <input class="form-control mb-1" data-f="' + prefix + 'Command" placeholder="Command, e.g. Overlay Model Fill" value="' + esc(a.command || '') + '">' +
            '    <textarea class="form-control" rows="3" data-f="' + prefix + 'Args" placeholder="One argument per line, e.g.&#10;Arch&#10;Enabled&#10;#FF0000">' + esc(args) + '</textarea>' +
            '  </div>' +
            '</div>';
    }

    function num(label, f, val, step, unit, help) {
        return '<div class="col-6 col-md-3">' +
            '<label class="form-label small mb-0">' + label + '</label>' +
            '<div class="input-group input-group-sm"><input class="form-control" type="number" min="0" step="' + step + '" data-f="' + f + '" value="' + esc(val) + '">' +
            '<span class="input-group-text">' + unit + '</span></div>' +
            (help ? '<div class="form-text">' + help + '</div>' : '') + '</div>';
    }

    function areaHtml(a) {
        return '' +
            '<div class="border rounded p-2 mb-3 ys-area" data-id="' + esc(a.id) + '">' +
            '  <div class="d-flex flex-wrap align-items-center gap-2 mb-2">' +
            '    <input class="form-control fw-bold ys-name" data-f="name" value="' + esc(a.name) + '" placeholder="Area name" maxlength="40">' +
            '    <span class="badge text-bg-secondary ys-area-state">...</span>' +
            '    <div class="form-check form-switch mb-0">' +
            '      <input class="form-check-input" type="checkbox" role="switch" data-f="enabled"' + (a.enabled ? ' checked' : '') + '>' +
            '      <label class="form-check-label small">On</label>' +
            '    </div>' +
            '  </div>' +
            '  <div class="row g-2 mb-2">' +
            '    <div class="col-12 col-md-3">' +
            '      <label class="form-label small mb-0">Sensor</label>' +
            '      <input class="form-control form-control-sm" list="ys-sensor-list" data-f="sensor" value="' + esc(a.sensor) + '" placeholder="e.g. yard-sensor-1">' +
            '    </div>' +
            num('Trigger distance', 'maxFt', a.maxFt, '0.5', 'ft', 'Lights when someone is this close') +
            num('Ignore closer than', 'minFt', a.minFt, '0.5', 'ft', '0 = no limit') +
            '    <div class="col-12 col-md-3">' +
            '      <label class="form-label small mb-0">Side limits (0 = full width)</label>' +
            '      <div class="input-group input-group-sm">' +
            '        <span class="input-group-text">L</span><input class="form-control" type="number" min="0" step="0.5" data-f="leftFt" value="' + esc(a.leftFt) + '">' +
            '        <span class="input-group-text">R</span><input class="form-control" type="number" min="0" step="0.5" data-f="rightFt" value="' + esc(a.rightFt) + '">' +
            '        <span class="input-group-text">ft</span>' +
            '      </div>' +
            '    </div>' +
            num('Must be there for', 'enterMs', a.enterMs, '100', 'ms', 'Ignores quick blips') +
            num('Stay lit after they leave', 'holdSec', a.holdSec, '1', 's', '') +
            num('Then wait before relighting', 'cooldownSec', a.cooldownSec, '1', 's', '') +
            '  </div>' +
            '  <div class="mb-2"><div class="small fw-bold">When someone enters</div>' + actionHtml('enter', a.onEnter) + '</div>' +
            '  <div class="mb-2"><div class="small fw-bold">When the area is clear again</div>' + actionHtml('exit', a.onExit) + '</div>' +
            '  <div class="d-flex flex-wrap gap-2">' +
            '    <button type="button" class="btn btn-sm btn-outline-success" data-test="enter">Test enter</button>' +
            '    <button type="button" class="btn btn-sm btn-outline-secondary" data-test="exit">Test exit</button>' +
            '    <button type="button" class="btn btn-sm btn-outline-danger ms-auto" data-del="1">Remove area</button>' +
            '  </div>' +
            '</div>';
    }

    function renderAreas() {
        var box = $('ys-areas');
        if (!cfg.areas.length) {
            box.innerHTML = '<p class="text-body-secondary">No areas yet. Press <b>Add area</b>.</p>';
            return;
        }
        box.innerHTML = cfg.areas.map(areaHtml).join('');
        updateAreaBadges();
    }

    function readAction(el, prefix) {
        var t = el.querySelector('[data-f="' + prefix + 'Type"]').value;
        if (t === 'preset') {
            return { type: 'preset', preset: el.querySelector('[data-f="' + prefix + 'Preset"]').value.trim() };
        }
        if (t === 'command') {
            var args = el.querySelector('[data-f="' + prefix + 'Args"]').value.split('\n')
                .map(function (s) { return s.replace(/\r$/, ''); });
            while (args.length && args[args.length - 1] === '') { args.pop(); }
            return { type: 'command', command: el.querySelector('[data-f="' + prefix + 'Command"]').value.trim(), args: args };
        }
        return { type: 'none' };
    }

    function readAreas() {
        var out = [];
        document.querySelectorAll('#ys-areas .ys-area').forEach(function (el) {
            function v(f) { return el.querySelector('[data-f="' + f + '"]'); }
            function n(f, d) { var x = parseFloat(v(f).value); return isNaN(x) ? d : x; }
            out.push({
                id: el.getAttribute('data-id'),
                name: v('name').value.trim(),
                enabled: v('enabled').checked,
                sensor: v('sensor').value.trim(),
                maxFt: n('maxFt', 15), minFt: n('minFt', 0),
                leftFt: n('leftFt', 0), rightFt: n('rightFt', 0),
                enterMs: n('enterMs', 300), holdSec: n('holdSec', 5), cooldownSec: n('cooldownSec', 30),
                onEnter: readAction(el, 'enter'), onExit: readAction(el, 'exit')
            });
        });
        return out;
    }

    function updateAreaBadges() {
        if (!lastStatus || !lastStatus.areas) { return; }
        var byId = {};
        lastStatus.areas.forEach(function (a) { byId[a.id] = a; });
        document.querySelectorAll('#ys-areas .ys-area').forEach(function (el) {
            var st = byId[el.getAttribute('data-id')];
            var b = el.querySelector('.ys-area-state');
            if (!st) { b.className = 'badge text-bg-secondary ys-area-state'; b.textContent = 'not saved'; return; }
            if (st.lit) { b.className = 'badge text-bg-warning ys-area-state'; b.textContent = 'LIT'; }
            else if (st.occupied) { b.className = 'badge text-bg-info ys-area-state'; b.textContent = st.cooldownLeft > 0 ? 'someone there (cooldown ' + Math.ceil(st.cooldownLeft) + ' s)' : 'someone there'; }
            else { b.className = 'badge text-bg-secondary ys-area-state'; b.textContent = 'clear'; }
        });
    }

    // ---------------------------------------------------------------- settings

    function fillSettings() {
        $('ys-enabled').checked = !!cfg.enabled;
        $('ys-show-host').value = cfg.show.host;
        $('ys-show-user').value = cfg.show.username;
        $('ys-arm-mode').value = cfg.arming.mode;
        $('ys-grace').value = cfg.arming.graceMinutes;
        $('ys-start').value = cfg.arming.startTime;
        $('ys-end').value = cfg.arming.endTime;
        $('ys-mqtt-mode').value = cfg.mqtt.mode;
        $('ys-mqtt-host').value = cfg.mqtt.host;
        $('ys-mqtt-port').value = cfg.mqtt.port;
        $('ys-mqtt-user').value = cfg.mqtt.username;
        $('ys-mqtt-prefix').value = cfg.mqtt.topicPrefix;
        $('ys-debug').checked = cfg.logLevel === 'debug';
        modeVisibility();
    }

    function readSettings() {
        cfg.enabled = $('ys-enabled').checked;
        cfg.show.host = $('ys-show-host').value.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
        cfg.show.username = $('ys-show-user').value.trim() || 'admin';
        cfg.arming.mode = $('ys-arm-mode').value;
        cfg.arming.graceMinutes = parseFloat($('ys-grace').value) || 0;
        cfg.arming.startTime = $('ys-start').value;
        cfg.arming.endTime = $('ys-end').value;
        cfg.mqtt.mode = $('ys-mqtt-mode').value;
        cfg.mqtt.host = $('ys-mqtt-host').value.trim();
        cfg.mqtt.port = parseInt($('ys-mqtt-port').value, 10) || 1883;
        cfg.mqtt.username = $('ys-mqtt-user').value.trim();
        cfg.mqtt.topicPrefix = $('ys-mqtt-prefix').value.trim() || 'yardsecurity';
        cfg.logLevel = $('ys-debug').checked ? 'debug' : 'info';
        cfg.areas = readAreas();
    }

    var MODE_HELP = {
        afterShow: 'Arms when the show player stops playing (or is switched off) and disarms when a show starts.',
        schedule: 'Add "Yard Security - Arm" and "Yard Security - Disarm" commands to the FPP Scheduler on this device (Content Setup -> Scheduler).',
        always: 'Armed all the time, except while disarmed by the button or a command.'
    };

    function modeVisibility() {
        var mode = $('ys-arm-mode').value;
        document.querySelectorAll('.ys-aftershow').forEach(function (e) { e.classList.toggle('d-none', mode !== 'afterShow'); });
        document.querySelectorAll('.ys-window').forEach(function (e) { e.classList.toggle('d-none', mode === 'schedule'); });
        $('ys-mode-help').textContent = MODE_HELP[mode] || '';
        var builtin = $('ys-mqtt-mode').value === 'builtin';
        document.querySelectorAll('.ys-external').forEach(function (e) { e.classList.toggle('d-none', builtin); });
        document.querySelectorAll('.ys-builtin').forEach(function (e) { e.classList.toggle('d-none', !builtin); });
    }

    function save() {
        readSettings();
        var names = {};
        for (var i = 0; i < cfg.areas.length; i++) {
            var a = cfg.areas[i];
            if (!a.name) { toast('Every area needs a name', false); return; }
            if (names[a.name.toLowerCase()]) { toast('Two areas are called "' + a.name + '"', false); return; }
            names[a.name.toLowerCase()] = true;
        }
        var body = { config: cfg };
        var sp = $('ys-show-password').value;
        var mp = $('ys-mqtt-password').value;
        if (sp) { body.showPassword = sp; }
        if (mp) { body.mqttPassword = mp; }
        api('config', 'POST', body).then(function (r) {
            if (!r.ok) { toast(r.error || 'Could not save', false); return; }
            $('ys-show-password').value = '';
            $('ys-mqtt-password').value = '';
            setDirty(false);
            toast('Saved');
            if (r.broker) { toast(r.broker.message, r.broker.ok); refreshBroker(); }
            loadConfig(false);
        }).catch(function () { toast('Could not save', false); });
    }

    function loadConfig(render) {
        return api('config').then(function (r) {
            cfg = merge(DEFAULTS, r.config || {});
            cfg.areas = (Array.isArray(r.config && r.config.areas) ? r.config.areas : []).map(function (a) {
                var m = merge(AREA_DEFAULTS, a);
                // Actions keep all their fields (preset, command, args), not just the defaults' keys.
                m.onEnter = a && a.onEnter && typeof a.onEnter === 'object' ? a.onEnter : { type: 'none' };
                m.onExit = a && a.onExit && typeof a.onExit === 'object' ? a.onExit : { type: 'none' };
                return m;
            });
            configInfo.hasMqttPassword = !!r.hasMqttPassword;
            configInfo.hasShowPassword = !!r.hasShowPassword;
            configInfo.walkthroughDone = !!r.walkthroughDone;
            $('ys-show-password').placeholder = r.hasShowPassword ? '(saved)' : '';
            $('ys-mqtt-password').placeholder = r.hasMqttPassword ? '(saved)' : 'not set';
            if (render !== false) {
                fillSettings();
                renderAreas();
            }
        });
    }

    function loadPresets() {
        var host = $('ys-show-host').value.trim();
        var q = host ? '?host=' + encodeURIComponent(host.replace(/^https?:\/\//, '').replace(/\/+$/, '')) : '';
        $('ys-presets-note').textContent = 'Loading presets from the show player...';
        api('presets' + q).then(function (r) {
            var list = $('ys-preset-list');
            list.innerHTML = '';
            presetInfo = { loaded: true, ok: !!r.ok, count: r.ok ? r.presets.length : 0, error: r.ok ? '' : r.error };
            if (!r.ok) {
                $('ys-presets-note').className = 'small mb-2 text-warning-emphasis';
                $('ys-presets-note').textContent = r.error + ' You can still type preset names.';
                return;
            }
            r.presets.forEach(function (p) {
                var o = document.createElement('option');
                o.value = p;
                list.appendChild(o);
            });
            $('ys-presets-note').className = 'small mb-2 text-body-secondary';
            $('ys-presets-note').textContent = r.presets.length ? r.presets.length + ' presets found on the show player.' : 'The show player has no Command Presets yet.';
        }).catch(function () {
            presetInfo = { loaded: true, ok: false, count: 0, error: 'Could not load presets.' };
            $('ys-presets-note').textContent = 'Could not load presets.';
        });
    }

    function refreshBroker() {
        api('broker').then(function (r) {
            brokerInfo = { loaded: true, configured: !!r.configured, active: !!r.active, wanted: !!r.wanted };
            var s = !r.ok ? 'unknown' : (r.configured ? (r.active ? 'on' : 'configured, but Mosquitto is not running') :
                (r.wanted ? 'off (removed by an FPP OS upgrade?)' : 'off'));
            $('ys-broker-state').textContent = s;
            showBrokerLost();
        }).catch(function () { $('ys-broker-state').textContent = 'unknown'; });
    }

    // An FPP OS upgrade replaces /etc, which removes the built-in broker's
    // settings. The plugin remembers it was on; offer to turn it back on.
    function brokerLost() {
        return !!(cfg && cfg.mqtt.mode === 'builtin' && brokerInfo.loaded && brokerInfo.wanted && !brokerInfo.configured);
    }

    function showBrokerLost() {
        $('ys-broker-lost').classList.toggle('d-none', !brokerLost());
    }

    // ------------------------------------------------------------------ status

    function polar(r, deg) {
        var t = deg * Math.PI / 180;
        return [r * Math.sin(t), -r * Math.cos(t)];
    }

    function sectorPath(rIn, rOut) {
        var a = polar(rOut, -FAN_DEG), b = polar(rOut, FAN_DEG);
        var p = 'M' + polar(rIn, -FAN_DEG).join(',') + ' L' + a.join(',') +
            ' A' + rOut + ',' + rOut + ' 0 0 1 ' + b.join(',') + ' L' + polar(rIn, FAN_DEG).join(',');
        if (rIn > 0) {
            p += ' A' + rIn + ',' + rIn + ' 0 0 0 ' + polar(rIn, -FAN_DEG).join(',');
        }
        return p + ' Z';
    }

    function sensorSvg(name, s, areas, idx) {
        var w = VIEW_FT * Math.sin(FAN_DEG * Math.PI / 180) + 1;
        var parts = [];
        parts.push('<svg class="ys-radar" viewBox="' + (-w) + ' ' + (-VIEW_FT - 1) + ' ' + (2 * w) + ' ' + (VIEW_FT + 2) + '" role="img" aria-label="Radar view of ' + esc(name) + '">');
        parts.push('<path class="ys-fan" d="' + sectorPath(0, VIEW_FT) + '"/>');
        [5, 10, 15, 20].forEach(function (r) {
            parts.push('<path class="ys-ring" d="M' + polar(r, -FAN_DEG).join(',') + ' A' + r + ',' + r + ' 0 0 1 ' + polar(r, FAN_DEG).join(',') + '"/>');
            var lp = polar(r, 0);
            parts.push('<text class="ys-ring-label" x="0.3" y="' + (lp[1] + 0.9) + '">' + r + ' ft</text>');
        });
        areas.forEach(function (a, i) {
            var cid = 'ys-clip-' + idx + '-' + i;
            var l = a.leftFt > 0 ? a.leftFt : w, r = a.rightFt > 0 ? a.rightFt : w;
            parts.push('<clipPath id="' + cid + '"><rect x="' + (-l) + '" y="' + (-VIEW_FT - 1) + '" width="' + (l + r) + '" height="' + (VIEW_FT + 2) + '"/></clipPath>');
            parts.push('<path class="ys-zone ys-zone-' + (i % 4) + '" clip-path="url(#' + cid + ')" d="' + sectorPath(Math.min(a.minFt, a.maxFt), Math.min(a.maxFt, VIEW_FT)) + '"><title>' + esc(a.name) + '</title></path>');
        });
        (s.targets || []).forEach(function (t) {
            parts.push('<circle class="ys-target" cx="' + t.xFt + '" cy="' + (-t.yFt) + '" r="0.7"/>');
        });
        parts.push('<circle class="ys-sensor-dot" cx="0" cy="0" r="0.6"/>');
        parts.push('</svg>');
        return parts.join('');
    }

    function renderSensors(st) {
        var names = Object.keys(st.sensors || {});
        var areaSensors = {};
        (cfg ? cfg.areas : []).forEach(function (a) { if (a.sensor) { areaSensors[a.sensor] = true; } });
        Object.keys(areaSensors).forEach(function (n) { if (names.indexOf(n) < 0) { names.push(n); } });
        names.sort();
        var dl = $('ys-sensor-list');
        var opts = names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('');
        if (dl.innerHTML !== opts) { dl.innerHTML = opts; }
        if (!names.length) {
            $('ys-sensors').innerHTML = '<div class="col-12 text-body-secondary">No sensors have reported yet. Check the broker settings and that the ESP32s are powered.</div>';
            return;
        }
        $('ys-sensors').innerHTML = names.map(function (n, idx) {
            var s = (st.sensors || {})[n] || { online: false, targets: [], ageSec: null };
            var state;
            if (s.ageSec === null || s.ageSec === undefined) { state = '<span class="badge text-bg-secondary">never heard from</span>'; }
            else if (!s.online) { state = '<span class="badge text-bg-danger">offline</span>'; }
            else if (!s.radarOk) { state = '<span class="badge text-bg-danger">radar not answering</span>'; }
            else if (s.ageSec > 2) { state = '<span class="badge text-bg-warning">no data for ' + Math.round(s.ageSec) + ' s</span>'; }
            else { state = '<span class="badge text-bg-success">online</span>'; }
            var areas = (cfg ? cfg.areas : []).filter(function (a) { return a.sensor === n && a.enabled; });
            var targets = (s.targets || []).map(function (t) {
                var side = Math.abs(t.xFt) < 0.5 ? 'straight ahead' : Math.abs(t.xFt).toFixed(1) + ' ft ' + (t.xFt < 0 ? 'left' : 'right');
                return t.distFt.toFixed(1) + ' ft away, ' + side;
            });
            return '<div class="col-12 col-md-6 col-xl-4"><div class="border rounded p-2 h-100">' +
                '<div class="d-flex justify-content-between align-items-center mb-1"><b>' + esc(n) + '</b>' + state + '</div>' +
                sensorSvg(n, s, areas, idx) +
                '<div class="small">' + (targets.length ? targets.map(esc).join('<br>') : '<span class="text-body-secondary">Nobody seen</span>') + '</div>' +
                (areas.length ? '<div class="small text-body-secondary">Areas: ' + areas.map(function (a) { return esc(a.name); }).join(', ') + '</div>' : '') +
                '</div></div>';
        }).join('');
    }

    var MODE_NAMES = { afterShow: 'after the show', schedule: 'FPP Scheduler', always: 'always' };

    function renderStatus(st) {
        lastStatus = st;
        $('ys-daemon-down').classList.toggle('d-none', st.ok !== false || st.daemon !== false);
        if (st.ok === false) {
            $('ys-armed-badge').className = 'badge text-bg-secondary fs-6';
            $('ys-armed-badge').textContent = 'Not running';
            $('ys-arm-reason').textContent = st.error || '';
            return;
        }
        var b = $('ys-armed-badge');
        b.className = 'badge fs-6 ' + (st.armed ? 'text-bg-success' : 'text-bg-secondary');
        b.textContent = st.armed ? 'ARMED' : 'Disarmed';
        $('ys-arm-reason').textContent = st.armReason + (st.override ? ' - press Automatic to go back to the arming mode.' : '');
        var sh = st.show || {};
        $('ys-show-status').textContent = !sh.host ? 'not set' : sh.host + ' - ' + (sh.reachable ? sh.status : (sh.status === 'unknown' ? 'not checked yet' : 'not answering'));
        var mq = st.mqtt || {};
        $('ys-mqtt-status').textContent = mq.pahoMissing ? 'python3-paho-mqtt is missing' :
            (mq.connected ? 'connected' : (st.enabled ? 'not connected' + (mq.error ? ' (' + mq.error + ')' : '') : 'off'));
        $('ys-mode-status').textContent = MODE_NAMES[st.mode] || st.mode;
        renderSensors(st);
        updateAreaBadges();
        var ev = st.events || [];
        $('ys-events').innerHTML = ev.length ? ev.map(function (e) {
            var t = new Date(e.t * 1000).toLocaleTimeString();
            var what = { occupied: 'someone entered', clear: 'clear', sent: 'sent', error: 'error', armed: 'ARMED', disarmed: 'disarmed', test: 'test' }[e.kind] || e.kind;
            return '<tr><td class="text-nowrap">' + esc(t) + '</td><td>' + esc(e.area) + '</td><td>' + esc(what) + '</td><td class="small text-body-secondary">' + esc(e.detail) + '</td></tr>';
        }).join('') : '<tr><td class="text-body-secondary">Nothing yet.</td></tr>';
    }

    var pollCount = 0;

    function poll() {
        if (document.hidden) { return; }
        pollCount++;
        if (pollCount % 30 === 0) { refreshBroker(); }
        api('status').then(renderStatus).catch(function () { /* keep the last view */ });
    }

    // ------------------------------------------------------------------- wire

    function init() {
        var app = $('ys-app');
        if (!app) { return; }  // another page of this plugin

        $('ys-this-host').textContent = window.location.hostname;

        document.querySelectorAll('[data-ys-cmd]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                api(btn.getAttribute('data-ys-cmd'), 'POST', {}).then(function (r) {
                    if (!r.ok) { toast(r.error || 'Failed', false); }
                    poll();
                });
            });
        });

        $('ys-add-area').addEventListener('click', function () {
            cfg.areas = readAreas();
            var n = cfg.areas.length + 1;
            var a = merge(AREA_DEFAULTS, { id: newId(), name: 'Area ' + n });
            var known = Object.keys((lastStatus && lastStatus.sensors) || {}).sort();
            if (known.length) { a.sensor = known[Math.min(n - 1, known.length - 1)]; }
            cfg.areas.push(a);
            renderAreas();
            setDirty(true);
        });

        $('ys-areas').addEventListener('click', function (e) {
            var el = e.target.closest('.ys-area');
            if (!el) { return; }
            if (e.target.hasAttribute('data-del')) {
                if (!window.confirm('Remove this area?')) { return; }
                cfg.areas = readAreas().filter(function (a) { return a.id !== el.getAttribute('data-id'); });
                renderAreas();
                setDirty(true);
            } else if (e.target.hasAttribute('data-test')) {
                if (dirty) { toast('Save first, then test', false); return; }
                var name = el.querySelector('[data-f="name"]').value.trim();
                api('test', 'POST', { area: name, phase: e.target.getAttribute('data-test') }).then(function (r) {
                    toast(r.ok ? 'Sent to the show player' : (r.error || 'Failed'), !!r.ok);
                });
            }
        });

        $('ys-areas').addEventListener('change', function (e) {
            var f = e.target.getAttribute('data-f') || '';
            if (/Type$/.test(f)) {
                var row = e.target.closest('.row');
                row.querySelector('.ys-act-preset').classList.toggle('d-none', e.target.value !== 'preset');
                row.querySelector('.ys-act-command').classList.toggle('d-none', e.target.value !== 'command');
            }
            setDirty(true);
        });
        $('ys-areas').addEventListener('input', function () { setDirty(true); });

        document.querySelectorAll('#ys-app .card-body input, #ys-app .card-body select').forEach(function (el) {
            if (el.closest('#ys-areas')) { return; }
            el.addEventListener('change', function () { setDirty(true); modeVisibility(); });
        });

        $('ys-save').addEventListener('click', save);
        $('ys-refresh-presets').addEventListener('click', loadPresets);

        $('ys-gen-password').addEventListener('click', function () {
            var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
            var buf = new Uint32Array(20);
            window.crypto.getRandomValues(buf);
            var pw = '';
            for (var i = 0; i < buf.length; i++) { pw += chars[buf[i] % chars.length]; }
            var f = $('ys-mqtt-password');
            f.value = pw;
            f.type = 'text';
            $('ys-show-mqtt-password').textContent = 'Hide';
            setDirty(true);
        });
        $('ys-show-mqtt-password').addEventListener('click', function () {
            var f = $('ys-mqtt-password');
            f.type = f.type === 'password' ? 'text' : 'password';
            this.textContent = f.type === 'password' ? 'Show' : 'Hide';
        });

        $('ys-broker-restore').addEventListener('click', function () {
            var btn = this;
            btn.disabled = true;
            api('broker/enable', 'POST', {}).then(function (r) {
                toast(r.message, !!r.ok);
                btn.disabled = false;
                refreshBroker();
                poll();
            }).catch(function () { btn.disabled = false; toast('Could not turn the broker on', false); });
        });

        $('ys-broker-on').addEventListener('click', function () {
            if (dirty) { toast('Save the settings first', false); return; }
            api('broker/enable', 'POST', {}).then(function (r) { toast(r.message, !!r.ok); refreshBroker(); poll(); });
        });
        $('ys-broker-off').addEventListener('click', function () {
            if (!window.confirm('Turn off the built-in broker? The sensors will stop reporting.')) { return; }
            api('broker/disable', 'POST', {}).then(function (r) { toast(r.message, !!r.ok); refreshBroker(); poll(); });
        });

        window.addEventListener('beforeunload', function (e) {
            if (dirty) { e.preventDefault(); e.returnValue = ''; }
        });

        // State the walkthrough (assets/yardsecurity-tour.js) reads for its live checks.
        window.YardSecurity = {
            status: function () { return lastStatus; },
            config: function () { return cfg; },
            presets: function () { return presetInfo; },
            broker: function () { return brokerInfo; },
            info: function () { return configInfo; },
            isDirty: function () { return dirty; },
            reloadPresets: loadPresets,
            refreshBroker: refreshBroker,
            markWalkthrough: function (done) {
                configInfo.walkthroughDone = !!done;
                return api('walkthrough', 'POST', { done: !!done });
            }
        };

        loadConfig().then(function () {
            loadPresets();
            refreshBroker();
            poll();
            window.setInterval(poll, 1000);
            window.YardSecurity.ready = true;
            document.dispatchEvent(new CustomEvent('ys:ready'));
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}());
