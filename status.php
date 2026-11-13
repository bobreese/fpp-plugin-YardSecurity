<div id="ys-app" class="ys-app mt-2">
    <noscript><div class="alert alert-warning">This page needs JavaScript.</div></noscript>

    <div id="ys-daemon-down" class="alert alert-warning d-none">
        The Yard Security service is not running. It starts with fppd: restart FPP (or reinstall the plugin) and reload this page.
    </div>

    <div id="ys-broker-lost" class="alert alert-warning d-none" role="alert">
        <div class="d-flex flex-wrap align-items-center gap-2">
            <div class="me-auto">
                <b>The built-in MQTT broker is off, so the sensors cannot report.</b>
                You had turned it on; an FPP OS upgrade removes its settings from the system. Your areas and the
                sensor password are still saved.
            </div>
            <button type="button" class="btn btn-warning" id="ys-broker-restore">Turn it back on</button>
        </div>
    </div>

    <!-- Status -->
    <div class="card mb-3">
        <div class="card-header d-flex flex-wrap align-items-center gap-2">
            <h2 class="h5 mb-0 me-auto">Yard Security</h2>
            <button type="button" class="btn btn-sm btn-outline-primary" id="ys-tour-start">Walkthrough</button>
            <span id="ys-armed-badge" class="badge text-bg-secondary fs-6">...</span>
        </div>
        <div class="card-body">
            <p id="ys-arm-reason" class="mb-2 text-body-secondary">Loading...</p>
            <div class="d-flex flex-wrap gap-2 mb-3">
                <button type="button" class="btn btn-success" data-ys-cmd="arm">Arm now</button>
                <button type="button" class="btn btn-danger" data-ys-cmd="disarm">Disarm now</button>
                <button type="button" class="btn btn-outline-secondary" data-ys-cmd="auto">Automatic</button>
                <button type="button" class="btn btn-outline-info ms-md-auto" id="ys-sim-open">Simulate</button>
            </div>
            <div id="ys-sim-form" class="border rounded p-3 mb-3 d-none">
                <h3 class="h6">Simulate sensors</h3>
                <p class="small mb-2">
                    A pretend person walks into every area and back out, again and again: one pretend sensor for each
                    sensor your areas use. No ESP32s, broker, password or arming are needed, and it works while Yard
                    Security is switched off. An area with no sensor yet is given the next free name
                    (<code>yard-sensor-1</code>, <code>-2</code>, ...), the same names the ESPHome files use.
                </p>
                <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
                    <label for="ys-sim-minutes">Run for</label>
                    <select class="form-select w-auto" id="ys-sim-minutes">
                        <option value="2">2 minutes</option>
                        <option value="5" selected>5 minutes</option>
                        <option value="10">10 minutes</option>
                        <option value="15">15 minutes</option>
                        <option value="30">30 minutes</option>
                    </select>
                </div>
                <div class="form-check mb-3">
                    <input class="form-check-input" type="checkbox" id="ys-sim-send" checked>
                    <label class="form-check-label" for="ys-sim-send">
                        Send the areas' commands to the show player (your <b>real lights</b> turn on and off)
                    </label>
                </div>
                <div class="d-flex flex-wrap gap-2">
                    <button type="button" class="btn btn-info" id="ys-sim-start">Start simulation</button>
                    <button type="button" class="btn btn-outline-secondary" id="ys-sim-cancel">Cancel</button>
                </div>
            </div>
            <div id="ys-sim-running" class="alert alert-info d-none" role="status">
                <div class="d-flex flex-wrap align-items-center gap-2">
                    <div class="me-auto"><b>Simulation running</b>: <span id="ys-sim-text"></span></div>
                    <button type="button" class="btn btn-sm btn-light" id="ys-sim-stop">Stop simulation</button>
                </div>
            </div>
            <div class="row g-2 small">
                <div class="col-12 col-md-4"><span class="text-body-secondary">Show player:</span> <span id="ys-show-status">...</span></div>
                <div class="col-12 col-md-4"><span class="text-body-secondary">Sensor broker:</span> <span id="ys-mqtt-status">...</span></div>
                <div class="col-12 col-md-4"><span class="text-body-secondary">Arming mode:</span> <span id="ys-mode-status">...</span></div>
            </div>
        </div>
    </div>

    <!-- Sensors -->
    <div class="card mb-3">
        <div class="card-header d-flex flex-wrap align-items-center gap-2">
            <h2 class="h5 mb-0 me-auto">Sensors (live)</h2>
            <div class="btn-group btn-group-sm" role="group" aria-label="Sensor view size" id="ys-sensor-size">
                <button type="button" class="btn btn-outline-secondary" data-size="small" aria-pressed="false">Small</button>
                <button type="button" class="btn btn-outline-secondary" data-size="medium" aria-pressed="true">Medium</button>
                <button type="button" class="btn btn-outline-secondary" data-size="large" aria-pressed="false">Large</button>
            </div>
        </div>
        <div class="card-body">
            <p class="small text-body-secondary mb-2">
                Each sensor is drawn from above, pointing up the screen; "left" is your left when you stand behind the sensor looking out.
                Dots are people the radar sees. Shaded shapes are the areas that use that sensor.
            </p>
            <div id="ys-sensors" class="row g-3"><div class="col-12 text-body-secondary">No sensors have reported yet.</div></div>
        </div>
    </div>

    <!-- Areas -->
    <div class="card mb-3">
        <div class="card-header d-flex flex-wrap align-items-center gap-2">
            <h2 class="h5 mb-0 me-auto">Areas</h2>
            <button type="button" class="btn btn-sm btn-outline-secondary" id="ys-refresh-presets">Reload show presets</button>
            <button type="button" class="btn btn-sm btn-primary" id="ys-add-area">Add area</button>
        </div>
        <div class="card-body">
            <p class="small text-body-secondary">
                An area lights up when someone comes within its trigger distance of its sensor. The easiest action is a
                <b>Command Preset</b> made on the show player (Content Setup &rarr; Command Presets), for example
                "Driveway On" and "Driveway Off".
            </p>
            <div id="ys-presets-note" class="small mb-2"></div>
            <div id="ys-areas"></div>
            <datalist id="ys-preset-list"></datalist>
            <datalist id="ys-sensor-list"></datalist>
        </div>
    </div>

    <!-- Settings -->
    <div class="card mb-3">
        <div class="card-header"><h2 class="h5 mb-0">Settings</h2></div>
        <div class="card-body">
            <div class="form-check form-switch mb-3">
                <input class="form-check-input" type="checkbox" role="switch" id="ys-enabled">
                <label class="form-check-label fw-bold" for="ys-enabled">Yard Security is on</label>
                <div class="form-text">When off, nothing connects to the sensors and no commands are sent.</div>
            </div>

            <h3 class="h6 mt-3">Show player</h3>
            <div class="row g-2">
                <div class="col-12 col-md-6">
                    <label class="form-label" for="ys-show-host">Address (hostname or IP)</label>
                    <input class="form-control" id="ys-show-host" placeholder="e.g. 192.168.1.20 or fpp.local" autocomplete="off">
                </div>
                <div class="col-6 col-md-3">
                    <label class="form-label" for="ys-show-user">User</label>
                    <input class="form-control" id="ys-show-user" autocomplete="off">
                </div>
                <div class="col-6 col-md-3">
                    <label class="form-label" for="ys-show-password">Password</label>
                    <input class="form-control" id="ys-show-password" type="password" autocomplete="new-password">
                </div>
                <div class="col-12 form-text">Only needed if you turned on a UI password on the show player. Leave the password empty to keep the saved one.</div>
            </div>

            <h3 class="h6 mt-4">When is it armed?</h3>
            <div class="row g-2">
                <div class="col-12 col-md-6">
                    <select class="form-select" id="ys-arm-mode">
                        <option value="afterShow">Automatically after the show is over</option>
                        <option value="schedule">Only by the FPP Scheduler (Arm / Disarm commands)</option>
                        <option value="always">Always</option>
                    </select>
                </div>
                <div class="col-12 col-md-6 ys-aftershow">
                    <div class="input-group">
                        <span class="input-group-text">Wait</span>
                        <input class="form-control" id="ys-grace" type="number" min="0" max="240" step="1">
                        <span class="input-group-text">minutes after the show stops</span>
                    </div>
                </div>
                <div class="col-12 ys-window">
                    <div class="d-flex flex-wrap align-items-center gap-2">
                        <span>Only between</span>
                        <input class="form-control w-auto" id="ys-start" type="time">
                        <span>and</span>
                        <input class="form-control w-auto" id="ys-end" type="time">
                        <span class="form-text">(leave empty for any time)</span>
                    </div>
                </div>
                <div class="col-12 form-text" id="ys-mode-help"></div>
            </div>

            <h3 class="h6 mt-4">Sensor connection (MQTT)</h3>
            <div class="row g-2">
                <div class="col-12 col-md-6">
                    <select class="form-select" id="ys-mqtt-mode">
                        <option value="builtin">Built-in broker on this device</option>
                        <option value="external">A broker I already run</option>
                    </select>
                </div>
                <div class="col-12 col-md-6 ys-external">
                    <div class="input-group">
                        <input class="form-control" id="ys-mqtt-host" placeholder="Broker address" autocomplete="off">
                        <input class="form-control ys-port" id="ys-mqtt-port" type="number" min="1" max="65535">
                    </div>
                </div>
                <div class="col-6 col-md-4">
                    <label class="form-label" for="ys-mqtt-user">MQTT user</label>
                    <input class="form-control" id="ys-mqtt-user" autocomplete="off">
                </div>
                <div class="col-6 col-md-5">
                    <label class="form-label" for="ys-mqtt-password">MQTT password</label>
                    <div class="input-group">
                        <input class="form-control" id="ys-mqtt-password" type="password" autocomplete="new-password">
                        <button class="btn btn-outline-secondary" type="button" id="ys-gen-password">New</button>
                        <button class="btn btn-outline-secondary" type="button" id="ys-show-mqtt-password">Show</button>
                    </div>
                </div>
                <div class="col-12 col-md-3">
                    <label class="form-label" for="ys-mqtt-prefix">Topic prefix</label>
                    <input class="form-control" id="ys-mqtt-prefix" autocomplete="off">
                </div>
                <div class="col-12 form-text">The same user and password go in the ESPHome <code>secrets.yaml</code>. Leave the password empty to keep the saved one.</div>
            </div>
            <div class="border rounded p-2 mt-2 ys-builtin">
                <div class="d-flex flex-wrap align-items-center gap-2">
                    <span>Built-in broker: <b id="ys-broker-state">...</b></span>
                    <button type="button" class="btn btn-sm btn-success" id="ys-broker-on">Turn on</button>
                    <button type="button" class="btn btn-sm btn-outline-danger" id="ys-broker-off">Turn off</button>
                </div>
                <div class="form-text">
                    Turning it on starts FPP's Mosquitto broker on port 1883 of this device for your local network, with the
                    password above required. Save the user and password first. If this FPP's own MQTT settings point at this
                    device, give them the same user and password.
                </div>
            </div>
            <div class="mt-2 small">ESPHome <code>mqtt_broker</code> for this device: <code id="ys-this-host"></code></div>

            <h3 class="h6 mt-4">Logging</h3>
            <div class="form-check">
                <input class="form-check-input" type="checkbox" id="ys-debug">
                <label class="form-check-label" for="ys-debug">Debug logging (records each time an area is entered and every command sent)</label>
            </div>
        </div>
    </div>

    <div class="ys-savebar d-flex flex-wrap gap-2 align-items-center mb-3">
        <button type="button" class="btn btn-primary" id="ys-save">Save settings</button>
        <span id="ys-dirty" class="text-warning-emphasis small d-none">Unsaved changes</span>
    </div>

    <!-- Activity -->
    <div class="card mb-3">
        <div class="card-header"><h2 class="h5 mb-0">Recent activity</h2></div>
        <div class="card-body">
            <p class="small text-body-secondary mb-2">Kept in memory only and cleared when FPP restarts.</p>
            <div class="table-responsive">
                <table class="table table-sm mb-0"><tbody id="ys-events"><tr><td class="text-body-secondary">Nothing yet.</td></tr></tbody></table>
            </div>
        </div>
    </div>
</div>
<?php
// Loaded here rather than from js/ and css/ (which FPP auto-loads with no
// version in the URL): the ?v= changes with each update, so a browser can
// never keep running an old copy of the page script against a new page.
foreach (array('yardsecurity.css') as $f) {
    printf("<link rel='stylesheet' href='plugin.php?plugin=fpp-plugin-YardSecurity&amp;file=assets/%s&amp;nopage=1&amp;v=%d'>\n",
        $f, @filemtime(__DIR__ . '/assets/' . $f));
}
foreach (array('yardsecurity.js', 'yardsecurity-tour.js') as $f) {
    printf("<script src='plugin.php?plugin=fpp-plugin-YardSecurity&amp;file=assets/%s&amp;nopage=1&amp;v=%d'></script>\n",
        $f, @filemtime(__DIR__ . '/assets/' . $f));
}
?>
