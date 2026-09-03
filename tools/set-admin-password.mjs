/**
 * Set the lesson admin password.
 *
 *   npm run admin:password -- "your password"
 *
 * Writes a salted PBKDF2 hash to admin.config.json, never the password itself.
 * That file used to hold the password in plain text and Apache served it
 * happily at /admin.config.json - the .htaccess now refuses it, but a file that
 * leaks a hash instead of a password is a much smaller accident.
 *
 * The same hash is checked by both back ends: tools/serve.mjs (Node) and
 * admin/api/login.php (Apache), so either can host the admin page.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(ROOT, "admin.config.json");

export const ITERATIONS = 120000;

export function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(String(password), salt, ITERATIONS, 32, "sha256").toString("hex");
}

const password = process.argv.slice(2).join(" ").trim();

if (!password) {
  console.error('Usage: npm run admin:password -- "your password"');
  process.exit(1);
}
if (password.length < 8) {
  console.error("Use at least 8 characters.");
  process.exit(1);
}

const salt = crypto.randomBytes(16).toString("hex");
fs.writeFileSync(FILE, JSON.stringify({
  _comment: "Salted PBKDF2-SHA256 hash of the admin password. Never commit this file.",
  iterations: ITERATIONS,
  salt,
  hash: hashPassword(password, salt)
}, null, 2) + "\n");

console.log("Admin password set. admin.config.json now holds a hash, not the password.");
console.log("It is git-ignored, and .htaccess refuses to serve it.");
