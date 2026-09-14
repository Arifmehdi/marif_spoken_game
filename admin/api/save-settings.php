<?php
/**
 * Save game-wide settings (currently just lesson pacing) from the admin
 * panel's Settings modal to data/config/settings.json.
 */
declare(strict_types=1);
require __DIR__ . '/config.php';

const SETTINGS_FILE = PROJECT_ROOT . '/data/config/settings.json';
const VALID_PACING = ['free', 'daily'];

if ($_SERVER['REQUEST_METHOD'] !== 'POST') send(405, ['error' => 'POST only']);
if (!signedIn()) send(401, ['error' => 'Sign in first']);

$data = body();
$pacing = (string) ($data['pacing'] ?? '');
if (!in_array($pacing, VALID_PACING, true)) {
    send(400, ['error' => 'pacing must be "free" or "daily"']);
}

$written = file_put_contents(SETTINGS_FILE, json_encode([
    '_comment' => "Game-wide settings, changed from the Settings button in the admin panel. " .
        "pacing: 'free' lets a student play straight through to the next lesson the same day; " .
        "'daily' unlocks one new lesson per calendar day (finishing today's lesson still shows " .
        "the result, but the next one waits until tomorrow).",
    'pacing' => $pacing
], JSON_PRETTY_PRINT) . "\n");

if ($written === false) {
    send(500, ['error' => 'Could not write data/config/settings.json - check the web server has write permission']);
}

send(200, ['ok' => true, 'pacing' => $pacing]);
