"""Shared paths and config handling for fpp-plugin-YardSecurity.

Settings (areas, arming, connection; no passwords) live in FPP's config folder,
<mediadir>/config/plugin.fpp-plugin-YardSecurity.json, so FPP's own settings
backup includes them and a restore brings them back.

Everything else lives in <mediadir>/plugindata/fpp-plugin-YardSecurity/:

  secrets.json  show player and MQTT passwords, mode 0600 (written by the web UI)
  config.json   where settings were kept before; read only if the new file is missing
  broker-wanted present while the built-in broker is meant to be on
  state.json    the arm/disarm override set by FPP commands or the web UI
  daemon.sock   control socket the web UI and FPP commands talk to
  daemon.pid    pid of the running daemon
"""

import copy
import json
import os
import tempfile

REPO_NAME = "fpp-plugin-YardSecurity"

MEDIADIR = os.environ.get("MEDIADIR", "/home/fpp/media")
LOGDIR = os.environ.get("LOGDIR", os.path.join(MEDIADIR, "logs"))
DATADIR = os.environ.get("YS_DATADIR", os.path.join(MEDIADIR, "plugindata", REPO_NAME))

CONFIGDIR = os.environ.get("YS_CONFIGDIR", os.path.join(MEDIADIR, "config"))
CONFIG_FILE = os.path.join(CONFIGDIR, "plugin.%s.json" % REPO_NAME)
LEGACY_CONFIG_FILE = os.path.join(DATADIR, "config.json")
BROKER_WANTED_FILE = os.path.join(DATADIR, "broker-wanted")
BROKER_CONF_FILE = "/etc/mosquitto/conf.d/%s.conf" % REPO_NAME
SECRETS_FILE = os.path.join(DATADIR, "secrets.json")
STATE_FILE = os.path.join(DATADIR, "state.json")
SOCKET_FILE = os.path.join(DATADIR, "daemon.sock")
PID_FILE = os.path.join(DATADIR, "daemon.pid")
LOG_FILE = os.path.join(LOGDIR, "plugin-%s.log" % REPO_NAME)

MM_PER_FT = 304.8

DEFAULT_CONFIG = {
    "enabled": False,
    "logLevel": "info",
    "show": {
        # The FPP player that runs the lights. Commands are sent to it.
        "host": "",
        "username": "admin",
    },
    "arming": {
        # always    - armed all the time
        # schedule  - armed only by the "Yard Security - Arm" command
        #             (FPP scheduler, a playlist, or the button on the page)
        # afterShow - armed whenever the show player is not playing
        "mode": "afterShow",
        "graceMinutes": 2,
        # Optional "HH:MM" window. Both empty = no time limit.
        "startTime": "",
        "endTime": "",
    },
    "mqtt": {
        # builtin  - the Mosquitto broker on this device (turned on from the page)
        # external - a broker you already run
        "mode": "builtin",
        "host": "127.0.0.1",
        "port": 1883,
        "username": "yardsecurity",
        "topicPrefix": "yardsecurity",
    },
    "areas": [],
}

DEFAULT_AREA = {
    "id": "",
    "name": "",
    "enabled": True,
    "sensor": "",
    "minFt": 0.0,
    "maxFt": 15.0,
    "leftFt": 0.0,
    "rightFt": 0.0,
    "enterMs": 300,
    "holdSec": 5,
    "cooldownSec": 30,
    "onEnter": {"type": "none"},
    "onExit": {"type": "none"},
}


def _merge(defaults, value):
    if not isinstance(defaults, dict):
        return value if value is not None else copy.deepcopy(defaults)
    out = copy.deepcopy(defaults)
    if isinstance(value, dict):
        for k, v in value.items():
            if k in defaults and isinstance(defaults[k], dict):
                out[k] = _merge(defaults[k], v)
            else:
                out[k] = v
    return out


def _num(v, default, lo=None, hi=None):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return default
    if v != v:  # NaN
        return default
    if lo is not None:
        v = max(lo, v)
    if hi is not None:
        v = min(hi, v)
    return v


