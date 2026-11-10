#!/bin/bash
# FPP command "Yard Security - Arm" (also usable from the FPP scheduler).
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec /usr/bin/python3 "${DIR}/lib/ysctl.py" arm
