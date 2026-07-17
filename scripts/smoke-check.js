// Live smoke test — hits an actual deployed instance (e.g. a Hugging Face
// Space) and checks the real end-to-end path: persona loads, the brain page
// serves, a real chat message gets a real streamed reply, and rate limiting
// actually kicks in. This is NOT part of `npm test` — it costs a real
// Gemini call and depends on a specific live URL being up, so it doesn't
// belong in CI for a template repo other people fork. Run it by hand (or in
// your own deployment's pipeline) after every deploy.
//
// Usage:
//   node scripts/smoke-check.js https://djkyoko-digital-twin.hf.space
//   node scripts/smoke-check.js                # defaults to http://localhost:3000

const BASE_URL = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');

let failures = 0;

function ok(label) {
  console.log(`  ok  ${label}`);
}
function fail(label, detail) {
  failures++;
  console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
}

async function checkPersonas() {
  const res = await fetch(`${BASE_URL}/api/personas`);
  if (!res.ok) return fail('GET /api/personas', `HTTP ${res.status}`);
  const data = await res.json();
  if (!data.defaultId || !data.personas?.length) return fail('GET /api/personas', 'no personas in response');
  ok(`GET /api/personas → ${data.personas.length} persona(s), default "${data.defaultId}"`);
  return data;
}

async function checkBrainPage() {
  const res = await fetch(`${BASE_URL}/brain`);
  if (!res.ok) return fail('GET /brain', `HTTP ${res.status}`);
  const html = await res.text();
  if (!html.includes('<html')) return fail('GET /brain', 'response is not HTML');
  ok('GET /brain → serves the chat UI');
}

async function checkTalkPage() {
  const res = await fetch(`${BASE_URL}/talk`);
  if (!res.ok) return fail('GET /talk', `HTTP ${res.status}`);
  ok('GET /talk → serves the voice chat UI');
}

// Only runs if the default persona actually has a voice configured — a
// deployment without ElevenLabs set up is a valid state, not a failure.
async function checkVoiceIfAvailable(personasData) {
  const def = personasData.personas.find(p => p.id === personasData.defaultId);
  if (!def?.voiceAvailable) {
    ok('POST /api/speak → skipped (default persona has no voice configured on this deployment)');
    return;
  }
  const res = await fetch(`${BASE_URL}/api/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Hello, this is a test.', personaId: personasData.defaultId }),
  });
  if (!res.ok) return fail('POST /api/speak', `HTTP ${res.status}`);
  if (res.headers.get('content-type') !== 'audio/mpeg') {
    return fail('POST /api/speak', `expected audio/mpeg, got ${res.headers.get('content-type')}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) return fail('POST /api/speak', `audio suspiciously small (${buf.length} bytes)`);
  ok(`POST /api/speak → got real audio (${buf.length} bytes)`);
}

async function readSSE(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullReply = '';
  let sawDone = false;
  let sawError = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = JSON.parse(line.slice(6));
      if (data.error) sawError = data.error;
      if (data.done) { sawDone = true; fullReply = data.reply; }
    }
  }
  return { sawDone, sawError, fullReply };
}

async function checkRealChatReply() {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Say the word "operational" and nothing else.', sessionId: `smoke-${Date.now()}` }),
  });
  if (!res.ok) return fail('POST /api/chat', `HTTP ${res.status}`);

  const { sawDone, sawError, fullReply } = await readSSE(res);
  if (sawError) return fail('POST /api/chat', `server returned an error: ${sawError}`);
  if (!sawDone) return fail('POST /api/chat', 'stream never sent a done event');
  if (!fullReply || !fullReply.trim()) return fail('POST /api/chat', 'reply was empty');
  ok(`POST /api/chat → got a real reply (${fullReply.length} chars): "${fullReply.slice(0, 80)}${fullReply.length > 80 ? '…' : ''}"`);
}

async function checkSessionIsolation() {
  const sessionA = `smoke-a-${Date.now()}`;
  const sessionB = `smoke-b-${Date.now()}`;

  const res1 = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Remember the codeword PINEAPPLE-42. Just reply "ok".', sessionId: sessionA }),
  });
  if (!res1.ok) return fail('session isolation setup', `HTTP ${res1.status}`);
  await readSSE(res1);

  const res2 = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'What codeword did I just give you? Answer in one word, or say "none" if you don\'t know.', sessionId: sessionB }),
  });
  if (!res2.ok) return fail('session isolation check', `HTTP ${res2.status}`);
  const { fullReply } = await readSSE(res2);

  if (fullReply.toUpperCase().includes('PINEAPPLE')) {
    return fail('session isolation', `session B saw session A's data: "${fullReply}"`);
  }
  ok('session isolation — a fresh sessionId does not see another session\'s history');
}

async function checkRateLimit() {
  // Default limit is 12/min — fire one over that from a burst of identical
  // requests and expect at least one 429 back. Uses the local dev server's
  // default; a live deployment may have a different RATE_LIMIT_PER_MIN, so
  // this just checks *that* limiting exists, not the exact threshold.
  const attempts = 20;
  const results = await Promise.all(
    Array.from({ length: attempts }, () =>
      fetch(`${BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'ping', sessionId: `smoke-rl-${Math.random()}` }),
      }).then(r => r.status).catch(() => null)
    )
  );
  const blocked = results.filter(s => s === 429).length;
  if (blocked === 0) {
    return fail('rate limiting', `sent ${attempts} rapid requests, none were blocked (429) — is RATE_LIMIT_PER_MIN disabled?`);
  }
  ok(`rate limiting — ${blocked}/${attempts} rapid requests correctly got 429`);
}

async function main() {
  console.log(`Smoke testing ${BASE_URL}\n`);
  const personasData = await checkPersonas();
  await checkBrainPage();
  await checkTalkPage();
  if (personasData) await checkVoiceIfAvailable(personasData);
  await checkRealChatReply();
  await checkSessionIsolation();
  await checkRateLimit();

  console.log();
  if (failures > 0) {
    console.error(`${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('All live checks passed.');
}

main().catch(err => {
  console.error('Smoke test crashed:', err.message);
  process.exit(1);
});
