<?php
/**
 * Restore all 30 standard lessons to their original text.
 *
 * data/lessons/defaults/day_NNN.json is an immutable snapshot taken when the
 * lesson set shipped. Admin edits only ever touch data/lessons/day_NNN.json,
 * so a mistake is never permanent - this copies every snapshot back over it.
 * Anything the admin created beyond the standard 30 has no snapshot and is
 * left alone.
 */
declare(strict_types=1);
require __DIR__ . '/config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') send(405, ['error' => 'POST only']);
if (!signedIn()) send(401, ['error' => 'Sign in first']);

$defaultsDir = LESSON_DIR . '/defaults';
if (!is_dir($defaultsDir)) send(500, ['error' => 'No default lessons are available to reset to']);
if (!is_dir(LESSON_DIR) || !is_writable(LESSON_DIR)) {
    send(500, ['error' => 'data/lessons is not writable by the web server']);
}

$restored = [];
foreach (glob($defaultsDir . '/day_*.json') ?: [] as $default) {
    $name = basename($default);
    if (copy($default, LESSON_DIR . '/' . $name)) $restored[] = $name;
}
if (!$restored) send(500, ['error' => 'Could not restore any lesson']);

$built = rebuildManifest();
send(200, [
    'restored' => $restored,
    'published' => $built['ok'],
    'buildOutput' => $built['ok']
        ? 'Manifest rebuilt from ' . $built['count'] . ' lesson files.'
        : implode('; ', $built['problems'])
]);
