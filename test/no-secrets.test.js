// Guards against ever re-introducing a hardcoded credential (this repo's
// predecessor had several real keys committed directly in source files).
// Scans every tracked-type file in the repo for common API key shapes.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'public/audio']);

const SECRET_PATTERNS = [
  { name: 'ElevenLabs key', re: /sk_[a-f0-9]{40,}/i },
  { name: 'Google/Gemini key', re: /AIzaSy[A-Za-z0-9_-]{25,}/ },
  { name: 'Twilio Account SID', re: /AC[a-f0-9]{32}/i },
  { name: 'Twilio Auth Token literal assignment', re: /TWILIO_AUTH_TOKEN\s*[:=]\s*['"][a-f0-9]{32}['"]/i },
  { name: 'generic hex/uuid-shaped key literal', re: /(API_KEY|SECRET|TOKEN)\s*[:=]\s*['"][A-Za-z0-9-]{20,}['"]/ },
  { name: 'private key block', re: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/ },
];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.relative(ROOT, path.join(dir, entry.name));
    if ([...SKIP_DIRS].some(skip => rel === skip || rel.startsWith(skip + path.sep))) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

test('no file in the repo contains a hardcoded API key or secret', () => {
  const offenders = [];
  for (const file of walk(ROOT)) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue; // binary/unreadable — not a source of text-literal secrets
    }
    for (const { name, re } of SECRET_PATTERNS) {
      if (re.test(content)) offenders.push(`${name} in ${path.relative(ROOT, file)}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('.env is never committed (it must stay gitignored)', () => {
  const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.match(gitignore, /^\.env$/m);
  assert.equal(fs.existsSync(path.join(ROOT, '.env')), false);
});
