#!/usr/bin/env python3
"""Yard Security daemon for FPP.

Reads LD2450 radar targets that the ESP32 sensors publish over MQTT, decides
when someone is inside an area, and sends FPP commands to the show player.

It is started by callbacks.sh when fppd starts and stopped when fppd stops,
but does nothing (no MQTT connection, no commands) until the plugin is
enabled on its page.
"""

import base64
import collections
import json
import logging
import logging.handlers
import math
import os
import queue
import signal
import socket
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ys_common as C  # noqa: E402

try:
    import paho.mqtt.client as mqtt
except ImportError:  # reported in status; the rest of the daemon still runs
    mqtt = None

log = logging.getLogger("yardsecurity")

STALE_SEC = 2.0          # targets older than this are ignored
SHOW_POLL_SEC = 10.0     # how often to ask the show player if it is playing
TICK_SEC = 0.1


# --------------------------------------------------------------------------
# Pure logic (unit tested in tests/test_logic.py)
# --------------------------------------------------------------------------

def target_in_area(area, x_mm, y_mm):
    """True if one LD2450 target (x across, y out from the sensor, in mm) is
    inside the area. Distance is measured straight-line from the sensor."""
    if y_mm is None or x_mm is None:
        return False
    dist_ft = math.hypot(x_mm, y_mm) / C.MM_PER_FT
    if dist_ft < area["minFt"] or dist_ft > area["maxFt"]:
        return False
    x_ft = x_mm / C.MM_PER_FT
    if area["leftFt"] > 0 and x_ft < -area["leftFt"]:
        return False
    if area["rightFt"] > 0 and x_ft > area["rightFt"]:
        return False
    return True


class AreaTracker:
    """Turns 'someone is in the zone right now' samples into enter/exit
    events, with an enter delay, a hold time and a cooldown.

    fired is True while an enter action has been sent and its exit action
    has not, so lights turned on are always turned off again."""

    def __init__(self):
        self.occupied = False
        self.fired = False
        self.raw_since = None
        self.last_seen = None
        self.last_enter_fire = None
        self.last_enter = None
        self.last_exit = None

    def update(self, area, now, present, armed):
        events = []
        if present:
            self.last_seen = now
            if not self.occupied:
                if self.raw_since is None:
                    self.raw_since = now
                if (now - self.raw_since) * 1000.0 >= area["enterMs"]:
                    self.occupied = True
                    self.last_enter = now
                    events.append("occupied")
        else:
            self.raw_since = None
            if self.occupied and (now - (self.last_seen or now)) >= area["holdSec"]:
                self.occupied = False
                self.last_exit = now
                events.append("clear")

        actions = []
        if armed and self.occupied and not self.fired and self.cooldown_left(area, now) <= 0:
            self.fired = True
            self.last_enter_fire = now
            actions.append("enter")
        elif self.fired and (not self.occupied or not armed):
            self.fired = False
            actions.append("exit")
        return events, actions

    def cooldown_left(self, area, now):
        if self.last_enter_fire is None:
            return 0.0
        return max(0.0, area["cooldownSec"] - (now - self.last_enter_fire))


def in_window(cfg_arming, minutes_now):
    start = C.parse_hhmm(cfg_arming.get("startTime", ""))
    end = C.parse_hhmm(cfg_arming.get("endTime", ""))
    if start is None or end is None or start == end:
        return True
    if start < end:
        return start <= minutes_now < end
    return minutes_now >= start or minutes_now < end  # overnight, e.g. 22:00-06:00


def compute_armed(cfg, override, show_busy, idle_since, now, minutes_now):
    """Returns (armed, reason)."""
    if not cfg["enabled"]:
        return False, "Plugin is turned off"
    if override == "disarmed":
        return False, "Disarmed by command"
    if override == "armed":
        return True, "Armed by command"
    arming = cfg["arming"]
    mode = arming["mode"]
    if mode == "schedule":
        return False, "Waiting for the Arm command (scheduler)"
    if not in_window(arming, minutes_now):
        return False, "Outside the %s-%s window" % (arming["startTime"], arming["endTime"])
    if mode == "always":
        return True, "Always armed"
    # afterShow
    if show_busy:
        return False, "Show is playing"
    grace = arming["graceMinutes"] * 60.0
    if idle_since is None:
        return False, "Checking the show player"
    left = grace - (now - idle_since)
    if left > 0:
        return False, "Show ended, arming in %d s" % int(math.ceil(left))
    return True, "Show is over"


