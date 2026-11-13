/* Yard Security first-install walkthrough.
 *
 * Starts by itself the first time the plugin page is opened (until it is
 * finished or skipped once), and again from the "Walkthrough" button or the
 * help page. It does not block the page: each step points at the part of the
 * page to use, and a live check shows when the step is done.
 *
 * Talks to assets/yardsecurity.js through window.YardSecurity and the ys:ready
 * event (FPP loads plugin scripts in no fixed order).
 */
(function () {
    'use strict';

    var panel = null;
    var stepIndex = 0;
    var timer = null;
    var target = null;

    function $(id) { return document.getElementById(id); }
    // The page script's state, or null until it has loaded. Every step must
    // still work (minus its live check) without it.
    function Y() { var y = window.YardSecurity; return y && y.ready ? y : null; }

    function esc(s) {
        return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function closest(sel, up) {
        var el = document.querySelector(sel);
        return el && up ? (el.closest(up) || el) : el;
    }

    function status() { return (Y() && Y().status()) || {}; }
    function cfg() { return (Y() && Y().config()) || {}; }

    function liveSensors() {
        var s = status().sensors || {};
        return Object.keys(s).filter(function (n) {
            return s[n].online && s[n].radarOk && s[n].ageSec !== null && s[n].ageSec <= 2;
        }).sort();
    }

    function saved() { return !(Y() && Y().isDirty()); }

    var NOT_LOADED = 'Live check unavailable: the page did not finish loading. Reload it (Ctrl+F5 / Cmd+Shift+R).';

    // Each check returns [state, text]; state is "ok", "wait" or "warn".
    var STEPS = [
        {
            title: 'Welcome to Yard Security',
            body: function () {
                return '<p>This walkthrough sets the plugin up in about ten minutes. It stays docked down here while you use the page, so you can follow along.</p>' +
                    '<p class="mb-1">You will need:</p><ul class="mb-1">' +
                    '<li>The address of your <b>show player</b> (the FPP that runs the lights)</li>' +
                    '<li>Your ESP32 + LD2450 sensors and a computer with ESPHome, to flash them</li></ul>' +
                    '<p class="mb-0 small text-body-secondary">You can leave at any time and replay it later with the <b>Walkthrough</b> button at the top of this page.</p>';
            }
        },
        {
            title: 'Step 1: Make presets on the show player',
            target: function () { return closest('#ys-show-host', '.row'); },
            body: function () {
                return '<p>On the <b>show player</b>, not this one, open <b>Content Setup &rarr; Command Presets</b> and make two presets for each area. For example:</p>' +
                    '<ul class="mb-2"><li><b>Driveway On</b>: <i>Overlay Model Fill</i>, your model, <i>Enabled</i>, a colour</li>' +
                    '<li><b>Driveway Off</b>: <i>Overlay Model State</i>, your model, <i>Disabled</i></li></ul>' +
                    '<p class="mb-0">Then come back here and type the show player\'s address in <b>Address</b> (highlighted). If the show player has a UI password, enter it too.</p>';
            },
            actions: [{ label: 'Check the show player', run: function () { if (Y()) { Y().reloadPresets(); } } }],
            check: function () {
                var p = Y().presets();
                if (!p.loaded) { return ['wait', 'Checking the show player...']; }
                if (!p.ok) { return ['wait', p.error || 'Show player not reached yet']; }
                if (!p.count) { return ['warn', 'Show player reached, but it has no Command Presets yet']; }
                return ['ok', 'Show player reached: ' + p.count + ' preset' + (p.count === 1 ? '' : 's') + ' found'];
            }
        },
        {
            title: 'Step 2: Pick the sensor password',
            target: function () { return closest('#ys-mqtt-password', '.row'); },
            body: function () {
                return '<p>The sensors log in to this FPP with a user and password. Leave the user as <b>' + esc(cfg().mqtt && cfg().mqtt.username) + '</b>, press <b>New</b> to make a password, and copy it somewhere safe: it goes into the ESPHome files later. (<b>Show</b> reveals it again before you save.)</p>' +
                    '<p class="mb-0">Then press <b>Save settings</b> at the bottom of the page.</p>';
            },
            check: function () {
                if (!Y().info().hasMqttPassword) { return ['wait', 'No password saved yet']; }
                if (!saved()) { return ['wait', 'Press Save settings']; }
                return ['ok', 'Password saved'];
            }
        },
        {
            title: 'Step 3: Turn on the built-in broker',
            target: function () { return closest('.ys-builtin') || closest('#ys-mqtt-mode', '.row'); },
            onShow: function () { if (Y()) { Y().refreshBroker(); } },
            body: function () {
                if (cfg().mqtt && cfg().mqtt.mode === 'external') {
                    return '<p class="mb-0">You chose <b>A broker I already run</b>, so there is nothing to turn on. Make sure that broker has the user and password from step 2, then press <b>Next</b>.</p>';
                }
                return '<p>The sensors send their readings to a small message server (an MQTT broker). FPP already includes one; press <b>Turn on</b> in the highlighted box.</p>' +
                    '<p class="mb-0 small text-body-secondary">It listens on port 1883 of this device for your home network, and only accepts the password you saved.</p>';
            },
            check: function () {
                if (cfg().mqtt && cfg().mqtt.mode === 'external') { return ['ok', 'Using your own broker']; }
                var b = Y().broker();
                if (!b.loaded) { return ['wait', 'Checking...']; }
                if (b.configured && b.active) { return ['ok', 'Built-in broker is on']; }
                if (b.configured) { return ['warn', 'Turned on, but Mosquitto is not running']; }
                if (b.wanted) { return ['warn', 'It was on, but an FPP OS upgrade removed it: press Turn on']; }
                return ['wait', 'Built-in broker is off'];
            }
        },
        {
            title: 'Step 4: Switch Yard Security on',
            target: function () { return closest('#ys-enabled', '.form-check'); },
            body: function () {
                return '<p>Turn on <b>Yard Security is on</b> and press <b>Save settings</b>. The plugin then connects to the broker and starts listening for sensors.</p>' +
                    '<p class="mb-0 small text-body-secondary">This is safe now: nothing lights up until you add areas.</p>';
            },
            check: function () {
                var st = status();
                if (!st.enabled) { return ['wait', saved() ? 'Not switched on yet' : 'Press Save settings']; }
                if (st.mqtt && st.mqtt.connected) { return ['ok', 'On, and connected to the broker']; }
                return ['warn', 'On, but not connected to the broker' + (st.mqtt && st.mqtt.error ? ': ' + st.mqtt.error : ' yet')];
            }
        },
        {
            title: 'Step 5: Flash the ESP32 sensors',
            target: function () { return closest('#ys-sensors', '.card'); },
            body: function () {
                var c = cfg().mqtt || {};
                return '<p>The ESPHome files are in the plugin\'s <code>esphome/</code> folder on GitHub (bobreese/fpp-plugin-YardSecurity). On your computer, copy <code>secrets.yaml.example</code> to <code>secrets.yaml</code> and fill in your Wi-Fi and:</p>' +
                    '<pre class="small border rounded p-2 mb-2 ys-tour-pre">mqtt_broker: "' + esc(window.location.hostname) + '"\nmqtt_username: "' + esc(c.username) + '"\nmqtt_password: "the password from step 2"</pre>' +
                    '<p class="mb-1">Plug each ESP32 in by USB and run <code>esphome run yard-sensor-1.yaml</code> (then <code>-2</code>, <code>-3</code>). On each sensor\'s page (<code>http://yard-sensor-1.local</code>) turn <b>Radar Bluetooth</b> off.</p>' +
                    '<p class="mb-0 small text-body-secondary">Not ready yet? Press Next. The sensors show up here by themselves once they are flashed.</p>';
            },
            check: function () {
                var live = liveSensors();
                if (live.length) { return ['ok', live.length + ' sensor' + (live.length === 1 ? '' : 's') + ' reporting: ' + live.join(', ')]; }
                return ['wait', 'No sensors reporting yet'];
            }
        },
        {
            title: 'Step 6: Add an area for each sensor',
            target: function () { return closest('#ys-add-area', '.card'); },
            body: function () {
                return '<p>Press <b>Add area</b> once per sensor and fill in:</p><ul class="mb-2">' +
                    '<li><b>Name</b>, e.g. Driveway, and its <b>Sensor</b></li>' +
                    '<li><b>Trigger distance</b>: how close someone must come (e.g. 10 or 15 ft)</li>' +
                    '<li><b>When someone enters</b>: Command Preset <i>Driveway On</i>; <b>When the area is clear again</b>: <i>Driveway Off</i></li></ul>' +
                    '<p class="mb-0">Then press <b>Save settings</b>.</p>';
            },
            check: function () {
                var n = (status().areas || []).length;
                if (!n) { return ['wait', saved() ? 'No areas saved yet' : 'Press Save settings']; }
                if (!saved()) { return ['wait', 'Press Save settings']; }
                var noAction = (cfg().areas || []).filter(function (a) { return !a.onEnter || a.onEnter.type === 'none'; });
                if (noAction.length) { return ['warn', noAction.map(function (a) { return a.name; }).join(', ') + ': no enter action yet']; }
                return ['ok', n + ' area' + (n === 1 ? '' : 's') + ' saved'];
            }
        },
        {
            title: 'Step 7: Test the lights',
            target: function () { return closest('#ys-areas .ys-area [data-test="enter"]', '.d-flex') || closest('#ys-areas'); },
            body: function () {
                return '<p>Press <b>Test enter</b> on an area: its lights should come on at the show. <b>Test exit</b> turns them off.</p>' +
                    '<p class="mb-0 small text-body-secondary">Nothing happens? Check the preset names match the show player exactly, and look at <b>Recent activity</b> at the bottom of this page for errors.</p>';
            },
            check: function () {
                var ev = (status().events || []).filter(function (e) { return e.kind === 'sent' || e.kind === 'error'; });
                if (!ev.length) { return ['wait', 'No test sent yet']; }
                if (ev[0].kind === 'error') { return ['warn', 'Last command failed: ' + ev[0].detail]; }
                return ['ok', 'Show player accepted: ' + ev[0].detail];
            }
        },
        {
            title: 'Step 8: Walk the yard and tune',
            target: function () { return closest('#ys-sensors', '.card'); },
            body: function () {
                return '<p>With this page open on your phone, walk into each area. You show up as a red dot on that sensor\'s view, and the shaded shape is the area.</p>' +
                    '<ul class="mb-0"><li>Lights too early or too late: change <b>Trigger distance</b></li>' +
                    '<li>Picks up the sidewalk or street: set <b>Side limits</b> (L / R)</li>' +
                    '<li>Flickers on and off: raise <b>Stay lit after they leave</b></li></ul>';
            }
        },
        {
            title: 'Step 9: Choose when it is armed',
            target: function () { return closest('#ys-arm-mode', '.row'); },
            body: function () {
                return '<ul class="mb-2"><li><b>Automatically after the show is over</b>: arms when the show player stops, disarms when a show starts</li>' +
                    '<li><b>Only by the FPP Scheduler</b>: add <i>Yard Security - Arm</i> and <i>Yard Security - Disarm</i> commands to this device\'s Scheduler (Content Setup &rarr; Scheduler)</li>' +
                    '<li><b>Always</b></li></ul>' +
                    '<p class="mb-0">Pick one, optionally limit the hours, and press <b>Save settings</b>.</p>';
            },
            check: function () {
                var st = status();
                if (!saved()) { return ['wait', 'Press Save settings']; }
                if (!st.enabled) { return ['warn', 'Yard Security is switched off (step 4)']; }
                return ['ok', (st.armed ? 'Armed now: ' : 'Not armed now: ') + (st.armReason || '')];
            }
        },
        {
            title: 'All set',
            target: function () { return $('ys-tour-start'); },
            body: function () {
                return '<p>Yard Security is set up. The badge at the top shows whether it is armed, and <b>Arm now</b> / <b>Disarm now</b> override the schedule until you press <b>Automatic</b>.</p>' +
                    '<p class="mb-0">To see this walkthrough again, press <b>Walkthrough</b> at the top of the page.</p>';
            }
        }
    ];

    function safeBody(step) {
        try {
            return step.body();
        } catch (e) {
            return '<p class="text-danger-emphasis">This step could not be shown (' + esc(e.message) + ').</p>';
        }
    }

    function clearTarget() {
        if (target) { target.classList.remove('ys-tour-target'); }
        target = null;
    }

    function renderCheck() {
        var step = STEPS[stepIndex];
        var box = panel && panel.querySelector('.ys-tour-check');
        if (!box) { return; }
        if (!step.check) { box.classList.add('d-none'); return; }
        var r;
        try {
            r = Y() ? step.check() : ['warn', NOT_LOADED];
        } catch (e) {
            r = ['warn', 'Live check failed: ' + e.message];
        }
        var icon = r[0] === 'ok' ? '&#10003;' : (r[0] === 'warn' ? '!' : '&hellip;');
        var cls = r[0] === 'ok' ? 'text-success-emphasis bg-success-subtle border-success-subtle' :
            (r[0] === 'warn' ? 'text-warning-emphasis bg-warning-subtle border-warning-subtle' : 'text-body-secondary bg-body-tertiary');
        box.className = 'ys-tour-check border rounded px-2 py-1 small mt-2 ' + cls;
        box.innerHTML = '<b aria-hidden="true">' + icon + '</b> ' + esc(r[1]);
    }

    // On narrow screens the panel spans the bottom of the page: leave room for
    // it so the Save settings bar and the end of the page stay reachable.
    function fitPage() {
        var h = panel && !panel.classList.contains('d-none') ? panel.offsetHeight : 0;
        document.documentElement.style.setProperty('--ys-tour-h', h + 'px');
    }

    function show(i) {
        stepIndex = Math.max(0, Math.min(STEPS.length - 1, i));
        var step = STEPS[stepIndex];
        clearTarget();
        if (step.onShow) { step.onShow(); }
        var last = stepIndex === STEPS.length - 1;
        var acts = (step.actions || []).map(function (a, n) {
            return '<button type="button" class="btn btn-sm btn-outline-primary" data-tour-action="' + n + '">' + esc(a.label) + '</button>';
        }).join('');
        panel.querySelector('.ys-tour-body').innerHTML =
            '<div class="d-flex align-items-start gap-2 mb-2">' +
            '  <h2 class="h6 mb-0 me-auto" id="ys-tour-title">' + esc(step.title) + '</h2>' +
            '  <span class="small text-body-secondary text-nowrap">' + (stepIndex + 1) + ' / ' + STEPS.length + '</span>' +
            '</div>' +
            '<div class="ys-tour-text small">' + safeBody(step) + '</div>' +
            (acts ? '<div class="d-flex flex-wrap gap-2 mt-2">' + acts + '</div>' : '') +
            '<div class="ys-tour-check d-none" role="status" aria-live="polite"></div>';
        panel.querySelector('[data-tour="back"]').disabled = stepIndex === 0;
        panel.querySelector('[data-tour="next"]').textContent = last ? 'Finish' : 'Next';
        renderCheck();
        fitPage();

        var el = step.target ? step.target() : null;
        if (el && el.offsetParent !== null) {
            target = el;
            el.classList.add('ys-tour-target');
            var r = el.getBoundingClientRect();
            var room = window.innerHeight - panel.offsetHeight;
            if (r.top < 0 || r.bottom > room) {
                window.scrollBy({ top: r.top - Math.max(8, (room - r.height) / 2), behavior: 'smooth' });
            }
        }
        panel.querySelector('[data-tour="next"]').focus({ preventScroll: true });
    }

    function open(startAt) {
        if (!panel) { build(); }
        panel.classList.remove('d-none');
        document.body.classList.add('ys-tour-open');
        show(startAt || 0);
        if (!timer) { timer = window.setInterval(renderCheck, 1000); }
    }

    function close() {
        clearTarget();
        if (panel) { panel.classList.add('d-none'); }
        document.body.classList.remove('ys-tour-open');
        fitPage();
        if (timer) { window.clearInterval(timer); timer = null; }
        if (Y() && !Y().info().walkthroughDone) {
            Y().markWalkthrough(true);
            if (window.jQuery && jQuery.jGrowl) {
                jQuery.jGrowl('You can replay the walkthrough from the Walkthrough button at the top of the page.', { themeState: 'success' });
            }
        }
    }

    function build() {
        panel = document.createElement('section');
        panel.className = 'ys-tour card shadow d-none';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'false');
        panel.setAttribute('aria-labelledby', 'ys-tour-title');
        panel.innerHTML =
            '<div class="card-body p-3">' +
            '  <div class="ys-tour-body"></div>' +
            '  <div class="d-flex flex-wrap align-items-center gap-2 mt-3">' +
            '    <button type="button" class="btn btn-sm btn-link px-0 me-auto" data-tour="close">Close walkthrough</button>' +
            '    <button type="button" class="btn btn-sm btn-outline-secondary" data-tour="back">Back</button>' +
            '    <button type="button" class="btn btn-sm btn-primary" data-tour="next">Next</button>' +
            '  </div>' +
            '</div>';
        panel.addEventListener('click', function (e) {
            var t = e.target.closest('button');
            if (!t) { return; }
            var what = t.getAttribute('data-tour');
            if (what === 'close') { close(); }
            else if (what === 'back') { show(stepIndex - 1); }
            else if (what === 'next') {
                if (stepIndex === STEPS.length - 1) { close(); } else { show(stepIndex + 1); }
            } else if (t.hasAttribute('data-tour-action')) {
                STEPS[stepIndex].actions[parseInt(t.getAttribute('data-tour-action'), 10)].run();
            }
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && panel && !panel.classList.contains('d-none')) { close(); }
        });
        window.addEventListener('resize', fitPage);
        $('ys-app').appendChild(panel);
    }

    // Opens by itself on the first visit, once the page script says the
    // walkthrough has not been finished yet.
    function autoStart() {
        if (Y() && !Y().info().walkthroughDone && (!panel || panel.classList.contains('d-none'))) { open(0); }
    }

    function init() {
        if (!$('ys-app')) { return; }  // another page of this plugin
        // The button and ?tour=1 never wait for the page script: if it is
        // slow, stale or broken, the walkthrough still opens and says so.
        var btn = $('ys-tour-start');
        if (btn) { btn.addEventListener('click', function () { open(0); }); }
        if (/[?&]tour=1(&|$)/.test(window.location.search)) { open(0); }
        if (Y()) { autoStart(); } else { document.addEventListener('ys:ready', autoStart, { once: true }); }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}());
