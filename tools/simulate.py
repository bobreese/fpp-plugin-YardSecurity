#!/usr/bin/env python3
"""Pretend to be one or more ESP32 + LD2450 sensors, so the plugin can be set
up and tested before the hardware is mounted.

Each fake sensor sends the same MQTT messages the ESPHome config does: a
person walks in from 20 ft, stops at about 6 ft for a few seconds, then walks
back out, over and over.

  python3 simulate.py --host yard-security.local --user yardsecurity yard-sensor-1 yard-sensor-2

The MQTT password is read from the YS_MQTT_PASSWORD environment variable, or
asked for, so it never appears on the command line.
"""

import argparse
import getpass
import json
import math
import os
import sys
import threading
import time

try:
    import paho.mqtt.client as mqtt
except ImportError:
    sys.exit("Needs paho-mqtt: sudo apt-get install python3-paho-mqtt (or pip install paho-mqtt)")

MM_PER_FT = 304.8


def position(t, offset):
    """A 24 s walk: in from 20 ft to 6 ft, wait, back out, gone for a while."""
    cycle = (t + offset) % 24.0
    if cycle < 7:
        y = 20 - 2 * cycle          # walking in
    elif cycle < 11:
        y = 6                       # standing
    elif cycle < 18:
        y = 6 + 2 * (cycle - 11)    # walking out
    else:
        return None                 # nobody there
    x = 2.0 * math.sin(cycle / 2.0)  # a little side to side
    return int(x * MM_PER_FT), int(y * MM_PER_FT)


def login_problem(rc):
    """'' when the broker accepted the login, else a plain explanation.
    paho-mqtt 1.x passes an int; 2.x passes a ReasonCode."""
    code = getattr(rc, "value", rc)
    if code == 0:
        return ""
    if code in (4, 5, 134, 135):  # MQTT 3.1.1 and MQTT 5 "bad user name or password" / "not authorized"
        return ("wrong MQTT user or password (%s).\nUse the user and password from Settings on the Yard Security "
                "page; if you changed the password, press Save settings first." % rc)
    return str(rc)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("devices", nargs="*", default=["yard-sensor-1"])
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=1883)
    p.add_argument("--user", default="yardsecurity")
    p.add_argument("--prefix", default="yardsecurity")
    p.add_argument("--rate", type=float, default=4.0, help="messages per second per sensor")
    p.add_argument("--no-password", action="store_true", help="connect without a password")
    a = p.parse_args()

    try:
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="yardsecurity-sim")
    except AttributeError:
        client = mqtt.Client(client_id="yardsecurity-sim")
    if not a.no_password:
        pw = os.environ.get("YS_MQTT_PASSWORD") or getpass.getpass("MQTT password for %s: " % a.user)
        client.username_pw_set(a.user, pw)
    # The broker answers the login after the connection is made, so wait for
    # that answer before saying anything is being simulated.
    answer = {}
    answered = threading.Event()

    def on_connect(c, userdata, flags, rc, *rest):
        answer["rc"] = rc
        answered.set()

    client.on_connect = on_connect
    try:
        client.connect(a.host, a.port, keepalive=30)
    except OSError as e:
        sys.exit("Could not reach an MQTT broker at %s:%d (%s).\n"
                 "If it is the built-in broker, press 'Turn on' under Settings on the Yard Security page."
                 % (a.host, a.port, e))
    client.loop_start()
    if not answered.wait(10):
        client.loop_stop()
        sys.exit("The MQTT broker at %s:%d did not answer the login." % (a.host, a.port))
    problem = login_problem(answer["rc"])
    if problem:
        client.loop_stop()
        sys.exit("The MQTT broker at %s:%d refused the login: %s" % (a.host, a.port, problem))
    for d in a.devices:
        client.publish("%s/%s/status" % (a.prefix, d), "online", retain=True)
    print("Connected. Simulating %s on %s:%d (Ctrl+C to stop)" % (", ".join(a.devices), a.host, a.port))
    start = time.monotonic()
    try:
        while True:
            t = time.monotonic() - start
            for i, d in enumerate(a.devices):
                pos = position(t, i * 8.0)
                payload = {"c": 1, "t": [list(pos) if pos else None, None, None]}
                client.publish("%s/%s/targets" % (a.prefix, d), json.dumps(payload))
            time.sleep(1.0 / a.rate)
    except KeyboardInterrupt:
        pass
    for d in a.devices:
        client.publish("%s/%s/status" % (a.prefix, d), "offline", retain=True)
    time.sleep(0.3)
    client.loop_stop()


if __name__ == "__main__":
    main()
