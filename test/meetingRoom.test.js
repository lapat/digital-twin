const { test } = require('node:test');
const assert = require('node:assert/strict');
const meetingRoom = require('../lib/meetingRoom');

test('createMeeting rejects fewer than 2 participants', () => {
  assert.throws(() => meetingRoom.createMeeting({ participantIds: ['nixon'], topic: 'x' }), /at least 2/);
});

test('createMeeting rejects a missing topic', () => {
  assert.throws(() => meetingRoom.createMeeting({ participantIds: ['nixon', 'reagan'], topic: '' }), /topic required/);
});

test('createMeeting returns a usable meetingId', () => {
  const id = meetingRoom.createMeeting({ participantIds: ['nixon', 'reagan'], topic: 'test topic' });
  assert.equal(typeof id, 'string');
  assert.ok(id.length > 10);
});

test('nextTurn throws on an unknown meetingId', async () => {
  await assert.rejects(() => meetingRoom.nextTurn('not-a-real-id', new Map(), 'model'), /Unknown or expired/);
});

test('MAX_TURNS is a positive number', () => {
  assert.ok(meetingRoom.MAX_TURNS > 0);
});

test('interject throws on an unknown meetingId', () => {
  assert.throws(() => meetingRoom.interject('not-a-real-id', 'hello'), /Unknown or expired/);
});

test('interject throws on missing text', () => {
  const id = meetingRoom.createMeeting({ participantIds: ['nixon', 'reagan'], topic: 'test topic' });
  assert.throws(() => meetingRoom.interject(id, ''), /text required/);
});

test('interject does not throw for a valid meeting + text', () => {
  const id = meetingRoom.createMeeting({ participantIds: ['nixon', 'reagan'], topic: 'test topic' });
  assert.doesNotThrow(() => meetingRoom.interject(id, 'what about the economy?'));
});

// Reproduces a real bug seen live: the model sometimes drifts into
// scripting BOTH speakers in one turn ("Franklin D. Roosevelt: ... John F.
// Kennedy: ...") despite the prompt telling it not to. sanitizeTurnText is
// the defense-in-depth backstop for when the prompt alone doesn't hold.
test('sanitizeTurnText strips a fabricated second speaker\'s dialogue', () => {
  const raw = 'Franklin D. Roosevelt: We must always remember the people. John F. Kennedy: That\'s true, Mr. President.';
  const cleaned = meetingRoom.sanitizeTurnText(raw, 'John F. Kennedy', ['Franklin D. Roosevelt']);
  assert.doesNotMatch(cleaned, /John F\. Kennedy:/);
  assert.doesNotMatch(cleaned, /We must always remember/);
});

test('sanitizeTurnText strips a leading self-name label', () => {
  const raw = 'Ronald Reagan: Well, there you go again.';
  const cleaned = meetingRoom.sanitizeTurnText(raw, 'Ronald Reagan', ['John F. Kennedy']);
  assert.equal(cleaned, 'Well, there you go again.');
});

test('sanitizeTurnText leaves clean text unchanged', () => {
  const raw = 'Well, there you go again.';
  const cleaned = meetingRoom.sanitizeTurnText(raw, 'Ronald Reagan', ['John F. Kennedy']);
  assert.equal(cleaned, raw);
});

// Reproduces a real bug seen live: with the halved per-turn token budget,
// a reply can get cut off mid-sentence ("...life itself is often a")
// instead of ending naturally — worse than just being shorter.
test('trimToLastCompleteSentence trims a mid-sentence cutoff back to the last full sentence', () => {
  const cut = 'Well, my friends, it seems we\'re here to discuss this. It\'s a word that carries weight, doesn\'t it? Whether it\'s a test of our resolve, life itself is often a';
  const trimmed = meetingRoom.trimToLastCompleteSentence(cut);
  assert.match(trimmed, /doesn't it\?$/);
  assert.doesNotMatch(trimmed, /often a$/);
});

test('trimToLastCompleteSentence leaves a complete sentence unchanged', () => {
  const complete = 'Well, there you go again.';
  assert.equal(meetingRoom.trimToLastCompleteSentence(complete), complete);
});

test('trimToLastCompleteSentence leaves text with no sentence boundary at all unchanged', () => {
  const noBoundary = 'well there you go again';
  assert.equal(meetingRoom.trimToLastCompleteSentence(noBoundary), noBoundary);
});
