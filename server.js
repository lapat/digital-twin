const express = require('express');
const path = require('path');

const gemini = require('./lib/gemini');
const tavus = require('./lib/avatar/tavus');
const { createTwilioRoutes } = require('./lib/twilio');
const { rateLimit } = require('./lib/rateLimit');
const elevenlabs = require('./lib/elevenlabs');
const { loadAllPersonas } = require('./lib/personaRegistry');
const meetingRoom = require('./lib/meetingRoom');

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.CHAT_MODEL || 'models/gemini-2.5-flash-lite';

console.log('\nLoading personas...');
const personas = loadAllPersonas(); // id -> { id, persona, dir, transcriptIndex, systemPrompt, voiceId }

if (personas.size === 0) {
  console.error('\nNo personas found under personas/. Build one — see README.md.\n');
  process.exit(1);
}

const DEFAULT_ID = personas.has(process.env.PERSONA) ? process.env.PERSONA
  : personas.has('nixon') ? 'nixon'
  : personas.keys().next().value;
console.log(`Default persona: ${DEFAULT_ID}\n`);

function requirePersona(req, res) {
  const id = req.body?.personaId || req.query?.personaId || DEFAULT_ID;
  const p = personas.get(id);
  if (!p) {
    res.status(400).json({ error: `Unknown personaId "${id}". See GET /api/personas.` });
    return null;
  }
  return p;
}

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false })); // Twilio sends form-encoded data
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/personas', (_req, res) => {
  res.json({
    defaultId: DEFAULT_ID,
    personas: [...personas.values()].map(p => ({
      id: p.id,
      displayName: p.persona.displayName,
      greeting: p.persona.greeting || 'Hey.',
      voiceAvailable: Boolean(p.voiceId && process.env.ELEVENLABS_API_KEY),
    })),
  });
});

// ── Text chat (used by public/brain.html) ──────────────────────────────────
// History is keyed per (persona, browser session) — so switching personas
// mid-visit doesn't mix conversations, and on a shared public demo,
// different visitors never see each other's history either.

const chatHistories = new Map(); // "personaId::sessionId" -> messages[]
const CHAT_RATE_LIMIT = rateLimit({ windowMs: 60_000, max: Number(process.env.RATE_LIMIT_PER_MIN) || 12 });

