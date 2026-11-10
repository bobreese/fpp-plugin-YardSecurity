#!/bin/bash
# fpp-plugin-YardSecurity uninstall script. Safe to run more than once.
. "${FPPDIR}/scripts/common"
PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Stop the daemon (it turns off any area it lit on the way out).
"${PLUGIN_DIR}/scripts/daemon.sh" stop > /dev/null 2>&1 || true

if [ "${FPP_PLUGIN_REINSTALL:-0}" != "1" ]; then
    # Undo the built-in broker if it was turned on, and put Mosquitto back
    # the way it was. (A Reinstall keeps it, along with the settings below.)
    if [ -f /etc/mosquitto/conf.d/fpp-plugin-YardSecurity.conf ]; then
        "${PLUGIN_DIR}/scripts/broker.sh" disable > /dev/null 2>&1 || true
    fi
    rm -f /etc/mosquitto/conf.d/fpp-plugin-YardSecurity.conf /etc/mosquitto/fpp-plugin-YardSecurity.passwd
fi

# Keep areas and passwords across a Reinstall (FPP 10.4+), delete them otherwise.
if [ "${FPP_PLUGIN_REINSTALL:-0}" != "1" ]; then
    rm -rf "${MEDIADIR}/plugindata/fpp-plugin-YardSecurity"
fi
exit 0
