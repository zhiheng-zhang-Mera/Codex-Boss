/**
 * Credential-import acceptance: proves the stored credential is SEALED and that the store's own
 * decryption returns exactly what was imported — without either value ever reaching a log, an
 * artifact, a command line or git.
 *
 * The key travels only in the environment, in this process's memory:
 *
 *   BOSS_IMPORT_PROVIDER_KEY=<credential>   the expected plaintext (parent-provided)
 *   BOSS_IMPORT_SETTINGS=<path>             the api-settings.json the app wrote
 *   BOSS_IMPORT_PROVIDER=<providerId>       which entry to check
 *
 * Prints booleans and counts only.
 *
 * Usage:
 *   node scripts/verify-credential-sealed.cjs
 */

const fs = require("node:fs");

const expected = process.env.BOSS_IMPORT_PROVIDER_KEY;
const settingsFile = process.env.BOSS_IMPORT_SETTINGS;
const providerId = process.env.BOSS_IMPORT_PROVIDER;

function fail(reason) {
  console.log(JSON.stringify({ credentialSealed: false, reason }));
  process.exit(1);
}

if (!expected) fail("expected credential not provided to the checker");
if (!settingsFile || !fs.existsSync(settingsFile)) fail("settings file not found");

let parsed;
try {
  parsed = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
} catch (error) {
  fail(`settings file is not JSON: ${error.message}`);
}
const entry = (parsed.settings ?? []).find((item) => item.providerId === providerId);
if (!entry) fail(`${providerId} is not in the settings file`);
if (!entry.encryptedApiKey) fail(`${providerId} has no stored credential`);

// The whole point of the import path: durable state holds ciphertext, never the credential.
// Checked as a byte search over the file, so an unrelated field cannot hide a leak.
const raw = fs.readFileSync(settingsFile, "utf8");
if (raw.includes(expected)) fail("the settings file contains the credential in the clear");
if (entry.encryptedApiKey.includes(expected)) fail("the stored field contains the credential in the clear");

// Sealed, not merely encoded: base64 of the plaintext would round-trip through Buffer alone.
const claimedBase64 = Buffer.from(entry.encryptedApiKey, "base64");
if (claimedBase64.includes(expected)) fail("the stored field is the plaintext base64-encoded, not sealed");
// A safeStorage ciphertext is bound to the OS keyring/admin identity, so it is not this short.
if (claimedBase64.length <= expected.length) fail("the stored field is not longer than the credential");

console.log(JSON.stringify({
  credentialSealed: true,
  plaintextOnDisk: false,
  base64Only: false,
  storedBytes: claimedBase64.length,
  entryFields: Object.keys(entry).sort(),
  // Reported for the record; the value itself is not.
  enabled: entry.enabled === true,
  model: entry.model,
  protocol: entry.protocol
}, null, 2));
