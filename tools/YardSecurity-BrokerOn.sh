#!/bin/bash
# Yard Security: make sure the built-in MQTT broker is on whenever FPP starts,
# for example after an FPP OS upgrade removed its settings.
#
# Setup, all in FPP's web pages:
#   1. Content Setup -> File Manager -> Scripts: upload this file.
#   2. Content Setup -> Command Presets: add a preset named FPPD_STARTED (FPP
#      runs it every time fppd starts) with the command "Run Script" and
#      Script Name YardSecurity-BrokerOn.sh. Leave the arguments empty. Save.
#
# This file only starts the plugin's own tools/broker-on.sh --boot, so plugin
# updates keep it current. That turns the broker on only if it is off, a
# sensor (MQTT) password is saved on the Yard Security page, the page uses the
# built-in broker, and you have not turned the broker off on the page. It never
# makes, changes or prints a password, and never restarts a running broker.
# What it did is in the plugin log (Help -> Logs ->
# plugin-fpp-plugin-YardSecurity.log); nothing is written when there was
# nothing to do.

: "${FPPDIR:=/opt/fpp}"
[ -f "${FPPDIR}/scripts/common" ] && . "${FPPDIR}/scripts/common"
BROKER_ON="${MEDIADIR:-/home/fpp/media}/plugins/fpp-plugin-YardSecurity/tools/broker-on.sh"

if [ ! -f "${BROKER_ON}" ]; then
    echo "Yard Security plugin is not installed (${BROKER_ON} is missing)."
    exit 0
fi
exec /bin/bash "${BROKER_ON}" --boot
