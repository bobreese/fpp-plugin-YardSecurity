#!/bin/bash
# Turn on Yard Security's built-in MQTT broker from the command line: the same
# as "Turn on" (or "Turn it back on") on the plugin page.
#
#   sudo /home/fpp/media/plugins/fpp-plugin-YardSecurity/tools/broker-on.sh
#
# Steps:
#   1. If no MQTT password is saved yet, makes one and saves it (like "New" +
#      "Save settings" on the page).
#   2. Turns on FPP's Mosquitto broker on port 1883, password required.
#   3. Checks the broker is running and accepts the saved user and password.
#   4. Prints what goes in the ESPHome secrets.yaml.
#
# Options:
#   --show-password   also print a password that was already saved (a new one
#                     is always printed, since you need it for ESPHome)
#   --builtin         if the page is set to "A broker I already run", switch
#                     it back to the built-in broker

set -u
SHOW_PASSWORD=0
FORCE_BUILTIN=0
for arg in "$@"; do
    case "${arg}" in
        --show-password) SHOW_PASSWORD=1 ;;
        --builtin) FORCE_BUILTIN=1 ;;
        -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "Unknown option: ${arg} (try --help)"; exit 2 ;;
    esac
done

# The broker setup changes files under /etc, so it needs root.
if [ "$(id -u)" != "0" ]; then
    exec sudo "$0" "$@"
fi

: "${FPPDIR:=/opt/fpp}"
if [ ! -f "${FPPDIR}/scripts/common" ]; then
    echo "This is not an FPP device (${FPPDIR}/scripts/common is missing)."
    exit 1
fi
. "${FPPDIR}/scripts/common"
export MEDIADIR LOGDIR
PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${MEDIADIR}/plugindata/fpp-plugin-YardSecurity"
OWNER="${FPPUSER:-fpp}:${FPPGROUP:-fpp}"

mkdir -p "${DATA_DIR}"
chown "${OWNER}" "${DATA_DIR}" 2>/dev/null

# Step 1: settings and password. Reads and writes the same files as the page,
# with the same ownership and modes (settings 0644, passwords 0600).
STEP1="$(/usr/bin/python3 -I - "${PLUGIN_DIR}/lib" "${FORCE_BUILTIN}" <<'PY'
import json, os, secrets, string, sys
sys.path.insert(0, sys.argv[1])
import ys_common as C
force_builtin = sys.argv[2] == "1"

raw = {}
for path in (C.CONFIG_FILE, C.LEGACY_CONFIG_FILE):
    if os.path.exists(path):
        try:
            with open(path) as f:
                raw = json.load(f)
        except (OSError, ValueError):
            raw = {}
        break
cfg = C.normalize_config(raw)
mqtt = raw.setdefault("mqtt", {}) if isinstance(raw, dict) else {}
out = {"configChanged": False, "generated": False}

if cfg["mqtt"]["mode"] == "external":
    if not force_builtin:
        print(json.dumps({"error": "external"}))
        sys.exit(0)
    mqtt["mode"] = "builtin"
    out["configChanged"] = True
if not mqtt.get("username"):
    mqtt["username"] = cfg["mqtt"]["username"]  # the default, "yardsecurity"
    out["configChanged"] = True
if out["configChanged"]:
    C.write_json_atomic(C.CONFIG_FILE, raw, 0o644)
    if os.path.exists(C.LEGACY_CONFIG_FILE):
        os.unlink(C.LEGACY_CONFIG_FILE)
    out["configFile"] = C.CONFIG_FILE

sec = C.load_secrets()
if not sec.get("mqttPassword"):
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"
    sec["mqttPassword"] = "".join(secrets.choice(alphabet) for _ in range(20))
    C.write_json_atomic(C.SECRETS_FILE, sec, 0o600)
    out["generated"] = True
out["secretsFile"] = C.SECRETS_FILE
out["username"] = mqtt["username"]
out["password"] = sec["mqttPassword"]
out["prefix"] = cfg["mqtt"]["topicPrefix"]
print(json.dumps(out))
PY
)"
if [ -z "${STEP1}" ]; then
    echo "Could not read or save the Yard Security settings in ${MEDIADIR}."
    exit 1