def normalize_action(a):
    if not isinstance(a, dict):
        return {"type": "none"}
    t = a.get("type", "none")
    if t == "preset":
        name = str(a.get("preset", "")).strip()
        return {"type": "preset", "preset": name} if name else {"type": "none"}
    if t == "command":
        name = str(a.get("command", "")).strip()
        args = a.get("args", [])
        if not isinstance(args, list):
            args = []
        args = [str(x) for x in args]
        return {"type": "command", "command": name, "args": args} if name else {"type": "none"}
    return {"type": "none"}


def normalize_area(a, index):
    area = _merge(DEFAULT_AREA, a if isinstance(a, dict) else {})
    area["id"] = str(area.get("id") or "area%d" % (index + 1))
    area["name"] = str(area.get("name") or "Area %d" % (index + 1)).strip()[:40]
    area["enabled"] = bool(area.get("enabled", True))
    area["sensor"] = str(area.get("sensor", "")).strip()
    area["minFt"] = _num(area["minFt"], 0.0, 0, 30)
    area["maxFt"] = _num(area["maxFt"], 15.0, 0.5, 30)
    if area["minFt"] >= area["maxFt"]:
        area["minFt"] = 0.0
    area["leftFt"] = _num(area["leftFt"], 0.0, 0, 30)
    area["rightFt"] = _num(area["rightFt"], 0.0, 0, 30)
    area["enterMs"] = int(_num(area["enterMs"], 300, 0, 10000))
    area["holdSec"] = _num(area["holdSec"], 5, 0, 3600)
    area["cooldownSec"] = _num(area["cooldownSec"], 30, 0, 86400)
    area["onEnter"] = normalize_action(area.get("onEnter"))
    area["onExit"] = normalize_action(area.get("onExit"))
    return area


def normalize_config(cfg):
    cfg = _merge(DEFAULT_CONFIG, cfg if isinstance(cfg, dict) else {})
    cfg["enabled"] = bool(cfg["enabled"])
    if cfg["logLevel"] not in ("info", "debug"):
        cfg["logLevel"] = "info"
    if cfg["arming"]["mode"] not in ("always", "schedule", "afterShow"):
        cfg["arming"]["mode"] = "afterShow"
    cfg["arming"]["graceMinutes"] = _num(cfg["arming"]["graceMinutes"], 2, 0, 240)
    for k in ("startTime", "endTime"):
        v = str(cfg["arming"].get(k, "")).strip()
        cfg["arming"][k] = v if parse_hhmm(v) is not None else ""
    if cfg["mqtt"]["mode"] not in ("builtin", "external"):
        cfg["mqtt"]["mode"] = "builtin"
    cfg["mqtt"]["port"] = int(_num(cfg["mqtt"]["port"], 1883, 1, 65535))
    prefix = str(cfg["mqtt"].get("topicPrefix", "")).strip().strip("/")
    if not prefix or any(c in prefix for c in "+#"):
        prefix = "yardsecurity"
    cfg["mqtt"]["topicPrefix"] = prefix
    cfg["show"]["host"] = str(cfg["show"].get("host", "")).strip()
    areas = cfg.get("areas")
    if not isinstance(areas, list):
        areas = []
    cfg["areas"] = [normalize_area(a, i) for i, a in enumerate(areas[:16])]
    seen = set()
    for i, a in enumerate(cfg["areas"]):
        while a["id"] in seen:
            a["id"] = a["id"] + "_%d" % i
        seen.add(a["id"])
    return cfg


def parse_hhmm(v):
    """'22:30' -> minutes after midnight, or None."""
    try:
        h, m = v.split(":")
        h, m = int(h), int(m)
    except (ValueError, AttributeError):
        return None
    if 0 <= h <= 23 and 0 <= m <= 59:
        return h * 60 + m
    return None


def _read_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def load_config():
    if os.path.exists(CONFIG_FILE):
        return normalize_config(_read_json(CONFIG_FILE, {}))
    return normalize_config(_read_json(LEGACY_CONFIG_FILE, {}))


def load_secrets():
    s = _read_json(SECRETS_FILE, {})
    return s if isinstance(s, dict) else {}


def load_state():
    s = _read_json(STATE_FILE, {})
    return s if isinstance(s, dict) else {}


def write_json_atomic(path, data, mode=0o644):
    d = os.path.dirname(path)
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".tmp-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