def build_command(action):
    """Area action -> (command name, [args]) for the show player, or None."""
    if action.get("type") == "preset":
        return "Trigger Command Preset", [action["preset"]]
    if action.get("type") == "command":
        return action["command"], list(action.get("args", []))
    return None


# --------------------------------------------------------------------------
# Talking to the show player
# --------------------------------------------------------------------------

def _show_request(host, path, auth, data=None, timeout=4.0):
    if "://" not in host:
        host = "http://" + host
    url = host.rstrip("/") + path
    req = urllib.request.Request(url, data=data, method="POST" if data is not None else "GET")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if auth:
        req.add_header("Authorization", "Basic " + auth)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.status, resp.read(65536)


class ShowLink:
    def __init__(self, daemon):
        self.d = daemon
        self.q = queue.Queue(maxsize=100)
        self.status_name = "unknown"
        self.reachable = False
        self.last_check = None
        self.last_error = ""
        self.idle_since = None
        self.busy = False
        self._stop = threading.Event()
        threading.Thread(target=self._sender, name="sender", daemon=True).start()
        threading.Thread(target=self._poller, name="poller", daemon=True).start()

    def stop(self):
        self._stop.set()

    def _auth(self):
        cfg = self.d.cfg
        pw = self.d.secrets.get("showPassword", "")
        if not pw:
            return ""
        user = cfg["show"].get("username") or "admin"
        return base64.b64encode(("%s:%s" % (user, pw)).encode()).decode()

    def send(self, label, action):
        cmd = build_command(action)
        if cmd is None:
            return
        try:
            self.q.put_nowait((label, cmd[0], cmd[1]))
        except queue.Full:
            log.warning("Too many commands waiting for the show player; dropped %s", label)

    def _sender(self):
        while not self._stop.is_set():
            try:
                label, name, args = self.q.get(timeout=0.5)
            except queue.Empty:
                continue
            host = self.d.cfg["show"]["host"]
            if not host:
                log.warning("No show player is set; %s was not sent", label)
                continue
            path = "/api/command/" + urllib.parse.quote(name, safe="")
            body = json.dumps(args).encode()
            try:
                status, _ = _show_request(host, path, self._auth(), data=body)
                log.debug("%s: sent '%s' %s to %s (HTTP %d)", label, name, args, host, status)
                self.d.add_event("sent", label, "%s %s" % (name, json.dumps(args)))
            except urllib.error.HTTPError as e:
                log.error("%s: show player refused '%s': HTTP %d", label, name, e.code)
                self.d.add_event("error", label, "HTTP %d for %s" % (e.code, name))
            except (OSError, ValueError) as e:
                log.error("%s: could not reach show player %s: %s", label, host, e)
                self.d.add_event("error", label, "could not reach %s" % host)

    def _poller(self):
        while not self._stop.is_set():
            cfg = self.d.cfg
            host = cfg["show"]["host"]
            if cfg["enabled"] and host:
                self._poll_once(host)
            else:
                self.status_name = "not set" if not host else "unknown"
                self.reachable = False
                self.busy = False
                if self.idle_since is None:
                    self.idle_since = time.monotonic()
            self._stop.wait(SHOW_POLL_SEC)

    def _poll_once(self, host):
        now = time.monotonic()
        try:
            _, body = _show_request(host, "/api/fppd/status", self._auth(), timeout=3.0)
            st = json.loads(body.decode("utf-8", "replace"))
            name = str(st.get("status_name", "unknown"))
            self.reachable = True
            self.last_error = ""
        except (OSError, ValueError) as e:
            # A show player that is off or unplugged is not playing a show.
            name = "unreachable"
            if self.reachable or not self.last_error:
                log.info("Show player %s is not answering (%s)", host, e)
            self.reachable = False
            self.last_error = str(e)
        busy = self.reachable and name != "idle"
        if busy:
            self.idle_since = None
        elif self.idle_since is None or self.busy:
            self.idle_since = now
        self.busy = busy
        self.status_name = name
        self.last_check = time.time()


