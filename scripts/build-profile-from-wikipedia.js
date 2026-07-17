// Builds personas/<id>/profile.json from one or more Wikipedia pages —
// this is how the bundled Nixon demo was built. Handy for any "scripted"
// persona of a public figure with a Wikipedia page; not useful for a
// "derived" persona built from your own transcripts (those don't need
// Wikipedia — opinions.json + the transcripts themselves cover that).
//
// Usage: node scripts/build-profile-from-wikipedia.js <persona-id> "<Wikipedia Page Title>" ["<Second Page Title>"]
// Example: node scripts/build-profile-from-wikipedia.js nixon "Richard Nixon" "Early life and career of Richard Nixon"

const fs = require('fs');
const path = require('path');

const [, , personaId, pageTitle, secondPageTitle] = process.argv;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

if (!personaId || !pageTitle) {
  console.error('Usage: node scripts/build-profile-from-wikipedia.js <persona-id> "<Wikipedia Page Title>" ["<Second Page Title>"]');
  process.exit(1);
}
if (!GOOGLE_API_KEY) {
  console.error('GOOGLE_API_KEY is not set — see .env.example');
  process.exit(1);
}

const OUT_DIR = path.join(__dirname, '..', 'personas', personaId);
const OUT_FILE = path.join(OUT_DIR, 'profile.json');

// Wikimedia's API etiquette policy rate-limits requests with no identifying
// User-Agent much more aggressively (429s) — a real UA is the actual fix,
// not just a retry.
const WIKI_USER_AGENT = 'digital-twin-template/1.0 (https://github.com/lapat/digital-twin; persona-builder script)';

async function fetchWikipedia(title) {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json`;
  const res = await fetch(url, { headers: { 'User-Agent': WIKI_USER_AGENT } });
  if (!res.ok) throw new Error(`Wikipedia API HTTP ${res.status} for "${title}"`);
  const data = await res.json();
  const raw = data.parse?.wikitext?.['*'] || '';
  if (!raw) return '';
  return raw
    .replace(/\[\[File:[^\]]+\]\]/gi, '')
    .replace(/\[\[Image:[^\]]+\]\]/gi, '')
    .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2')
    .replace(/\{\{[^}]+\}\}/g, '')
    .replace(/\{\|[\s\S]*?\|\}/g, '')
    .replace(/={2,6}([^=]+)={2,6}/g, '\n\n$1\n')
    .replace(/'''([^']+)'''/g, '$1')
    .replace(/''([^']+)''/g, '$1')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function run() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Fetching Wikipedia: ${pageTitle}...`);
  const main = await fetchWikipedia(pageTitle);
  console.log(`Got ${main.length} chars`);

  let extra = '';
  if (secondPageTitle) {
    console.log(`Fetching Wikipedia: ${secondPageTitle}...`);
    extra = await fetchWikipedia(secondPageTitle);
    console.log(`Got ${extra.length} chars`);
  }

  const combined = `${pageTitle.toUpperCase()} — WIKIPEDIA\n\n${main.slice(0, 40000)}` +
    (extra ? `\n\n${secondPageTitle.toUpperCase()}\n\n${extra.slice(0, 15000)}` : '');

  console.log('Running Gemini extraction...');
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GOOGLE_API_KEY}` },
    body: JSON.stringify({
      model: 'models/gemini-2.5-flash-lite',
      max_tokens: 6000,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are building a digital-twin persona of ${pageTitle}. Extract a rich, specific biographical/psychological profile as a flat JSON object. Use whatever field names make sense for this person (e.g. early_life, defining_wounds, core_personality, speech_patterns, relationship_with_press, contradictions, how_they_saw_themself) — string or array-of-string values. Be specific, not generic. Return ONLY valid JSON.`,
        },
        { role: 'user', content: `Based on this Wikipedia content, extract the profile:\n\n${combined}` },
      ],
    }),
  });

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || '{}';
  try {
    const profile = JSON.parse(raw);
    fs.writeFileSync(OUT_FILE, JSON.stringify(profile, null, 2));
    console.log(`\nSaved ${OUT_FILE}`);
    console.log('Fields extracted:', Object.keys(profile).join(', '));
  } catch (e) {
    console.error('JSON parse error:', e.message);
    fs.writeFileSync(OUT_FILE + '.raw', raw);
    console.log('Saved raw output to profile.json.raw — fix manually.');
  }
}

run().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
