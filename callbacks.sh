#!/bin/bash
# fppd lifecycle hook: start the Yard Security daemon when fppd (or this
# plugin) starts, stop it when fppd stops or the plugin is unloaded.
# Having this file also lets FPP register commands/descriptions.json live on
# install, without an fppd restart.

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "$1" in
    --list)
        echo "lifecycle"
        exit 0
        ;;
    --type)
        if [ "$2" = "lifecycle" ]; then
            case "$3" in
                startup)  "${PLUGIN_DIR}/scripts/daemon.sh" start ;;
                shutdown) "${PLUGIN_DIR}/scripts/daemon.sh" stop ;;
            esac
        fi
        ;;
esac
exit 0
