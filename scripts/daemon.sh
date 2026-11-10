#!/bin/bash
# Start / stop the Yard Security daemon. Called from callbacks.sh (fppd
# lifecycle) and fpp_uninstall.sh. Returns quickly: the daemon is backgrounded.

: "${FPPDIR:=/opt/fpp}"
. "${FPPDIR}/scripts/common"
PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${MEDIADIR}/plugindata/fpp-plugin-YardSecurity"
PID_FILE="${DATA_DIR}/daemon.pid"
PLUGIN_LOG="${LOGDIR}/plugin-fpp-plugin-YardSecurity.log"
export MEDIADIR LOGDIR

running_pid() {
    local pid
    pid="$(cat "${PID_FILE}" 2>/dev/null)"
    if [ -n "${pid}" ] && kill -0 "${pid}" 2>/dev/null && grep -q yardsecd "/proc/${pid}/cmdline" 2>/dev/null; then
        echo "${pid}"
    fi
}

case "$1" in
    start)
        if [ -n "$(running_pid)" ]; then
            exit 0
        fi
        mkdir -p "${DATA_DIR}"
        # The web page (running as the fpp user) saves settings here.
        chown "${FPPUSER:-fpp}:${FPPGROUP:-fpp}" "${DATA_DIR}" 2>/dev/null
        # The daemon writes its own log (and reopens it when FPP rotates it).
        echo "$(date '+%Y-%m-%d %H:%M:%S') Starting daemon" >> "${PLUGIN_LOG}"
        setsid nohup /usr/bin/python3 "${PLUGIN_DIR}/lib/yardsecd.py" > /dev/null 2>&1 < /dev/null &
        ;;
    stop)
        pid="$(running_pid)"
        [ -z "${pid}" ] && exit 0
        kill -TERM "${pid}" 2>/dev/null
        # The daemon sends "lights off" for any area it lit before it exits.
        for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
            kill -0 "${pid}" 2>/dev/null || exit 0
            sleep 0.2
        done
        kill -KILL "${pid}" 2>/dev/null
        ;;
    restart)
        "$0" stop
        "$0" start
        ;;
    status)
        pid="$(running_pid)"
        if [ -n "${pid}" ]; then echo "running ${pid}"; else echo "stopped"; exit 1; fi
        ;;
    *)
        echo "usage: $0 start|stop|restart|status"
        exit 2
        ;;
esac
exit 0