# --------------------------------------------------------------------------
# MQTT (sensor data)
# --------------------------------------------------------------------------

class MqttLink:
    def __init__(self, daemon):
        self.d = daemon
        self.client = None
        self.connected = False
        self.error = ""
        self.settings = None  # (host, port, user, password, prefix) in use

    def wanted(self, cfg, secrets):
        if not cfg["enabled"]:
            return None
        m = cfg["mqtt"]
        host = "127.0.0.1" if m["mode"] == "builtin" else (m["host"] or "")
        if not host:
            return None
        return (host, m["port"], m["username"], secrets.get("mqttPassword", ""), m["topicPrefix"])

    def apply(self, cfg, secrets):
        want = self.wanted(cfg, secrets)
        if want == self.settings:
            return
        self.stop()
        self.settings = want
        if want is None:
            return
        if mqtt is None:
            self.error = "python3-paho-mqtt is not installed"
            log.error(self.error)
            return
        host, port, user, pw, prefix = want
        try:
            client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="yardsecurity-%d" % os.getpid())
        except AttributeError:  # paho-mqtt 1.x
            client = mqtt.Client(client_id="yardsecurity-%d" % os.getpid())
        if user:
            client.username_pw_set(user, pw or None)
        client.on_connect = lambda c, u, f, rc, *a: self._on_connect(c, rc, prefix)
        client.on_disconnect = lambda c, u, *a: self._on_disconnect(a)
        client.on_message = lambda c, u, msg: self._on_message(msg, prefix)
        client.reconnect_delay_set(1, 30)
        self.client = client
        self.error = ""
        log.info("Connecting to MQTT broker %s:%d as '%s'", host, port, user)
        try:
            client.connect_async(host, port, keepalive=30)
            client.loop_start()
        except (OSError, ValueError) as e:
            self.error = str(e)
            log.error("MQTT connect failed: %s", e)

    def stop(self):
        if self.client is not None:
            try:
                self.client.disconnect()
                self.client.loop_stop()
            except Exception:  # noqa: BLE001 - shutting down anyway
                pass
        self.client = None
        self.connected = False

    def _on_connect(self, client, rc, prefix):
        code = getattr(rc, "value", rc)
        if code == 0:
            self.connected = True
            self.error = ""
            client.subscribe([(prefix + "/+/targets", 0), (prefix + "/+/status", 0)])
            log.info("MQTT connected; listening on %s/+/targets", prefix)
        else:
            self.connected = False
            self.error = "broker refused the connection (%s)" % rc
            log.error("MQTT: %s", self.error)

    def _on_disconnect(self, args):
        if self.connected:
            log.warning("MQTT disconnected")
        self.connected = False

    def _on_message(self, msg, prefix):
        topic = msg.topic
        if not topic.startswith(prefix + "/"):
            return
        parts = topic[len(prefix) + 1:].split("/")
        if len(parts) != 2:
            return
        device, kind = parts
        payload = msg.payload[:4096].decode("utf-8", "replace")
        if kind == "status":
            self.d.sensor_status(device, payload.strip() == "online")
        elif kind == "targets":
            try:
                data = json.loads(payload)
            except ValueError:
                return
            targets = []
            for t in (data.get("t") or [])[:3]:
                if isinstance(t, list) and len(t) == 2 and all(isinstance(v, (int, float)) for v in t):
                    targets.append((float(t[0]), float(t[1])))
            self.d.sensor_targets(device, targets, bool(data.get("c", 1)))


# --------------------------------------------------------------------------
# Control socket (web UI and FPP commands)
# --------------------------------------------------------------------------

