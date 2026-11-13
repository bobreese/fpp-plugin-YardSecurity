#!/bin/bash
# Turn the built-in MQTT broker (FPP's preinstalled Mosquitto) on or off for
# the Yard Security sensors. Run as root: from the plugin page (through sudo)
# and from fpp_uninstall.sh. Never run by the installer.
#
#   broker.sh enable    password-protected listener on port 1883 for the LAN
#   broker.sh disable   remove it and put Mosquitto back the way it was
#   broker.sh status    print JSON
#
# Prints one line of JSON: {"ok": true|false, "message": "..."}.

: "${FPPDIR:=/opt/fpp}"
. "${FPPDIR}/scripts/common"
PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${MEDIADIR}/plugindata/fpp-plugin-YardSecurity"
CONF="/etc/mosquitto/conf.d/fpp-plugin-YardSecurity.conf"
PASSWD="/etc/mosquitto/fpp-plugin-YardSecurity.passwd"
MARKER="${DATA_DIR}/broker-was-enabled"
# Present while you want the built-in broker on. It lives in plugindata, which
# survives an FPP OS upgrade; the files in /etc do not, so the page can offer to
# turn the broker back on afterwards. (Never turned back on automatically: a
# plugin may only open a network port when you ask it to.)
WANTED="${DATA_DIR}/broker-wanted"
PLUGIN_LOG="${LOGDIR}/plugin-fpp-plugin-YardSecurity.log"
export MEDIADIR LOGDIR

say() {  # ok message
    local msg="${2//\\/\\\\}"
    msg="${msg//\"/\\\"}"
    echo "{\"ok\": $1, \"message\": \"${msg}\"}"
}
logit() { echo "$(date '+%Y-%m-%d %H:%M:%S') INFO broker: $*" >> "${PLUGIN_LOG}"; }

case "$1" in
    enable)
        if ! command -v mosquitto > /dev/null 2>&1 && [ ! -x /usr/sbin/mosquitto ]; then
            say false "Mosquitto is not installed on this device. Use an external broker instead."
            exit 1
        fi
        other="$(grep -lsE '^[[:space:]]*listener[[:space:]]+1883([[:space:]]|$)' /etc/mosquitto/mosquitto.conf /etc/mosquitto/conf.d/*.conf | grep -v "${CONF}")"
        if [ -n "${other}" ]; then
            say false "Mosquitto already has a port 1883 listener in ${other}. Use it as an external broker instead."
            exit 1
        fi
        line="$(/usr/bin/python3 "${PLUGIN_DIR}/lib/ysctl.py" passwd-line 2>&1)" || { say false "${line}"; exit 1; }
        if [ ! -e "${MARKER}" ]; then
            mkdir -p "${DATA_DIR}"
            if systemctl is-enabled --quiet mosquitto 2>/dev/null; then echo 1 > "${MARKER}"; else echo 0 > "${MARKER}"; fi
        fi
        (umask 077; printf '%s\n' "${line}" > "${PASSWD}")
        chown mosquitto:mosquitto "${PASSWD}" 2>/dev/null
        chmod 0600 "${PASSWD}"
        cat > "${CONF}" <<EOF
# Added by fpp-plugin-YardSecurity for its ESP32 sensors. Removed when the
# built-in broker is turned off on the plugin page, or the plugin is uninstalled.
listener 1883
allow_anonymous false
password_file ${PASSWD}
EOF
        systemctl enable mosquitto > /dev/null 2>&1
        systemctl restart mosquitto > /dev/null 2>&1
        sleep 1
        if systemctl is-active --quiet mosquitto; then
            touch "${WANTED}"
            chown "${FPPUSER:-fpp}:${FPPGROUP:-fpp}" "${WANTED}" 2>/dev/null
            logit "built-in broker enabled on port 1883"
            say true "Built-in broker is on (port 1883, password required)."
        else
            say false "Mosquitto did not start. See: journalctl -u mosquitto"
            exit 1
        fi
        ;;
    disable)
        rm -f "${CONF}" "${PASSWD}"
        was="$(cat "${MARKER}" 2>/dev/null)"
        if [ "${was}" = "1" ]; then
            systemctl restart mosquitto > /dev/null 2>&1 || true
        else
            systemctl disable --now mosquitto > /dev/null 2>&1 || true
        fi
        rm -f "${MARKER}" "${WANTED}"
        logit "built-in broker disabled"
        say true "Built-in broker is off."
        ;;
    status)
        configured=false; active=false; wanted=false
        [ -f "${CONF}" ] && configured=true
        [ -f "${WANTED}" ] && wanted=true
        systemctl is-active --quiet mosquitto 2>/dev/null && active=true
        echo "{\"ok\": true, \"configured\": ${configured}, \"active\": ${active}, \"wanted\": ${wanted}}"
        ;;
    *)
        echo "usage: $0 enable|disable|status"
        exit 2
        ;;
esac
exit 0
