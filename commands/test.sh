#!/bin/bash
# FPP command "Yard Security - Test Area": $1 is the area name.
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec /usr/bin/python3 "${DIR}/lib/ysctl.py" test "$1" both
