"""Unit tests for the zone, timing and arming logic. Run: python3 -m unittest discover tests"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))
import ys_common as C  # noqa: E402
import yardsecd as Y  # noqa: E402

FT = C.MM_PER_FT


def area(**kw):
    a = C.normalize_area(dict(kw), 0)
    return a


class ZoneTests(unittest.TestCase):
    def test_distance(self):
        a = area(maxFt=15)
        self.assertTrue(Y.target_in_area(a, 0, 14.9 * FT))
        self.assertFalse(Y.target_in_area(a, 0, 15.1 * FT))
        # straight-line distance, not just y
        self.assertFalse(Y.target_in_area(a, 10 * FT, 12 * FT))

    def test_min_distance(self):
        a = area(minFt=5, maxFt=15)
        self.assertFalse(Y.target_in_area(a, 0, 4 * FT))
        self.assertTrue(Y.target_in_area(a, 0, 6 * FT))

    def test_side_limits(self):
        a = area(maxFt=20, leftFt=3, rightFt=6)
        self.assertTrue(Y.target_in_area(a, -2.9 * FT, 10 * FT))
        self.assertFalse(Y.target_in_area(a, -3.1 * FT, 10 * FT))
        self.assertTrue(Y.target_in_area(a, 5.9 * FT, 10 * FT))
        self.assertFalse(Y.target_in_area(a, 6.1 * FT, 10 * FT))

    def test_no_target(self):
        self.assertFalse(Y.target_in_area(area(), None, None))


class TrackerTests(unittest.TestCase):
    def run_seq(self, a, samples, armed=True):
        tr = Y.AreaTracker()
        out = []
        for t, present in samples:
            _, actions = tr.update(a, t, present, armed)
            out += [(t, x) for x in actions]
        return tr, out

    def test_enter_delay_hold_and_exit(self):
        a = area(enterMs=300, holdSec=5, cooldownSec=0)
        samples = [(0.0, True), (0.2, True), (0.3, True), (1.0, False), (5.2, False), (5.4, False)]
        _, out = self.run_seq(a, samples)
        self.assertEqual(out, [(0.3, "enter"), (5.4, "exit")])

    def test_blip_ignored(self):
        a = area(enterMs=300)
        _, out = self.run_seq(a, [(0.0, True), (0.1, False), (0.2, True), (0.4, False)])
        self.assertEqual(out, [])

    def test_hold_bridges_gaps(self):
        a = area(enterMs=0, holdSec=5, cooldownSec=0)
        _, out = self.run_seq(a, [(0, True), (3, False), (4, True), (8, False), (9.1, False)])
        self.assertEqual(out, [(0, "enter"), (9.1, "exit")])

    def test_cooldown(self):
        a = area(enterMs=0, holdSec=1, cooldownSec=30)
        samples = [(0, True), (1, False), (2.5, False),     # enter + exit
                   (10, True), (11, False), (12.5, False),  # inside cooldown: nothing
                   (40, True)]                              # after cooldown: enter
        _, out = self.run_seq(a, samples)
        self.assertEqual([x for _, x in out], ["enter", "exit", "enter"])

    def test_disarm_turns_off_and_arm_turns_on(self):
        a = area(enterMs=0, holdSec=5, cooldownSec=0)
        tr = Y.AreaTracker()
        self.assertEqual(tr.update(a, 0, True, False)[1], [])          # disarmed: nothing
        self.assertEqual(tr.update(a, 1, True, True)[1], ["enter"])    # armed while present
        self.assertEqual(tr.update(a, 2, True, False)[1], ["exit"])    # disarmed: lights off


class ArmTests(unittest.TestCase):
    def cfg(self, **arming):
        c = C.normalize_config({"enabled": True, "arming": arming})
        return c

    def test_disabled(self):
        c = C.normalize_config({"enabled": False, "arming": {"mode": "always"}})
        self.assertFalse(Y.compute_armed(c, None, False, 0, 100, 0)[0])

    def test_after_show_with_grace(self):
        c = self.cfg(mode="afterShow", graceMinutes=2)
        self.assertFalse(Y.compute_armed(c, None, True, None, 100, 0)[0])
        self.assertFalse(Y.compute_armed(c, None, False, 100, 160, 0)[0])
        self.assertTrue(Y.compute_armed(c, None, False, 100, 221, 0)[0])

    def test_window_overnight(self):
        c = self.cfg(mode="always", startTime="22:00", endTime="06:00")
        self.assertTrue(Y.compute_armed(c, None, False, 0, 0, 23 * 60)[0])
        self.assertTrue(Y.compute_armed(c, None, False, 0, 0, 5 * 60)[0])
        self.assertFalse(Y.compute_armed(c, None, False, 0, 0, 12 * 60)[0])

    def test_schedule_and_overrides(self):
        c = self.cfg(mode="schedule")
        self.assertFalse(Y.compute_armed(c, None, False, 0, 0, 0)[0])
        self.assertTrue(Y.compute_armed(c, "armed", True, None, 0, 0)[0])
        c = self.cfg(mode="always")
        self.assertFalse(Y.compute_armed(c, "disarmed", False, 0, 0, 0)[0])


class ConfigTests(unittest.TestCase):
    def test_normalize(self):
        c = C.normalize_config({"areas": [{"name": "Driveway", "maxFt": "12", "minFt": 20,
                                           "onEnter": {"type": "preset", "preset": "Drive On"}},
                                          {"id": "area1"}],
                                "mqtt": {"topicPrefix": "a/#"}})
        self.assertEqual(c["areas"][0]["maxFt"], 12.0)
        self.assertEqual(c["areas"][0]["minFt"], 0.0)
        self.assertEqual(c["areas"][1]["name"], "Area 2")
        self.assertNotEqual(c["areas"][0]["id"], c["areas"][1]["id"])
        self.assertEqual(c["mqtt"]["topicPrefix"], "yardsecurity")
        self.assertEqual(Y.build_command(c["areas"][0]["onEnter"]), ("Trigger Command Preset", ["Drive On"]))


class ConfigLocationTests(unittest.TestCase):
    """Settings live in config/plugin.fpp-plugin-YardSecurity.json (in FPP's
    backup); plugindata/config.json is only read when that file is missing."""

    def setUp(self):
        import importlib
        import tempfile
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["MEDIADIR"] = self.tmp.name
        os.environ.pop("YS_DATADIR", None)
        os.environ.pop("YS_CONFIGDIR", None)
        self.C = importlib.reload(C)

    def tearDown(self):
        import importlib
        self.tmp.cleanup()
        os.environ.pop("MEDIADIR", None)
        importlib.reload(C)

    def write(self, path, name):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write('{"areas": [{"name": "%s"}]}' % name)

    def test_paths(self):
        self.assertEqual(self.C.CONFIG_FILE, os.path.join(self.tmp.name, "config", "plugin.fpp-plugin-YardSecurity.json"))
        self.assertEqual(self.C.LEGACY_CONFIG_FILE, os.path.join(self.tmp.name, "plugindata", "fpp-plugin-YardSecurity", "config.json"))

    def test_legacy_used_when_new_missing(self):
        self.write(self.C.LEGACY_CONFIG_FILE, "Old")
        self.assertEqual(self.C.load_config()["areas"][0]["name"], "Old")

    def test_new_file_wins(self):
        self.write(self.C.LEGACY_CONFIG_FILE, "Old")
        self.write(self.C.CONFIG_FILE, "New")
        self.assertEqual(self.C.load_config()["areas"][0]["name"], "New")

    def test_nothing_saved(self):
        self.assertEqual(self.C.load_config()["areas"], [])


if __name__ == "__main__":
    unittest.main()
