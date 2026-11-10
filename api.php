<?php
/*
 * Yard Security API, served by FPP under /api/plugin/fpp-plugin-YardSecurity/...
 *
 * Like every FPP page and API, these routes are reachable by anyone who can
 * reach this FPP's web interface; FPP has no password by default.
 */

function yardSecDataDir()
{
    global $settings;
    $media = isset($settings['mediaDirectory']) ? $settings['mediaDirectory'] : '/home/fpp/media';
    return $media . '/plugindata/fpp-plugin-YardSecurity';
}

function yardSecPluginDir()
{
    return __DIR__;
}

function yardSecReadJson($file, $default)
{
    if (!is_file($file)) {
        return $default;
    }
    $v = json_decode(@file_get_contents($file), true);
    return is_array($v) ? $v : $default;
}

function yardSecWriteJson($file, $data, $mode)
{
    $dir = dirname($file);
    if (!is_dir($dir)) {
        @mkdir($dir, 0750, true);
    }
    $tmp = $file . '.tmp';
    if (@file_put_contents($tmp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), LOCK_EX) === false) {
        return false;
    }
    @chmod($tmp, $mode);
    return @rename($tmp, $file);
}

function yardSecDaemon($req)
{
    $sock = @stream_socket_client('unix://' . yardSecDataDir() . '/daemon.sock', $errno, $errstr, 2);
    if (!$sock) {
        return array('ok' => false, 'daemon' => false, 'error' => 'The Yard Security daemon is not running');
    }
    stream_set_timeout($sock, 3);
    fwrite($sock, json_encode($req) . "\n");
    $line = fgets($sock, 1048576);
    fclose($sock);
    $resp = json_decode($line, true);
    return is_array($resp) ? $resp : array('ok' => false, 'error' => 'No answer from the daemon');
}

function yardSecBody()
{
    $b = json_decode(file_get_contents('php://input'), true);
    return is_array($b) ? $b : array();
}

function yardSecValidHost($h)
{
    return is_string($h) && $h !== '' && strlen($h) <= 255 && preg_match('/^[A-Za-z0-9.\-:\[\]]+$/', $h);
}

function yardSecBroker($action)
{
    $cmd = 'sudo ' . escapeshellarg(yardSecPluginDir() . '/scripts/broker.sh') . ' ' . escapeshellarg($action) . ' 2>/dev/null';
    $out = array();
    exec($cmd, $out);
    $r = json_decode(implode("\n", $out), true);
    return is_array($r) ? $r : array('ok' => false, 'message' => 'Could not run the broker script');
}

function getEndpointsfpppluginYardSecurity()
{
    $eps = array(
        array('method' => 'GET', 'endpoint' => 'status', 'callback' => 'yardSecApiStatus'),
        array('method' => 'GET', 'endpoint' => 'config', 'callback' => 'yardSecApiGetConfig'),
        array('method' => 'POST', 'endpoint' => 'config', 'callback' => 'yardSecApiSaveConfig'),
        array('method' => 'POST', 'endpoint' => 'arm', 'callback' => 'yardSecApiArm'),
        array('method' => 'POST', 'endpoint' => 'disarm', 'callback' => 'yardSecApiDisarm'),
        array('method' => 'POST', 'endpoint' => 'auto', 'callback' => 'yardSecApiAuto'),
        array('method' => 'POST', 'endpoint' => 'test', 'callback' => 'yardSecApiTest'),
        array('method' => 'GET', 'endpoint' => 'presets', 'callback' => 'yardSecApiPresets'),
        array('method' => 'GET', 'endpoint' => 'areanames', 'callback' => 'yardSecApiAreaNames'),
        array('method' => 'GET', 'endpoint' => 'broker', 'callback' => 'yardSecApiBrokerStatus'),
        array('method' => 'POST', 'endpoint' => 'broker/:action', 'callback' => 'yardSecApiBrokerAction'),
    );
    return $eps;
}

// GET /api/plugin/fpp-plugin-YardSecurity/status
function yardSecApiStatus()
{
    return json(yardSecDaemon(array('cmd' => 'status')));
}

// GET /api/plugin/fpp-plugin-YardSecurity/config  (passwords are never returned)
function yardSecApiGetConfig()
{
    $cfg = yardSecReadJson(yardSecDataDir() . '/config.json', array());
    $sec = yardSecReadJson(yardSecDataDir() . '/secrets.json', array());
    return json(array(
        'config' => (object) $cfg,
        'hasShowPassword' => !empty($sec['showPassword']),
        'hasMqttPassword' => !empty($sec['mqttPassword']),
    ));
}

