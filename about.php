<div class="mt-2">
    <div class="card mb-3">
        <div class="card-header"><h2 class="h5 mb-0">Yard Security help</h2></div>
        <div class="card-body">
            <p>Yard Security turns on show lights when someone walks into an area of your yard. Each area is watched by an
            ESP32 with an HLK-LD2450 radar, which reports over Wi-Fi (MQTT) to this FPP. When a person comes within the
            area's trigger distance, this FPP tells your show player to run a command, usually a Command Preset such as
            "Driveway On", and runs the exit command once the area has been clear for the hold time.</p>

            <p>
                <a class="btn btn-primary" href="plugin.php?plugin=fpp-plugin-YardSecurity&amp;page=status.php&amp;tour=1">Start the setup walkthrough</a>
            </p>
            <p class="small text-body-secondary">The walkthrough opens by itself the first time you visit the Yard Security page.
            You can replay it any time with the <b>Walkthrough</b> button at the top of that page.</p>

            <h3 class="h6">Setup, in order</h3>
            <ol>
                <li>On the <b>show player</b>, make a Command Preset for each area turning on and one turning off
                    (Content Setup &rarr; Command Presets), e.g. with <i>Overlay Model Fill</i> and <i>Overlay Model State</i>.</li>
                <li>On this page's <b>Settings</b>: enter the show player's address, pick an MQTT password (<b>New</b>), and
                    press <b>Save settings</b>.</li>
                <li>Press <b>Turn on</b> for the built-in broker (or choose your own broker).</li>
                <li>Flash the ESP32s with the ESPHome files in the plugin's <code>esphome/</code> folder, using the same
                    MQTT user and password, and this device's address as <code>mqtt_broker</code>.</li>
                <li>Add an area per sensor, set the trigger distance, choose the presets, save, and use <b>Test enter</b>.</li>
                <li>Turn <b>Yard Security is on</b> on, choose when it is armed, and save.</li>
            </ol>

            <h3 class="h6">Trying it without sensors</h3>
            <p>Press <b>Simulate</b> on the Yard Security page: a pretend person walks into each area and back out, so you
            can watch the live view and the areas light, with or without sending the commands to your show player. It
            needs no ESP32s, broker or arming, and stops by itself after the time you choose.</p>

            <h3 class="h6">Arming</h3>
            <ul>
                <li><b>After the show is over</b>: armed whenever the show player is idle or switched off, after the wait you set.</li>
                <li><b>FPP Scheduler</b>: add the <i>Yard Security - Arm</i> and <i>Yard Security - Disarm</i> commands to this
                    device's Scheduler (Content Setup &rarr; Scheduler, type Command).</li>
                <li><b>Always</b>.</li>
            </ul>
            <p>The <i>Arm</i>, <i>Disarm</i> and <i>Automatic</i> commands and buttons override the mode until <i>Automatic</i>.
            Disarming turns off any area that is lit. <i>Yard Security - Test Area</i> can be used in playlists too.</p>

            <h3 class="h6">Privacy</h3>
            <p>Radar readings are used as they arrive and are not stored. The recent-activity list is kept in memory only.
            With debug logging on, the plugin log records when each area is entered. Nothing is sent anywhere except the
            commands to the show player you set.</p>
        </div>
    </div>

    <div class="card mb-3">
        <div class="card-header"><h2 class="h5 mb-0">About</h2></div>
        <div class="card-body">
            <p class="mb-1"><b>Yard Security</b> by bobreese</p>
            <a href="https://github.com/bobreese/fpp-plugin-YardSecurity">Git repository</a> &middot;
            <a href="https://github.com/bobreese/fpp-plugin-YardSecurity/issues">Report a bug</a>
        </div>
    </div>
</div>
