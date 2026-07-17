// Pulls every conversation from your own Bee account (bee.computer) into
// personas/<PERSONA>/transcripts/ as Bee-format .txt files.
//
// This only ever talks to the LOCAL proxy started by the official Bee CLI,
// authenticated as YOU — it never scrapes anyone else's account. That's the
// only Bee access pattern documented as compliant with Bee's Terms of
// Service (bee.computer/terms) for third-party tools.
//
// Setup (one time):
//   npm install -g @beeai/cli
//   bee login --qr        # scan with the Bee iOS app (Developer Mode on)
//
// Each time you want fresh data:
//   bee proxy &            # starts the local proxy at 127.0.0.1:8787
//   npm run sync-bee        # (or: PERSONA=me node scripts/sync-bee.js)
//
// Don't have a Bee? Any audio transcription tool works — see
// personas/me.example/README.md for the file format to hand-produce instead.

const fs = require('fs');
const path = require('path');

const PERSONA = process.env.PERSONA || 'me';
const BEE_PROXY = process.env.BEE_PROXY_URL || 'http://127.0.0.1:8787';
const OUT_DIR = path.join(__dirname, '..', 'personas', PERSONA, 'transcripts');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return res.json();
}

function formatDate(ms) {
  return new Date(ms).toLocaleString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function parseSummary(markdown) {
  if (!markdown) return {};
  const sections = {};
  const current = { key: null, lines: [] };
  const flush = () => { if (current.key) sections[current.key] = current.lines.join('\n').trim(); };
  for (const line of markdown.split('\n')) {
    const header = line.match(/^##\s+(.+)/);
    if (header) { flush(); current.key = header[1].trim(); current.lines = []; }
    else current.lines.push(line);
  }
  flush();
  return sections;
}

function buildTranscript(transcriptions) {
  const utterances = (transcriptions || []).flatMap(t => t.utterances || []);
  utterances.sort((a, b) => a.spoken_at - b.spoken_at);
  return utterances
    .filter(u => u.text && u.text.trim())
    .map(u => `${u.speaker || 'Unknown'}: ${u.text.trim()}`)
    .join('\n');
}

function conversationToText(conv) {
  const sections = parseSummary(conv.summary);
  const date = formatDate(conv.start_time);
  const location = conv.primary_location?.address || '';
  const title = conv.short_summary || `Conversation ${conv.id}`;
  const transcript = buildTranscript(conv.transcriptions);

  const lines = [title, `Date: ${date}`];
  if (location) lines.push(`Location: ${location}`);
  lines.push('');

  if (sections['Summary']) lines.push('OVERVIEW', '--------', sections['Summary'], '');
  if (sections['Atmosphere']) lines.push('ATMOSPHERE', '----------', sections['Atmosphere'], '');
  const takeaways = sections['Key Take aways'] || sections['Key Takeaways'] || sections['Key takeaways'];
  if (takeaways) lines.push('KEY TAKEAWAYS', '-------------', takeaways, '');
  if (sections['Action Items']) lines.push('ACTION ITEMS', '------------', sections['Action Items'], '');
  if (transcript) lines.push('TRANSCRIPT', '----------', transcript);

  return lines.join('\n');
}

async function syncAll() {
  console.log(`Syncing Bee transcripts into personas/${PERSONA}/transcripts ...\n`);

  try {
    await fetchJSON(`${BEE_PROXY}/v1/me`);
  } catch {
    console.error(`Cannot reach Bee proxy at ${BEE_PROXY}. Is it running?\n  Run: bee proxy\n`);
    process.exit(1);
  }

  let cursor = null, total = 0, newCount = 0;
  while (true) {
    const url = cursor ? `${BEE_PROXY}/v1/conversations?limit=20&cursor=${cursor}` : `${BEE_PROXY}/v1/conversations?limit=20`;
    const data = await fetchJSON(url);
    const conversations = data.conversations || [];
    if (conversations.length === 0) break;

    for (const conv of conversations) {
      total++;
      const filepath = path.join(OUT_DIR, `${conv.id}.txt`);
      if (fs.existsSync(filepath)) { process.stdout.write('.'); continue; }
      try {
        const full = await fetchJSON(`${BEE_PROXY}/v1/conversations/${conv.id}`);
        fs.writeFileSync(filepath, conversationToText(full.conversation), 'utf8');
        newCount++;
        process.stdout.write(`\n  Saved: ${conv.short_summary || conv.id}`);
      } catch (err) {
        process.stdout.write(`\n  Error on ${conv.id}: ${err.message}`);
      }
    }
    cursor = data.next_cursor;
    if (!cursor) break;
  }

  console.log(`\n\nDone. ${newCount} new conversations saved (${total} total checked).`);
  console.log(`Files in: ${OUT_DIR}`);
  if (!fs.existsSync(path.join(__dirname, '..', 'personas', PERSONA, 'persona.json'))) {
    console.log(`\nNo persona.json yet for "${PERSONA}" — copy personas/me.example/persona.json and fill it in.`);
  }
}

syncAll().catch(err => {
  console.error('Sync failed:', err.message);
  process.exit(1);
});
