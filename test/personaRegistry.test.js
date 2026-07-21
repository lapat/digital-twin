const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadAllPersonas } = require('../lib/personaRegistry');

test('loads every bundled persona and excludes the me.example template', () => {
  const registry = loadAllPersonas();
  const ids = [...registry.keys()].sort();
  assert.deepEqual(ids, [
    'chaplin', 'cobain', 'einstein', 'fdr', 'gildaradner', 'groucho',
    'kanyewest', 'kennedy', 'louisarmstrong', 'michaeljordan', 'nixon',
    'reagan', 'trump', 'wcfields', 'willrogers',
  ]);
});

test('each loaded persona has a non-empty system prompt and a transcript index', () => {
  const registry = loadAllPersonas();
  for (const [id, entry] of registry) {
    assert.ok(entry.systemPrompt.length > 100, `${id} has a real system prompt`);
    assert.ok(entry.transcriptIndex.count() > 0, `${id} has transcripts`);
  }
});

test('personas with a bundled voice resolve a voiceId', () => {
  const registry = loadAllPersonas();
  for (const id of [
    'nixon', 'reagan', 'kennedy', 'fdr', 'willrogers', 'groucho', 'chaplin',
    'wcfields', 'cobain', 'kanyewest', 'michaeljordan', 'gildaradner',
  ]) {
    assert.ok(registry.get(id).voiceId, `${id} should resolve a voiceId`);
  }
});

// Trump and Einstein are text-only not by choice but by ElevenLabs' own
// safety enforcement: their clones were created successfully but flagged
// post-creation (safety_control ENTERPRISE_BAN and ENTERPRISE_CAPTCHA
// respectively) — every real /api/speak call for them 500s. Shipping a
// voiceId that can never actually generate audio would be worse than
// text-only, so they stay unset here regardless of persona.json wiring.
test('personas without a usable voice ship text-only', () => {
  const registry = loadAllPersonas();
  for (const id of ['louisarmstrong', 'trump', 'einstein']) {
    assert.equal(registry.get(id).voiceId, null, `${id} should have no voiceId`);
  }
});

test('a per-persona env override wins over the bundled voiceId', () => {
  process.env.ELEVENLABS_VOICE_ID_NIXON = 'override-voice-id';
  try {
    const registry = loadAllPersonas();
    assert.equal(registry.get('nixon').voiceId, 'override-voice-id');
  } finally {
    delete process.env.ELEVENLABS_VOICE_ID_NIXON;
  }
});
