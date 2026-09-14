<?php
/**
 * Change the admin password from the editor itself, so nobody needs shell
 * access to run `npm run admin:password`. Refuses unless the CURRENT
 * password is supplied and matches - being signed in already is not enough,
 * since a session can outlive the person who started it.
 */
declare(strict_types=1);
require __DIR__ . '/config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') send(405, ['error' => 'POST only']);
if (!signedIn()) send(401, ['error' => 'Sign in first']);

$data = body();
$current = (string) ($data['currentPassword'] ?? '');
$new     = (string) ($data['newPassword'] ?? '');

$env = getenv('ADMIN_PASSWORD');
if ($env !== false && $env !== '') {
    send(400, ['error' =>
        'The password is set by the ADMIN_PASSWORD environment variable on the server, not here. Change it there instead.']);
}

$check = checkPassword($current);
if (!$check['ok']) {
    usleep(300000);
    send(401, ['error' => 'Current password is wrong']);
}

if (strlen($new) < 8) send(400, ['error' => 'New password must be at least 8 characters']);

$salt = bin2hex(random_bytes(16));
$hash = hash_pbkdf2('sha256', $new, $salt, PBKDF2_ITERATIONS, 64);

$written = file_put_contents(CONFIG_FILE, json_encode([
    '_comment' => 'Salted PBKDF2-SHA256 hash of the admin password. Never commit this file.',
    'iterations' => PBKDF2_ITERATIONS,
    'salt' => $salt,
    'hash' => $hash
], JSON_PRETTY_PRINT) . "\n");

if ($written === false) {
    send(500, ['error' => 'Could not write admin.config.json - check the web server has write permission']);
}

send(200, ['ok' => true]);
