// "Meeting room" — multiple personas discuss a topic the human poses,
// taking turns responding to each other (not just to the human). Each
// persona keeps its own systemPrompt/voice; a group-conversation framing
// block is layered on top so they're aware of who else is in the room
// and what's been said so far.

const crypto = require('node:crypto');
const gemini = require('./gemini');

const MAX_TURNS = Number(process.env.MEETING_MAX_TURNS) || 8; // cost cap — see CLAUDE.md
const MEETING_TTL_MS = 30 * 60 * 1000;

const meetings = new Map(); // meetingId -> { participantIds, topic, transcript, turnIndex, createdAt }

function cleanupStale() {
  const cutoff = Date.now() - MEETING_TTL_MS;
  for (const [id, m] of meetings) if (m.createdAt < cutoff) meetings.delete(id);
}

function createMeeting({ participantIds, topic }) {
  cleanupStale();
  if (!Array.isArray(participantIds) || participantIds.length < 2) {
    throw new Error('participantIds must include at least 2 personas');
  }
  if (!topic) throw new Error('topic required');

  const id = crypto.randomUUID();
  meetings.set(id, { participantIds, topic, transcript: [], turnIndex: 0, createdAt: Date.now() });
  return id;
}

function getMeeting(id) {
  const m = meetings.get(id);
  if (!m) throw new Error('Unknown or expired meetingId');
  return m;
}

function buildGroupPrompt(speakerEntry, otherNames, meeting) {
  const transcriptBlock = meeting.transcript.length
    ? meeting.transcript.map(t => `${t.speakerName}: ${t.text}`).join('\n')
    : '(nothing said yet)';

  const lastEntry = meeting.transcript[meeting.transcript.length - 1];
  const relevant = lastEntry
    ? speakerEntry.transcriptIndex.search(lastEntry.text)
    : speakerEntry.transcriptIndex.search(meeting.topic);

  // "You" (the human) can drop into the transcript mid-conversation — see
  // interject() below. If the very last line is from them, make sure the
  // next speaker actually addresses it rather than just continuing the
  // thread with whoever spoke before.
  const lastWasHuman = lastEntry?.speakerId === 'human';

  return speakerEntry.systemPrompt + `

GROUP CONVERSATION MODE:
You are in a roundtable with: ${otherNames.join(', ')}. A human moderator ("You" in the
transcript) posed the topic and may jump in with a comment or question at any point —
when they do, treat it like someone real speaking up in the room.
Topic: "${meeting.topic}"

Conversation so far:
${transcriptBlock}

Respond as the next speaker. React naturally to what was JUST said, the way a real
person in a live conversation would — that might mean a quick agreement ("that's a
fair point, but—"), a sharp pushback, cutting in with "well, hold on—" or "now wait a
minute," or picking up mid-thought rather than starting formally. Don't force this
into every turn — sometimes you just answer plainly. This has to come from your own
judgment of the moment, not a formula you repeat. Stay in your own voice and
positions.

CRITICAL FORMAT RULE: Output ONLY the words YOU are saying, this one turn, nothing
else. Do NOT write your own name or anyone else's name as a label (no "${speakerEntry.persona.displayName}:",
no "${otherNames[0] || 'Other'}:"). Do NOT write a line of dialogue for anyone else —
you are one speaker taking one turn, not scripting the whole exchange. Just the raw
spoken words, like the lines already shown above. Keep it SHORT: 1-2 sentences, never
more — shorter than you might default to, this is a fast back-and-forth, not a speech.` +
    (lastWasHuman ? `\n\nThe moderator just spoke directly — respond to THEM, not to whoever spoke before them.` : '') +
    (relevant ? `\n\nRELEVANT CONTEXT FROM YOUR OWN RECORD:\n${relevant}` : '');
}

