# Yard Security for FPP

Turns on show lights when someone walks into an area of your yard.

Each area is watched by an **ESP32 + HLK-LD2450 radar**. The ESP32 sends what the radar sees over Wi-Fi (MQTT)
to the FPP running this plugin (for example a spare Pi 3 named `Yard-Security`). When a person comes within an
area's trigger distance, the plugin tells your **show player** to run a command, usually a Command Preset such
as "Driveway On", and runs the matching "off" command once the area has been clear for the hold time.

```
ESP32 + LD2450  ──Wi-Fi/MQTT──►  Yard-Security (FPP + this plugin)  ──FPP command API──►  show player ──► lights
```

- Areas with your own names, each with a trigger distance (e.g. 10 or 15 ft), optional "ignore closer than" and
  left/right limits, an enter delay, a hold time and a cooldown.
- Actions are Command Presets from the show player (picked from a list) or any FPP command with arguments.
- Arming: **after the show is over** (automatic), **by the FPP Scheduler** (Arm / Disarm commands), or **always**.
- Live radar view per sensor, with the areas drawn on it, for tuning distances while someone walks the yard.
- FPP commands: `Yard Security - Arm`, `- Disarm`, `- Automatic`, `- Test Area` (usable in the Scheduler and playlists).
- Optional built-in MQTT broker (FPP's preinstalled Mosquitto, password protected) turned on from the page.
- A first-install walkthrough with live checks, replayable from a button.

Requires FPP 10 or newer on the sensor box. The show player can be any FPP version with the command API.

## Hardware (per area)

| Part | Notes |
|---|---|
| ESP32-WROOM-32 DevKit, 38-pin (USB-C) | Use the **32U** (external antenna) where Wi-Fi is weak |
| HLK-LD2450 radar | Buy with its cable |
| Plastic weatherproof box | The radar sees through thin plastic, never metal |
| 5V 1A USB power supply | |

Wiring (the LD2450 data pins are 3.3V, so they connect straight to the ESP32):

| LD2450 | ESP32 |
|---|---|
| 5V | 5V (VIN) |
| GND | GND |
| TX | GPIO16 (RX2) |
| RX | GPIO17 (TX2) |

Mount about 3-5 ft high, facing level across the area, with the radar board upright. Point sensors away from
each other so their fans overlap as little as possible (they all use 24 GHz).

## Setup

The first time you open **Status/Control → Yard Security**, a step-by-step **walkthrough** opens at the bottom of
the page. It points at each part of the page in turn and shows a live check (✓) as each step is done: show player
reached, password saved, broker on, sensors reporting, areas saved, test command accepted. Replay it any time with
the **Walkthrough** button at the top of the page, or from **Help → Yard Security - Help**. The steps below are the
same, for reference.

### 1. Show player
Make two Command Presets per area (Content Setup → Command Presets), for example:

- `Driveway On`: `Overlay Model Fill` → model `Driveway Arch`, state `Enabled`, a colour
- `Driveway Off`: `Overlay Model State` → model `Driveway Arch`, `Disabled`

(Or a preset that starts a short playlist.) Test them from the show player first.

### 2. Yard-Security FPP
1. Set the hostname to `Yard-Security` (FPP only allows letters, numbers and hyphens; an underscore is removed).
2. Install this plugin (Plugin Manager → install from `https://github.com/bobreese/fpp-plugin-YardSecurity`).
3. Open **Status/Control → Yard Security**:
   - Settings: the show player's address; MQTT password (press **New**), **Save settings**.
   - Built-in broker: **Turn on**.

### 3. ESP32 sensors (ESPHome)
The files are in [`esphome/`](esphome/): `yard-sensor-1.yaml`, `-2`, `-3` and the shared
`common/yardsecurity-ld2450.yaml`. Needs a current ESPHome (2026.x).

1. Copy `secrets.yaml.example` to `secrets.yaml` and fill in Wi-Fi, and the same MQTT user and password as the
   plugin page. `mqtt_broker` is the Yard-Security FPP's IP address.
2. Plug an ESP32 into your computer by USB and run `esphome run yard-sensor-1.yaml` (later updates go over Wi-Fi).
3. Open `http://yard-sensor-1.local` and turn **Radar Bluetooth** off.
4. Repeat for 2 and 3.

The sensors appear on the plugin page within a few seconds, with a live radar view.

### 4. Areas
**Add area** for each sensor: name, sensor, trigger distance, and the On / Off presets. **Save settings**, then
**Test enter** / **Test exit**. Walk the area and adjust the distance and side limits on the live view.

### 5. Turn it on
Switch **Yard Security is on**, choose when it is armed, and save.

For **FPP Scheduler** mode, add schedule entries on the Yard-Security FPP (Content Setup → Scheduler, type
*Command*): `Yard Security - Arm` at your start time and `Yard Security - Disarm` at your end time.

## How the timing works

- **Must be there for** (default 300 ms): a person has to be inside the area this long before it triggers.
- **Stay lit after they leave** (default 5 s): the exit command is sent once the area has been empty this long.
- **Then wait before relighting** (cooldown, default 30 s): after an area lights, it won't light again until this
  has passed. If someone enters during the cooldown, nothing is sent for them.
- Disarming (button, command, schedule, or a show starting) sends the exit command for every lit area.
- When fppd stops, the plugin sends the exit command for every lit area.

## Testing without hardware

### Simulate button (easiest)
Press **Simulate** on the Yard Security page, choose how long (2-30 minutes), and **Start simulation**. A pretend
person walks into every area and back out, again and again: one pretend sensor for each sensor your areas use,
shown as **simulated** in the live view.

- Nothing else is needed: no ESP32s, MQTT broker, password or arming, and it works while Yard Security is
  switched off. The arming mode is ignored while it runs.
- An area with an empty **Sensor** box is given the next free name (`yard-sensor-1`, `-2`, ...), the names the
  ESPHome files use, and saved.
- The walk is sized to each area: it crosses the trigger distance, stops inside the area (and its side limits),
  and stays away long enough for the hold time and cooldown, so every walk-in lights the area.
- **Send the areas' commands to the show player** (on by default) turns your real lights on and off. Untick it to
  watch the areas go LIT on the page only; then nothing at all is sent, not even an "off" at the end.
- It stops by itself when the time is up, with **Stop simulation**, or when fppd stops; lit areas are turned off.
  Real sensor data for the same names is ignored while it runs.

### Simulator script (tests the MQTT path too)

`tools/simulate.py` pretends to be sensors (a person walking in and out every 24 s):

```bash
YS_MQTT_PASSWORD='the-password' python3 tools/simulate.py --host Yard-Security.local yard-sensor-1 yard-sensor-2
```

It waits for the broker to accept its login: a wrong password or a broker that is off stops it with a message
saying which. While it runs, the sensors appear under **Sensors (live)** once Yard Security is switched on (the
page says so if it is off or not connected to the broker).

Developers: `python3 -m unittest discover tests` (logic) and `tests/e2e.sh` (Mosquitto + fake show player +
daemon + simulator; needs `mosquitto` and `python3-paho-mqtt`).

## Files on the device

- Settings (areas, arming, show player address, MQTT user): `/home/fpp/media/config/plugin.fpp-plugin-YardSecurity.json`.
  Being in FPP's config folder, it is included in FPP's settings backup (Content Setup → File Manager → Backup /
  JSON backups) and comes back with a restore.
- Passwords (show player and MQTT): `/home/fpp/media/plugindata/fpp-plugin-YardSecurity/secrets.json`, mode 0600.
  Not in FPP's backup, as FPP's plugin rules require; after restoring onto a new card, enter them again.
- Also in that `plugindata` folder: `walkthrough.json` (walkthrough finished), `broker-wanted` (you turned the
  built-in broker on), `state.json` (Arm/Disarm override).
- Log: `/home/fpp/media/logs/plugin-fpp-plugin-YardSecurity.log` (FPP rotates it). Debug logging is off by default.
- Built-in broker (only while turned on): `/etc/mosquitto/conf.d/fpp-plugin-YardSecurity.conf` and
  `/etc/mosquitto/fpp-plugin-YardSecurity.passwd`. Turning it off, or uninstalling, removes both and puts
  Mosquitto back the way it was.

Versions before the move kept settings in `plugindata/fpp-plugin-YardSecurity/config.json`; updating the plugin
moves them to the config folder automatically.

## Turning the broker on from the command line

`tools/broker-on.sh` does the same as **Turn on** on the page, over SSH (user `fpp`):

```bash
sudo /home/fpp/media/plugins/fpp-plugin-YardSecurity/tools/broker-on.sh
```

It makes and saves an MQTT password if none is saved yet, turns on the built-in broker (port 1883, password
required), checks the broker accepts that user and password, and prints the `mqtt_broker`, `mqtt_username` and
`mqtt_password` lines for the ESPHome `secrets.yaml`. A password that was already saved is left unchanged and only
printed with `--show-password`. If the page is set to "A broker I already run", it stops; `--builtin` switches it
to the built-in broker. Safe to run again at any time, for example after an FPP OS upgrade.

## Updates, OS upgrades and backups

| | Settings | Passwords | Built-in broker |
|---|---|---|---|
| FPP update | kept | kept | kept |
| Plugin update | kept | kept | kept |
| FPP OS upgrade | kept | kept | **off**: the page shows a banner with **Turn it back on** |
| New SD card + FPP backup restore | **restored** | re-enter | turn on again |

After an FPP OS upgrade, press **Reinstall All** when FPP asks (it reinstalls the MQTT library the plugin uses),
then **Turn it back on** on the Yard Security page (or run `tools/broker-on.sh`). The sensors reconnect with the same password, so the ESP32s
need no changes. FPP's plugin rules do not let a plugin reopen a network port on its own, so this takes a click.

## Privacy

Radar readings are used as they arrive and are not stored. The page's recent-activity list is kept in memory
only. With debug logging on, the plugin log records when each area is entered. The plugin sends nothing except
commands and status checks to the show player you set.

## License

GPL-2.0, see [LICENSE](LICENSE).