class ControlServer:
    def __init__(self, daemon):
        self.d = daemon
        try:
            os.unlink(C.SOCKET_FILE)
        except OSError:
            pass
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.bind(C.SOCKET_FILE)
        # The web UI runs as the fpp user; nobody else needs the socket.
        try:
            import pwd
            pw = pwd.getpwnam("fpp")
            os.chown(C.SOCKET_FILE, pw.pw_uid, pw.pw_gid)
        except (KeyError, OSError):
            pass
        os.chmod(C.SOCKET_FILE, 0o660)
        self.sock.listen(8)
        threading.Thread(target=self._serve, name="control", daemon=True).start()

    def close(self):
        try:
            self.sock.close()
            os.unlink(C.SOCKET_FILE)
        except OSError:
            pass

    def _serve(self):
        while True:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            threading.Thread(target=self._handle, args=(conn,), daemon=True).start()

    def _handle(self, conn):
        with conn:
            conn.settimeout(3.0)
            buf = b""
            try:
                while b"\n" not in buf and len(buf) < 65536:
                    chunk = conn.recv(4096)
                    if not chunk:
                        break
                    buf += chunk
                req = json.loads(buf.decode("utf-8", "replace") or "{}")
                resp = self.d.handle_request(req if isinstance(req, dict) else {})
            except (OSError, ValueError) as e:
                resp = {"ok": False, "error": str(e)}
            try:
                conn.sendall((json.dumps(resp) + "\n").encode())
            except OSError:
                pass


# --------------------------------------------------------------------------
# The daemon
# --------------------------------------------------------------------------

