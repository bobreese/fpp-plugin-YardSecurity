#!/usr/bin/env python3
"""Small client for the Yard Security daemon's control socket.

  ysctl.py status                 print the daemon's status as JSON
  ysctl.py arm | disarm | auto    set or clear the arm override
  ysctl.py test <area> [enter|exit|both]
  ysctl.py reload
  ysctl.py passwd-line            print a Mosquitto password-file line for the
                                  configured MQTT user (used by broker.sh)
"""

import base64
import hashlib
import json
import os
import socket
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ys_common as C  # noqa: E402


def request(req, timeout=3.0):
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect(C.SOCKET_FILE)
        s.sendall((json.dumps(req) + "\n").encode())
        buf = b""
        while b"\n" not in buf:
            chunk = s.recv(65536)
            if not chunk:
                break
            buf += chunk
        return json.loads(buf.decode() or "{}")
    finally:
        s.close()


def passwd_line():
    """Mosquitto 2 PBKDF2-SHA512 entry: user:$7$<iter>$<b64 salt>$<b64 hash>."""
    cfg = C.load_config()
    user = cfg["mqtt"]["username"]
    pw = C.load_secrets().get("mqttPassword", "")
    if not user or not pw or ":" in user:
        raise SystemExit("Set an MQTT username and password on the plugin page first")
    salt = os.urandom(12)
    iterations = 101
    dk = hashlib.pbkdf2_hmac("sha512", pw.encode(), salt, iterations, 64)
    return "%s:$7$%d$%s$%s" % (user, iterations, base64.b64encode(salt).decode(), base64.b64encode(dk).decode())


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    cmd = argv[0]
    if cmd == "passwd-line":
        print(passwd_line())
        return 0
    req = {"cmd": cmd}
    if cmd == "test":
        if len(argv) < 2:
            print("usage: ysctl.py test <area> [enter|exit|both]")
            return 2
        req["area"] = argv[1]
        req["phase"] = argv[2] if len(argv) > 2 else "both"
    try:
        resp = request(req)
    except OSError as e:
        print("Yard Security daemon is not running (%s)" % e, file=sys.stderr)
        return 1
    print(json.dumps(resp, indent=2) if cmd == "status" else (resp.get("error") or "ok"))
    return 0 if resp.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