fi
field() { /usr/bin/python3 -I -c 'import json,sys; v=json.loads(sys.argv[1]).get(sys.argv[2], ""); print(str(v).lower() if isinstance(v, bool) else v)' "${STEP1}" "$1"; }

if [ "$(field error)" = "external" ]; then
    echo "The Yard Security page is set to use \"A broker I already run\", so the built-in broker is not used."
    echo "Run this again with --builtin to switch to the built-in broker and turn it on."
    exit 1
fi
USERNAME="$(field username)"
PASSWORD="$(field password)"
PREFIX="$(field prefix)"
GENERATED="$(field generated)"
# The files Python wrote as root belong to the web page's user, as when the page writes them.
for f in "$(field configFile)" "$(field secretsFile)"; do
    [ -n "${f}" ] && [ -f "${f}" ] && chown "${OWNER}" "${f}" 2>/dev/null
done
if [ "${GENERATED}" = "true" ]; then
    echo "No MQTT password was saved yet: made and saved a new one."
fi

# Step 2: turn the broker on.
RESULT="$("${PLUGIN_DIR}/scripts/broker.sh" enable)"
OK="$(/usr/bin/python3 -I -c 'import json,sys; d=json.loads(sys.argv[1]); print("yes" if d.get("ok") else d.get("message", "failed"))' "${RESULT}" 2>/dev/null)"
if [ "${OK}" != "yes" ]; then
    echo "Could not turn on the broker: ${OK:-${RESULT}}"
    exit 1
fi
echo "Built-in broker is on: port 1883, password required."

# Step 3: log in with the saved user and password, as an ESP32 would.
# The password goes in the environment, never on a command line (where any
# process on the device could read it).
CHECK="$(YS_PW="${PASSWORD}" /usr/bin/python3 -I - "${USERNAME}" <<'PY' 2>&1
import os, sys, threading
try:
    import paho.mqtt.client as mqtt
except ImportError:
    print("skipped: python3-paho-mqtt is not installed (reinstall the plugin)")
    sys.exit(0)
answer, done = {}, threading.Event()
try:
    c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="yardsecurity-check")
except AttributeError:
    c = mqtt.Client(client_id="yardsecurity-check")
c.username_pw_set(sys.argv[1], os.environ["YS_PW"])
c.on_connect = lambda cl, u, f, rc, *a: (answer.setdefault("rc", rc), done.set())
try:
    c.connect("127.0.0.1", 1883, keepalive=10)
except OSError as e:
    print("failed: could not reach the broker (%s)" % e)
    sys.exit(0)
c.loop_start()
ok = done.wait(5)
c.disconnect()
c.loop_stop()
rc = answer.get("rc")
code = getattr(rc, "value", rc)
print("ok" if ok and code == 0 else "failed: %s" % (rc if ok else "no answer"))
PY
)"
case "${CHECK}" in
    ok) echo "Checked: the broker accepts user '${USERNAME}' with the saved password." ;;
    skipped*) echo "Login check ${CHECK}" ;;
    *) echo "Login check ${CHECK}"; exit 1 ;;
esac

# Step 4: what the ESP32s need.
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
echo "For the ESPHome secrets.yaml:"
echo "  mqtt_broker: \"${IP:-$(hostname)}\""
echo "  mqtt_username: \"${USERNAME}\""
if [ "${GENERATED}" = "true" ] || [ "${SHOW_PASSWORD}" = "1" ]; then
    echo "  mqtt_password: \"${PASSWORD}\""
else
    echo "  mqtt_password: the password saved on the Yard Security page (run with --show-password to print it)"
fi
echo "Topic prefix: ${PREFIX} (the ESPHome files' topic_prefix must match)."
echo
echo "The Yard Security page shows the broker as on; sensors appear under Sensors (live)"
echo "once Yard Security is switched on there."
exit 0