class Daemon:
    def __init__(self):
        self.lock = threading.RLock()
        self.cfg = C.load_config()
        self.secrets = C.load_secrets()
        self.override = C.load_state().get("override")
        if self.override not in ("armed", "disarmed"):
            self.override = None
        self._mtimes = self._file_mtimes()
        self.sensors = {}       # device -> dict
        self.trackers = {}      # area id -> AreaTracker
        self.armed = False
        self.arm_reason = ""
        self.events = collections.deque(maxlen=40)  # memory only
        self.running = True
        self.started = time.time()
        self.broker_lost = False
        self.apply_log_level()
        self.show = ShowLink(self)
        self.mqtt = MqttLink(self)
        self.control = ControlServer(self)

    # ---- config -----------------------------------------------------------

    def _file_mtimes(self):
        out = []
        for p in (C.CONFIG_FILE, C.LEGACY_CONFIG_FILE, C.SECRETS_FILE):
            try:
                out.append(os.stat(p).st_mtime_ns)
            except OSError:
                out.append(0)
        return out

    def reload(self, force=False):
        m = self._file_mtimes()
        if not force and m == self._mtimes:
            return
        self._mtimes = m
        with self.lock:
            old_enabled = self.cfg["enabled"]
            self.cfg = C.load_config()
            self.secrets = C.load_secrets()
            ids = {a["id"] for a in self.cfg["areas"]}
            for gone in [k for k in self.trackers if k not in ids]:
                t = self.trackers.pop(gone)
                if t.fired:
                    log.info("Area %s was removed while lit; its exit action was not sent", gone)
        self.apply_log_level()
        if old_enabled != self.cfg["enabled"]:
            log.info("Yard Security %s", "enabled" if self.cfg["enabled"] else "disabled")
        else:
            log.info("Settings reloaded")

    def check_broker(self):
        """The built-in broker's files live in /etc, which an FPP OS upgrade
        replaces. Say so once if it was turned on but its config is gone."""
        lost = (self.cfg["mqtt"]["mode"] == "builtin" and os.path.exists(C.BROKER_WANTED_FILE)
                and not os.path.exists(C.BROKER_CONF_FILE))
        if lost and not self.broker_lost:
            log.warning("The built-in MQTT broker was turned on but its config is gone (an FPP OS "
                        "upgrade removes it). Press 'Turn it back on' on the Yard Security page.")
        elif self.broker_lost and not lost:
            log.info("Built-in MQTT broker config is back")
        self.broker_lost = lost

    def apply_log_level(self):
        log.setLevel(logging.DEBUG if self.cfg["logLevel"] == "debug" else logging.INFO)

    # ---- sensor input (MQTT thread) ----------------------------------------

    def _sensor(self, device):
        s = self.sensors.get(device)
        if s is None:
            s = {"online": True, "targets": [], "ts": None, "radarOk": True}
            self.sensors[device] = s
            if len(self.sensors) > 32:  # keep a stray publisher from growing this
                oldest = min(self.sensors, key=lambda k: self.sensors[k]["ts"] or 0)
                self.sensors.pop(oldest, None)
        return s

    def sensor_status(self, device, online):
        with self.lock:
            s = self._sensor(device)
            if s["online"] != online:
                log.info("Sensor %s is %s", device, "online" if online else "offline")
            s["online"] = online

    def sensor_targets(self, device, targets, radar_ok):
        with self.lock:
            s = self._sensor(device)
            s["online"] = True
            s["targets"] = targets
            s["ts"] = time.monotonic()
            if s["radarOk"] != radar_ok:
                log.warning("Sensor %s radar %s", device, "is back" if radar_ok else "is not answering the ESP32")
            s["radarOk"] = radar_ok

    def _fresh_targets(self, device, now):
        s = self.sensors.get(device)
        if not s or not s["online"] or not s["radarOk"] or s["ts"] is None:
            return None
        if now - s["ts"] > STALE_SEC:
            return None
        return s["targets"]

    # ---- events -------------------------------------------------------------

    def add_event(self, kind, area, detail=""):
        with self.lock:
            self.events.appendleft({"t": time.time(), "kind": kind, "area": area, "detail": detail})

    # ---- main loop ------------------------------------------------------------

    def tick(self):
        now = time.monotonic()
        lt = time.localtime()
        with self.lock:
            cfg = self.cfg
            armed, reason = compute_armed(cfg, self.override, self.show.busy, self.show.idle_since,
                                          now, lt.tm_hour * 60 + lt.tm_min)
            if armed != self.armed:
                log.info("%s: %s", "ARMED" if armed else "Disarmed", reason)
                self.add_event("armed" if armed else "disarmed", "", reason)
            self.armed, self.arm_reason = armed, reason
            for area in cfg["areas"]:
                tr = self.trackers.setdefault(area["id"], AreaTracker())
                present = False
                if cfg["enabled"] and area["enabled"]:
                    targets = self._fresh_targets(area["sensor"], now)
                    present = bool(targets) and any(target_in_area(area, x, y) for x, y in targets)
                events, actions = tr.update(area, now, present, armed and area["enabled"])
                for e in events:
                    log.debug("%s: %s", area["name"], "someone entered" if e == "occupied" else "clear")
                    self.add_event(e, area["name"])
                for a in actions:
                    self.show.send(area["name"] + (" enter" if a == "enter" else " exit"),
                                   area["onEnter"] if a == "enter" else area["onExit"])

    def run(self):
        log.info("Yard Security daemon started (pid %d)%s", os.getpid(),
                 "" if self.cfg["enabled"] else "; plugin is turned off")
        last_reload = 0.0
        last_broker = 0.0
        while self.running:
            t = time.monotonic()
            if t - last_reload >= 2.0:
                last_reload = t
                self.reload()
                self.mqtt.apply(self.cfg, self.secrets)
            if t - last_broker >= 30.0:
                last_broker = t
                self.check_broker()
            try:
                self.tick()
            except Exception:  # noqa: BLE001 - keep the daemon alive, but say why
                log.exception("Error in main loop")
            time.sleep(TICK_SEC)
        self.shutdown()

    def shutdown(self):
        # Turn off anything this daemon turned on.
        with self.lock:
            for area in self.cfg["areas"]:
                tr = self.trackers.get(area["id"])
                if tr and tr.fired:
                    tr.fired = False
                    self.show.send(area["name"] + " exit", area["onExit"])
        deadline = time.monotonic() + 3.0
        while not self.show.q.empty() and time.monotonic() < deadline:
            time.sleep(0.1)
        self.mqtt.stop()
        self.show.stop()
        self.control.close()
        log.info("Yard Security daemon stopped")

    # ---- control requests -------------------------------------------------------

    def set_override(self, value):
        with self.lock:
            self.override = value
            C.write_json_atomic(C.STATE_FILE, {"override": value})
        log.info("Override set to %s", value or "automatic")

    def find_area(self, key):
        key = str(key or "").strip().lower()
        for a in self.cfg["areas"]:
            if a["id"].lower() == key or a["name"].lower() == key:
                return a
        return None

    def handle_request(self, req):
        cmd = req.get("cmd")
        if cmd == "status":
            return self.status()
        if cmd == "reload":
            self.reload(force=True)
            self.mqtt.apply(self.cfg, self.secrets)
            return {"ok": True}
        if cmd in ("arm", "disarm", "auto"):
            self.set_override({"arm": "armed", "disarm": "disarmed", "auto": None}[cmd])
            return {"ok": True}
        if cmd == "test":
            area = self.find_area(req.get("area"))
            if area is None:
                return {"ok": False, "error": "No area named '%s'" % req.get("area")}
            phase = req.get("phase", "both")
            if phase in ("enter", "both"):
                self.show.send(area["name"] + " test enter", area["onEnter"])
            if phase == "both":
                delay = max(1.0, min(area["holdSec"], 60.0))
                threading.Timer(delay, self.show.send, args=(area["name"] + " test exit", area["onExit"])).start()
            elif phase == "exit":
                self.show.send(area["name"] + " test exit", area["onExit"])
            self.add_event("test", area["name"], phase)
            log.info("Test of %s (%s)", area["name"], phase)
            return {"ok": True}
        return {"ok": False, "error": "unknown command"}

    def status(self):
        now = time.monotonic()
        with self.lock:
            sensors = {}
            for name, s in self.sensors.items():
                age = None if s["ts"] is None else round(now - s["ts"], 1)
                sensors[name] = {
                    "online": s["online"],
                    "radarOk": s["radarOk"],
                    "ageSec": age,
                    "targets": [{"xFt": round(x / C.MM_PER_FT, 2), "yFt": round(y / C.MM_PER_FT, 2),
                                 "distFt": round(math.hypot(x, y) / C.MM_PER_FT, 2)}
                                for x, y in (s["targets"] if age is not None and age <= STALE_SEC else [])],
                }
            areas = []
            for a in self.cfg["areas"]:
                tr = self.trackers.get(a["id"]) or AreaTracker()
                areas.append({
                    "id": a["id"], "name": a["name"], "occupied": tr.occupied, "lit": tr.fired,
                    "cooldownLeft": round(tr.cooldown_left(a, now), 1),
                })
            return {
                "ok": True,
                "pid": os.getpid(),
                "enabled": self.cfg["enabled"],
                "armed": self.armed,
                "armReason": self.arm_reason,
                "override": self.override,
                "mode": self.cfg["arming"]["mode"],
                "show": {"host": self.cfg["show"]["host"], "status": self.show.status_name,
                         "reachable": self.show.reachable, "lastCheck": self.show.last_check},
                "brokerLost": self.broker_lost,
                "mqtt": {"connected": self.mqtt.connected, "error": self.mqtt.error,
                         "host": (self.mqtt.settings or [""])[0], "pahoMissing": mqtt is None},
                "sensors": sensors,
                "areas": areas,
                "events": list(self.events),
            }


def setup_logging():
    os.makedirs(C.LOGDIR, exist_ok=True)
    handler = logging.handlers.WatchedFileHandler(C.LOG_FILE)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    log.addHandler(handler)
    log.setLevel(logging.INFO)
    log.propagate = False


def already_running():
    try:
        with open(C.PID_FILE) as f:
            pid = int(f.read().strip())
        os.kill(pid, 0)
        with open("/proc/%d/cmdline" % pid, "rb") as f:
            return pid if b"yardsecd" in f.read() else None
    except (OSError, ValueError):
        return None


def main():
    os.makedirs(C.DATADIR, exist_ok=True)
    setup_logging()
    pid = already_running()
    if pid:
        log.info("Daemon already running (pid %d)", pid)
        return 0
    with open(C.PID_FILE, "w") as f:
        f.write(str(os.getpid()))
    try:
        d = Daemon()

        def stop(*_):
            d.running = False
        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        d.run()
    except Exception:  # noqa: BLE001
        log.exception("Daemon crashed")
        return 1
    finally:
        try:
            os.unlink(C.PID_FILE)
        except OSError:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
