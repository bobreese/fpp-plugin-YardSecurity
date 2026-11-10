#!/usr/bin/env python3
"""A fake FPP show player for tests/e2e.sh: answers /api/fppd/status and
/api/commandPresets, and logs every POST /api/command/<name> it receives."""

import json
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(sys.argv[1])
LOG = sys.argv[2]


class H(BaseHTTPRequestHandler):
    def _json(self, obj):
        body = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/api/fppd/status"):
            self._json({"status_name": "idle"})
        elif self.path.startswith("/api/commandPresets"):
            self._json(["Driveway On", "Driveway Off"])
        else:
            self.send_error(404)

    def do_POST(self):
        if not self.path.startswith("/api/command/"):
            self.send_error(404)
            return
        name = urllib.parse.unquote(self.path[len("/api/command/"):])
        args = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"[]")
        with open(LOG, "a") as f:
            f.write("%s %s\n" % (json.dumps(name), json.dumps(args)))
        self._json({"status": "OK"})

    def log_message(self, *a):
        pass


HTTPServer(("127.0.0.1", PORT), H).serve_forever()
