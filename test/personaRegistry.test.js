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
  for (const id of ['nixon', 'reagan', 'kennedy', 'fdr', 'willrogers', 'groucho', 'chaplin', 'wcfields', 'cobain']) {
    assert.ok(registry.get(id).voiceId, `${id} should resolve a voiceId`);
  }
});

test('personas without a sourced voice ship text-only, no voice clone', () => {
  const registry = loadAllPersonas();
  for (const id of ['louisarmstrong', 'trump', 'gildaradner', 'kanyewest', 'michaeljordan', 'einstein']) {
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