// POST /api/plugin/fpp-plugin-YardSecurity/config
// Body: {"config": {...}, "showPassword": "..."?, "mqttPassword": "..."?}
// A password field that is missing or null is left as it is; "" clears it.
function yardSecApiSaveConfig()
{
    $body = yardSecBody();
    if (!isset($body['config']) || !is_array($body['config'])) {
        return json(array('ok' => false, 'error' => 'Missing config'));
    }
    $cfg = $body['config'];
    if (strlen(json_encode($cfg)) > 65536) {
        return json(array('ok' => false, 'error' => 'Settings are too large'));
    }
    if (isset($cfg['show']['host']) && $cfg['show']['host'] !== '' && !yardSecValidHost($cfg['show']['host'])) {
        return json(array('ok' => false, 'error' => 'The show player address should be a hostname or IP address'));
    }
    if (isset($cfg['mqtt']['host']) && $cfg['mqtt']['host'] !== '' && !yardSecValidHost($cfg['mqtt']['host'])) {
        return json(array('ok' => false, 'error' => 'The MQTT broker address should be a hostname or IP address'));
    }
    $dir = yardSecDataDir();
    $old = yardSecReadJson($dir . '/config.json', array());
    $sec = yardSecReadJson($dir . '/secrets.json', array());
    $secChanged = false;
    foreach (array('showPassword', 'mqttPassword') as $k) {
        if (array_key_exists($k, $body) && is_string($body[$k])) {
            $sec[$k] = $body[$k];
            $secChanged = true;
        }
    }
    if ($secChanged && !yardSecWriteJson($dir . '/secrets.json', $sec, 0600)) {
        return json(array('ok' => false, 'error' => 'Could not save the passwords in ' . $dir));
    }
    if (!yardSecWriteJson($dir . '/config.json', $cfg, 0644)) {
        return json(array('ok' => false, 'error' => 'Could not save the settings in ' . $dir));
    }

    $result = array('ok' => true);
    // If the built-in broker is on and its login changed, rewrite its password file.
    $oldUser = isset($old['mqtt']['username']) ? $old['mqtt']['username'] : 'yardsecurity';
    $newUser = isset($cfg['mqtt']['username']) ? $cfg['mqtt']['username'] : 'yardsecurity';
    $loginChanged = ($oldUser !== $newUser) || (array_key_exists('mqttPassword', $body) && is_string($body['mqttPassword']));
    if ($loginChanged && is_file('/etc/mosquitto/conf.d/fpp-plugin-YardSecurity.conf')) {
        $result['broker'] = yardSecBroker('enable');
    }
    yardSecDaemon(array('cmd' => 'reload'));
    return json($result);
}

function yardSecApiArm()
{
    return json(yardSecDaemon(array('cmd' => 'arm')));
}

function yardSecApiDisarm()
{
    return json(yardSecDaemon(array('cmd' => 'disarm')));
}

function yardSecApiAuto()
{
    return json(yardSecDaemon(array('cmd' => 'auto')));
}

// POST /api/plugin/fpp-plugin-YardSecurity/test  Body: {"area": "Driveway", "phase": "enter"|"exit"|"both"}
function yardSecApiTest()
{
    $b = yardSecBody();
    $phase = isset($b['phase']) && in_array($b['phase'], array('enter', 'exit', 'both')) ? $b['phase'] : 'both';
    return json(yardSecDaemon(array('cmd' => 'test', 'area' => isset($b['area']) ? (string) $b['area'] : '', 'phase' => $phase)));
}

// GET /api/plugin/fpp-plugin-YardSecurity/presets  -> the show player's Command Preset names
function yardSecApiPresets()
{
    $cfg = yardSecReadJson(yardSecDataDir() . '/config.json', array());
    $sec = yardSecReadJson(yardSecDataDir() . '/secrets.json', array());
    $host = isset($cfg['show']['host']) ? $cfg['show']['host'] : '';
    if (isset($_GET['host']) && yardSecValidHost($_GET['host'])) {
        $host = $_GET['host'];  // lets the page try an address before it is saved
    }
    if (!yardSecValidHost($host)) {
        return json(array('ok' => false, 'error' => 'Set the show player address first'));
    }
    $headers = "Accept: application/json\r\n";
    if (!empty($sec['showPassword'])) {
        $user = !empty($cfg['show']['username']) ? $cfg['show']['username'] : 'admin';
        $headers .= 'Authorization: Basic ' . base64_encode($user . ':' . $sec['showPassword']) . "\r\n";
    }
    $ctx = stream_context_create(array('http' => array('timeout' => 4, 'header' => $headers, 'ignore_errors' => true)));
    $raw = @file_get_contents('http://' . $host . '/api/commandPresets?names=true', false, $ctx);
    if ($raw === false) {
        return json(array('ok' => false, 'error' => 'Could not reach the show player at ' . $host));
    }
    $names = json_decode($raw, true);
    if (!is_array($names)) {
        return json(array('ok' => false, 'error' => 'The show player did not return a preset list (is the password needed?)'));
    }
    $out = array();
    foreach ($names as $n) {
        if (is_string($n)) {
            $out[] = $n;
        } elseif (is_array($n) && isset($n['name'])) {
            $out[] = (string) $n['name'];
        }
    }
    return json(array('ok' => true, 'presets' => $out));
}

// GET /api/plugin/fpp-plugin-YardSecurity/areanames  (for the "Test Area" command's list)
function yardSecApiAreaNames()
{
    $cfg = yardSecReadJson(yardSecDataDir() . '/config.json', array());
    $names = array();
    if (isset($cfg['areas']) && is_array($cfg['areas'])) {
        foreach ($cfg['areas'] as $a) {
            if (!empty($a['name'])) {
                $names[] = (string) $a['name'];
            }
        }
    }
    return json($names);
}

function yardSecApiBrokerStatus()
{
    return json(yardSecBroker('status'));
}

// POST /api/plugin/fpp-plugin-YardSecurity/broker/enable|disable
function yardSecApiBrokerAction()
{
    $action = params('action');
    if ($action !== 'enable' && $action !== 'disable') {
        return json(array('ok' => false, 'message' => 'Unknown action'));
    }
    $r = yardSecBroker($action);
    yardSecDaemon(array('cmd' => 'reload'));
    return json($r);
}
?>
