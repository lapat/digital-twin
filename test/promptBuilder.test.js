const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { TranscriptIndex } = require('../lib/search');
const { buildSystemPrompt, loadPersona } = require('../lib/promptBuilder');

const NIXON_DIR = path.join(__dirname, '..', 'personas', 'nixon');
const REAGAN_DIR = path.join(__dirname, '..', 'personas', 'reagan');
const KENNEDY_DIR = path.join(__dirname, '..', 'personas', 'kennedy');
const FDR_DIR = path.join(__dirname, '..', 'personas', 'fdr');
const EXAMPLE_DIR = path.join(__dirname, '..', 'personas', 'me.example');

test('loadPersona reads the bundled Nixon persona.json', () => {
  const persona = loadPersona(NIXON_DIR);
  assert.equal(persona.id, 'nixon');
  assert.equal(persona.mode, 'scripted');
  assert.ok(persona.systemPrompt.length > 100);
  assert.ok(persona.voice?.voiceId, 'expected a bundled voice.voiceId for the voice-chat demo');
});

test('scripted mode: prompt includes the hand-written systemPrompt verbatim', () => {
  const persona = loadPersona(NIXON_DIR);
  const index = new TranscriptIndex(path.join(NIXON_DIR, 'transcripts'));
  const prompt = buildSystemPrompt(persona, NIXON_DIR, index);
  assert.match(prompt, /You are Richard Nixon/);
  assert.match(prompt, /Watergate/);
});

test('scripted mode: prompt includes the profile.json block', () => {
  const persona = loadPersona(NIXON_DIR);
  const index = new TranscriptIndex(path.join(NIXON_DIR, 'transcripts'));
  const prompt = buildSystemPrompt(persona, NIXON_DIR, index);
  // profile.json has an early_life field — should show up rendered as "Early Life:"
  assert.match(prompt, /Early Life:/);
});

test('other bundled scripted personas load and build independently of each other', () => {
  for (const [dir, name] of [[REAGAN_DIR, 'Ronald Reagan'], [KENNEDY_DIR, 'John F. Kennedy'], [FDR_DIR, 'Franklin D. Roosevelt']]) {
    const persona = loadPersona(dir);
    assert.equal(persona.mode, 'scripted');
    const index = new TranscriptIndex(path.join(dir, 'transcripts'));
    const prompt = buildSystemPrompt(persona, dir, index);
    assert.match(prompt, new RegExp(`You are ${name}`));
    assert.doesNotMatch(prompt, /Richard Nixon/);
  }
});

test('derived mode: prompt is built from the example persona + transcripts', () => {
  const persona = loadPersona(EXAMPLE_DIR);
  assert.equal(persona.mode, 'derived');
  const index = new TranscriptIndex(path.join(EXAMPLE_DIR, 'transcripts'));
  assert.ok(index.count() >= 1);
  const prompt = buildSystemPrompt(persona, EXAMPLE_DIR, index);
  assert.match(prompt, /Your Name/); // displayName
  assert.match(prompt, /YOUR MEMORIES/);
  // voice example line pulled from the "YourName:" transcript lines
  assert.match(prompt, /this is just an example line/);
});

test('derived mode: banned words show up in the prompt', () => {
  const persona = loadPersona(EXAMPLE_DIR);
  const index = new TranscriptIndex(path.join(EXAMPLE_DIR, 'transcripts'));
  const prompt = buildSystemPrompt(persona, EXAMPLE_DIR, index);
  assert.match(prompt, /BANNED WORDS/);
  assert.match(prompt, /stoked/);
});
