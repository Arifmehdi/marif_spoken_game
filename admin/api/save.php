<?php
/**
 * Write one lesson into data/lessons/.
 *
 * Everything here is deliberately narrow: signed in, a filename that can only
 * be day_NNN.json, and a body that must parse as a lesson. The filename is
 * rebuilt from digits rather than trusted, so no path can escape the folder.
 */
declare(strict_types=1);
require __DIR__ . '/config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') send(405, ['error' => 'POST only']);
if (!signedIn()) send(401, ['error' => 'Sign in first']);

$name = (string) ($_SERVER['HTTP_X_FILENAME'] ?? '');
if (!preg_match('~(?:^|/)day_(\d{1,4})\.json$~', $name, $m)) {
    send(400, ['error' => 'Only data/lessons/day_NNN.json can be written']);
}
$file = LESSON_DIR . '/day_' . str_pad($m[1], 3, '0', STR_PAD_LEFT) . '.json';

$raw = file_get_contents('php://input');
$lesson = json_decode((string) $raw, true);
if (!is_array($lesson) || empty($lesson['conversation']) || empty($lesson['lesson_id'])) {
    send(400, ['error' => 'That does not look like a lesson']);
}

if (!is_dir(LESSON_DIR) || !is_writable(LESSON_DIR)) {
    send(500, ['error' => 'data/lessons is not writable by the web server']);
}
if (file_put_contents($file, json_encode($lesson, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n") === false) {
    send(500, ['error' => 'Could not write the file']);
}

$built = rebuildManifest();
send(200, [
    'saved' => basename($file),
    'published' => $built['ok'],
    'buildOutput' => $built['ok']
        ? 'Manifest rebuilt from ' . $built['count'] . ' lesson files.'
        : implode('; ', $built['problems'])
]);