app.post('/api/chat', CHAT_RATE_LIMIT, async (req, res) => {
  const p = requirePersona(req, res);
  if (!p) return;
  const { message, sessionId = 'default' } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  const key = `${p.id}::${sessionId}`;
  const history = chatHistories.get(key) || [];
  history.push({ role: 'user', content: message });
  const relevant = p.transcriptIndex.search(message);
  const fullPrompt = p.systemPrompt + (relevant ? `\n\nRELEVANT CONTEXT FOR THIS QUESTION:\n${relevant}` : '');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const fullReply = await gemini.chatStream({
      model: MODEL,
      systemPrompt: fullPrompt,
      messages: history,
      maxTokens: p.persona.maxTokens || 200,
      onToken: token => res.write(`data: ${JSON.stringify({ token })}\n\n`),
    });
    history.push({ role: 'assistant', content: fullReply });
    if (history.length > 40) history.splice(0, 2);
    chatHistories.set(key, history);
    res.write(`data: ${JSON.stringify({ done: true, reply: fullReply })}\n\n`);
    res.end();
  } catch (err) {
    console.error('Chat error:', err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

app.get('/api/chat/reset', (req, res) => {
  const personaId = req.query.personaId || DEFAULT_ID;
  chatHistories.delete(`${personaId}::${req.query.sessionId || 'default'}`);
  res.json({ ok: true });
});

// ── Voice (ElevenLabs) — text-in/voice-out, and the TTS half of voice-in/
// voice-out (the browser does speech-to-text itself, for free, via the Web
// Speech API — see public/talk.html) ────────────────────────────────────────

const SPEAK_RATE_LIMIT = rateLimit({ windowMs: 60_000, max: Number(process.env.SPEAK_RATE_LIMIT_PER_MIN) || 12 });

app.post('/api/speak', SPEAK_RATE_LIMIT, async (req, res) => {
  const p = requirePersona(req, res);
  if (!p) return;
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  if (!p.voiceId || !process.env.ELEVENLABS_API_KEY) {
    return res.status(400).json({ error: `Voice not configured for "${p.id}" — set ELEVENLABS_API_KEY, and either a voice.voiceId in its persona.json or ELEVENLABS_VOICE_ID_${p.id.toUpperCase()}` });
  }
  try {
    const audio = await elevenlabs.synthesize(text, p.voiceId);
    res.set('Content-Type', 'audio/mpeg');
    res.send(audio);
  } catch (err) {
    console.error('Speak error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Video avatar (Tavus) ────────────────────────────────────────────────────

const AVATAR_RATE_LIMIT = rateLimit({ windowMs: 60_000, max: Number(process.env.AVATAR_RATE_LIMIT_PER_MIN) || 3 });
const tavusPalCache = new Map(); // personaId -> palId (created once, reused for the life of the process)

app.post('/api/avatar/start', AVATAR_RATE_LIMIT, async (req, res) => {
  const p = requirePersona(req, res);
  if (!p) return;
  if (!process.env.TAVUS_API_KEY) {
    return res.status(400).json({ error: 'TAVUS_API_KEY is not set — see .env.example' });
  }
  try {
    let palId = tavusPalCache.get(p.id);
    if (!palId) {
      palId = await tavus.createPal({
        name: p.persona.displayName,
        systemPrompt: p.systemPrompt,
        greeting: p.persona.greeting,
      });
      tavusPalCache.set(p.id, palId);
      console.log(`Created Tavus PAL ${palId} for "${p.id}" (cached for this process's lifetime).`);
    }
    const { conversationUrl, conversationId } = await tavus.createConversation({
      faceId: process.env.TAVUS_FACE_ID,
      palId,
    });
    res.json({ conversationUrl, conversationId });
  } catch (err) {
    console.error('Tavus start error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Meeting room — multiple personas discuss a topic, taking turns
// responding to each other, not just to you. ────────────────────────────────

// /start is rate-limited tightly (caps how many meetings someone can spin
// up). /next just advances an existing meeting, already hard-capped at
// MAX_TURNS total — a single meeting needs up to MAX_TURNS+1 requests, so
// this limit has to comfortably clear that or every real meeting gets cut
// off partway through.
const MEETING_START_RATE_LIMIT = rateLimit({ windowMs: 60_000, max: Number(process.env.MEETING_START_RATE_LIMIT_PER_MIN) || 4 });
const MEETING_NEXT_RATE_LIMIT = rateLimit({ windowMs: 60_000, max: Number(process.env.MEETING_NEXT_RATE_LIMIT_PER_MIN) || 30 });

app.post('/api/meeting/start', MEETING_START_RATE_LIMIT, (req, res) => {
  const { personaIds, topic } = req.body;
  if (!Array.isArray(personaIds) || personaIds.some(id => !personas.has(id))) {
    return res.status(400).json({ error: 'personaIds must be an array of known persona ids' });
  }
  try {
    const meetingId = meetingRoom.createMeeting({ participantIds: personaIds, topic });
    res.json({ meetingId, maxTurns: meetingRoom.MAX_TURNS });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/meeting/interject', MEETING_NEXT_RATE_LIMIT, (req, res) => {
  const { meetingId, text } = req.body;
  if (!meetingId || !text) return res.status(400).json({ error: 'meetingId and text required' });
  try {
    meetingRoom.interject(meetingId, text);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/meeting/next', MEETING_NEXT_RATE_LIMIT, async (req, res) => {
  const { meetingId } = req.body;
  if (!meetingId) return res.status(400).json({ error: 'meetingId required' });
  try {
    const turn = await meetingRoom.nextTurn(meetingId, personas, MODEL);
    res.json(turn);
  } catch (err) {
    console.error('Meeting turn error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// ── Phone (Twilio) — bound to one persona (a phone number is one identity);
// defaults to PERSONA / the first-loaded persona. ───────────────────────────

if (process.env.TWILIO_ACCOUNT_SID) {
  const dp = personas.get(DEFAULT_ID);
  createTwilioRoutes({
    app,
    systemPrompt: dp.systemPrompt,
    transcriptIndex: dp.transcriptIndex,
    greeting: dp.persona.greeting || 'Hey.',
    model: MODEL,
    voiceId: dp.voiceId,
  });
}

// ── Pages ─────────────────────────────────────────────────────────────────────

app.get('/brain', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'brain.html'));
});

app.get('/meeting', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'meeting.html'));
});

app.get('/talk', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'talk.html'));
});

app.listen(PORT, () => {
  console.log(`Personas:       ${[...personas.keys()].join(', ')}`);
  console.log(`Text chat:      http://localhost:${PORT}/brain`);
  console.log(`Voice chat:     http://localhost:${PORT}/talk`);
  console.log(`Meeting room:   http://localhost:${PORT}/meeting`);
  console.log(`Video (Tavus):  http://localhost:${PORT}\n`);
});
