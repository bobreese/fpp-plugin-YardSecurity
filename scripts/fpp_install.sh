#!/bin/bash
# fpp-plugin-YardSecurity install script. Safe to run more than once.
# python3-paho-mqtt is declared in pluginInfo.json "dependencies" and is
# installed by FPP before this runs. Nothing here changes the network: the
# built-in MQTT broker is only turned on from the plugin page.

. "${FPPDIR}/scripts/common"
PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${MEDIADIR}/plugindata/fpp-plugin-YardSecurity"

mkdir -p "${DATA_DIR}"
chown "${FPPUSER:-fpp}:${FPPGROUP:-fpp}" "${DATA_DIR}"
chmod 0750 "${DATA_DIR}"
chmod +x "${PLUGIN_DIR}"/callbacks.sh "${PLUGIN_DIR}"/scripts/*.sh "${PLUGIN_DIR}"/commands/*.sh "${PLUGIN_DIR}"/lib/*.py

# An update replaces the daemon's code; restart it if it is running.
if "${PLUGIN_DIR}/scripts/daemon.sh" status > /dev/null 2>&1; then
    "${PLUGIN_DIR}/scripts/daemon.sh" restart
fi
exit 0
