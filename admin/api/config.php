<?php
/**
 * Shared setup for the admin endpoints, for hosting under Apache/Laragon.
 *
 * The Node dev server (tools/serve.mjs) answers exactly the same three paths,
 * so the admin page has one code path whichever server is in front of it.
 *
 * The password is never stored in the clear: admin.config.json holds a salted
 * PBKDF2-SHA256 hash written by `npm run admin:password`, and .htaccess refuses
 * to serve that file.
 */
declare(strict_types=1);

const PROJECT_ROOT = __DIR__ . '/../..';
const LESSON_DIR   = PROJECT_ROOT . '/data/lessons';
const CONFIG_FILE  = PROJECT_ROOT . '/admin.config.json';
const PBKDF2_ITERATIONS = 120000;

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

function send(int $status, array $body): void {
    http_response_code($status);
    echo json_encode($body);
    exit;
}

function body(): array {
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

/** Sessions hold the signed-in flag; the cookie is the token. */
function startSession(): void {
    if (session_status() === PHP_SESSION_ACTIVE) return;
    session_set_cookie_params([
        'httponly' => true,
        'samesite' => 'Strict',
        'secure'   => !empty($_SERVER['HTTPS']),
    ]);
    session_start();
}

function signedIn(): bool {
    startSession();
    return !empty($_SESSION['lesson_admin']);
}

/**
 * @return array{ok:bool,error?:string}  whether the given password matches
 */
function checkPassword(string $given): array {
    $env = getenv('ADMIN_PASSWORD');
    if ($env !== false && $env !== '') {
        return ['ok' => hash_equals($env, $given)];
    }

    if (!is_readable(CONFIG_FILE)) {
        return ['ok' => false, 'error' =>
            'No admin password is set. Run: npm run admin:password -- "your password"'];
    }

    $cfg = json_decode((string) file_get_contents(CONFIG_FILE), true);
    if (!is_array($cfg)) {
        return ['ok' => false, 'error' => 'admin.config.json is not valid JSON'];
    }

    if (!empty($cfg['hash']) && !empty($cfg['salt'])) {
        $iterations = (int) ($cfg['iterations'] ?? PBKDF2_ITERATIONS);
        $computed = hash_pbkdf2('sha256', $given, (string) $cfg['salt'], $iterations, 64);
        return ['ok' => hash_equals((string) $cfg['hash'], $computed)];
    }

    // Old plain-text format, still honoured so nobody is locked out.
    if (!empty($cfg['password'])) {
        return ['ok' => hash_equals((string) $cfg['password'], $given)];
    }

    return ['ok' => false, 'error' => 'admin.config.json has no password set'];
}

/**
 * Rebuild data/lessons/manifest.json from whatever day_*.json files are on
 * disk, so a lesson the admin just published or reset shows up in the game
 * right away. Mirrors tools/build-lessons.mjs, but best-effort: a malformed
 * file is skipped and reported rather than blocking every other lesson from
 * being listed - the admin page already validated the lesson it just wrote.
 *
 * @return array{ok:bool,count:int,problems:string[]}
 */
function rebuildManifest(): array {
    $problems = [];
    $lessons = [];

    foreach (glob(LESSON_DIR . '/day_*.json') ?: [] as $file) {
        $data = json_decode((string) file_get_contents($file), true);
        if (!is_array($data) || empty($data['lesson_id']) || !isset($data['day'], $data['conversation'])) {
            $problems[] = basename($file) . ' is not a valid lesson - skipped';
            continue;
        }
        $lessons[] = [
            'day' => (int) $data['day'],
            'file' => basename($file),
            'topic' => (string) ($data['topic'] ?? ''),
            'location' => (string) ($data['location'] ?? ''),
            'difficulty' => (string) ($data['difficulty'] ?? '')
        ];
    }

    if (!$lessons) return ['ok' => false, 'count' => 0, 'problems' => ['no day_*.json files found']];

    usort($lessons, fn($a, $b) => $a['day'] <=> $b['day']);
    $seen = [];
    foreach ($lessons as $l) {
        if (isset($seen[$l['day']])) $problems[] = 'two lessons both claim day ' . $l['day'];
        $seen[$l['day']] = true;
    }

    $manifest = [
        'version' => 1,
        'title' => 'Spoken English Adventure',
        'description' => 'Daily conversation lessons. Ten places, three levels each. ' .
            'Add a file here and the game picks it up - no code changes.',
        'lessons' => $lessons
    ];
    $written = file_put_contents(LESSON_DIR . '/manifest.json',
        json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n") !== false;

    return ['ok' => $written && !$problems, 'count' => count($lessons), 'problems' => $problems];
}
