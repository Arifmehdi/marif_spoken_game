<?php
/** Is this browser still signed in? Lets the page survive a reload. */
declare(strict_types=1);
require __DIR__ . '/config.php';
send(signedIn() ? 200 : 401, ['ok' => signedIn()]);
