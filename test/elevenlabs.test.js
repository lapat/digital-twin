const { test } = require('node:test');
const assert = require('node:assert/strict');
const { synthesize } = require('../lib/elevenlabs');

test('throws a clear error when ELEVENLABS_API_KEY is not set', async () => {
  const original = process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  try {
    await assert.rejects(() => synthesize('hello', 'some-voice-id'), /ELEVENLABS_API_KEY is not set/);
  } finally {
    if (original) process.env.ELEVENLABS_API_KEY = original;
  }
});

test('throws a clear error when no voiceId is given', async () => {
  const original = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = 'test-key-not-real';
  try {
    await assert.rejects(() => synthesize('hello', null), /No voice configured/);
  } finally {
    if (original) process.env.ELEVENLABS_API_KEY = original;
    else delete process.env.ELEVENLABS_API_KEY;
  }
});