// Defense in depth against the model drifting into scripting multiple
// speakers in one turn (observed live: it wrote a fabricated line for the
// OTHER persona first, then its own line after) despite the prompt telling
// it not to. Extract whatever follows this speaker's own label, wherever
// it appears in the text — that's their real line — then trim off anything
// after that which looks like another participant's label.
function sanitizeTurnText(text, speakerName, otherNames) {
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let cleaned = text.trim();

  const selfMatch = cleaned.match(new RegExp(`${esc(speakerName)}:\\s*([\\s\\S]*)`, 'i'));
  if (selfMatch) cleaned = selfMatch[1].trim();

  for (const name of otherNames) {
    const idx = cleaned.search(new RegExp(`${esc(name)}:`, 'i'));
    if (idx >= 0) cleaned = cleaned.slice(0, idx).trim();
  }

  cleaned = trimToLastCompleteSentence(cleaned);
  return cleaned || text.trim();
}

// The reduced per-turn token budget (see nextTurn) means a reply can get
// cut off mid-sentence instead of naturally ending — that reads worse than
// just "shorter." If the text doesn't end on terminal punctuation, trim
// back to the last sentence that does, rather than showing a dangling
// fragment. Leaves already-complete text untouched.
function trimToLastCompleteSentence(text) {
  if (/[.!?]["')\]]?\s*$/.test(text)) return text;
  const lastEnd = Math.max(text.lastIndexOf('. '), text.lastIndexOf('! '), text.lastIndexOf('? '));
  if (lastEnd > 0) return text.slice(0, lastEnd + 1).trim();
  return text; // no complete sentence found — better to show the fragment than nothing
}

// Drops a message from the human into the transcript mid-conversation
// without consuming a persona's turn — the next nextTurn() call will see
// it as the most recent line and (per buildGroupPrompt) respond to it
// directly.
function interject(meetingId, text) {
  const meeting = getMeeting(meetingId);
  if (!text) throw new Error('text required');
  meeting.transcript.push({ speakerId: 'human', speakerName: 'You', text });
}

// personaRegistry: the full Map from lib/personaRegistry.js (id -> entry)
async function nextTurn(meetingId, personaRegistry, model) {
  const meeting = getMeeting(meetingId);
  if (meeting.turnIndex >= MAX_TURNS) {
    return { done: true };
  }

  const speakerId = meeting.participantIds[meeting.turnIndex % meeting.participantIds.length];
  const speakerEntry = personaRegistry.get(speakerId);
  if (!speakerEntry) throw new Error(`Unknown personaId in meeting: ${speakerId}`);

  const otherNames = meeting.participantIds
    .filter(id => id !== speakerId)
    .map(id => personaRegistry.get(id)?.persona.displayName || id);

  const prompt = buildGroupPrompt(speakerEntry, otherNames, meeting);
  // Meeting turns are a fast back-and-forth, not a full chat reply — half
  // the persona's normal budget, both for pacing (shorter = quicker to
  // speak, per the request) and cost.
  const maxTokens = Math.max(40, Math.round((speakerEntry.persona.maxTokens || 130) * 0.5));
  const raw = await gemini.chat({
    model,
    systemPrompt: prompt,
    messages: [{ role: 'user', content: meeting.transcript.length ? 'Continue the conversation.' : `Kick off the discussion on: ${meeting.topic}` }],
    maxTokens,
  });
  const text = sanitizeTurnText(raw, speakerEntry.persona.displayName, otherNames);

  meeting.transcript.push({ speakerId, speakerName: speakerEntry.persona.displayName, text });
  meeting.turnIndex++;

  return {
    done: meeting.turnIndex >= MAX_TURNS,
    speakerId,
    speakerName: speakerEntry.persona.displayName,
    text,
    turnIndex: meeting.turnIndex,
    maxTurns: MAX_TURNS,
  };
}

module.exports = { createMeeting, nextTurn, interject, sanitizeTurnText, trimToLastCompleteSentence, MAX_TURNS };
