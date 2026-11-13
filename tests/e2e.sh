#!/bin/bash
# End-to-end check on a development machine (not on FPP):
# a throwaway Mosquitto, a fake show player, the daemon, and the simulator.
#   needs: mosquitto, python3 with paho-mqtt
set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
PORT=18831
FPPPORT=18832
trap 'kill $(jobs -p) 2>/dev/null; rm -rf "$WORK"' EXIT

printf 'listener %s 127.0.0.1\nallow_anonymous true\n' "$PORT" > "$WORK/m.conf"
mosquitto -c "$WORK/m.conf" > "$WORK/mosq.log" 2>&1 &
python3 "$HERE/tests/mock_fpp.py" "$FPPPORT" "$WORK/commands.log" > /dev/null 2>&1 &
sleep 1

export MEDIADIR="$WORK/media" LOGDIR="$WORK/media/logs"
mkdir -p "$MEDIADIR/plugindata/fpp-plugin-YardSecurity" "$MEDIADIR/config"
cat > "$MEDIADIR/config/plugin.fpp-plugin-YardSecurity.json" <<EOF
{
  "enabled": true, "logLevel": "debug",
  "show": {"host": "127.0.0.1:$FPPPORT"},
  "arming": {"mode": "afterShow", "graceMinutes": 0},
  "mqtt": {"mode": "external", "host": "127.0.0.1", "port": $PORT, "username": ""},
  "areas": [
    {"name": "Driveway", "sensor": "yard-sensor-1", "maxFt": 10, "holdSec": 2, "cooldownSec": 0,
     "onEnter": {"type": "preset", "preset": "Driveway On"},
     "onExit": {"type": "preset", "preset": "Driveway Off"}},
    {"name": "Side Gate", "sensor": "yard-sensor-2", "maxFt": 10, "holdSec": 2, "cooldownSec": 0,
     "onEnter": {"type": "command", "command": "Overlay Model Fill", "args": ["Gate", "Enabled", "#FFFFFF"]},
     "onExit": {"type": "command", "command": "Overlay Model State", "args": ["Gate", "Disabled"]}}
  ]
}
EOF

python3 "$HERE/lib/yardsecd.py" &
python3 "$HERE/tools/simulate.py" --no-password --port $PORT --rate 5 yard-sensor-1 yard-sensor-2 > /dev/null &
sleep 30

python3 "$HERE/lib/ysctl.py" status > "$WORK/status.json"
python3 "$HERE/lib/ysctl.py" test Driveway enter
sleep 1
kill %3 %4 2>/dev/null
sleep 3

echo "--- commands the fake show player received:"
cat "$WORK/commands.log"
echo "--- daemon log:"
cat "$LOGDIR/plugin-fpp-plugin-YardSecurity.log"
echo "--- status:"
head -c 1500 "$WORK/status.json"; echo

fail=0
grep -q '"Trigger Command Preset" \["Driveway On"\]' "$WORK/commands.log" || { echo "FAIL: no Driveway On"; fail=1; }
grep -q '"Trigger Command Preset" \["Driveway Off"\]' "$WORK/commands.log" || { echo "FAIL: no Driveway Off"; fail=1; }
grep -q '"Overlay Model Fill" \["Gate", "Enabled", "#FFFFFF"\]' "$WORK/commands.log" || { echo "FAIL: no Gate fill"; fail=1; }
grep -q '"Overlay Model State" \["Gate", "Disabled"\]' "$WORK/commands.log" || { echo "FAIL: no Gate off"; fail=1; }
grep -q '"armed": true' "$WORK/status.json" || { echo "FAIL: not armed"; fail=1; }
[ $fail = 0 ] && echo "E2E PASS"
exit $fail
