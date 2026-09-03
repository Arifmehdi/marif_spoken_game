<?php
/** Exchange the admin password for a signed-in session. */
declare(strict_types=1);
require __DIR__ . '/config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') send(405, ['error' => 'POST only']);

$given = (string) (body()['password'] ?? '');
$result = checkPassword($given);

if (!$result['ok']) {
    // Slow a guessing loop down without being noticeable to a person.
    usleep(300000);
    send(401, ['error' => $result['error'] ?? 'Wrong password']);
}

startSession();
session_regenerate_id(true);
$_SESSION['lesson_admin'] = true;
send(200, ['token' => session_id()]);
