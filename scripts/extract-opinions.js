// One-time (re-runnable) pass: extracts an "opinion graph" — beliefs, values,
// recurring preoccupations, emotional signature — from a persona's
// transcripts. Output is consumed by lib/promptBuilder.js to build the
// persona-anchor block that keeps long conversations from drifting into a
// generic chatbot voice.
//
// Usage: PERSONA=me node scripts/extract-opinions.js

const fs = require('fs');
const path = require('path');

const PERSONA = process.env.PERSONA || 'me';
const PERSONA_DIR = path.join(__dirname, '..', 'personas', PERSONA);
const TRANSCRIPTS_DIR = path.join(PERSONA_DIR, 'transcripts');
const OUTPUT = path.join(PERSONA_DIR, 'opinions.json');
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

if (!GOOGLE_API_KEY) {
  console.error('GOOGLE_API_KEY is not set — see .env.example');
  process.exit(1);
}
if (!fs.existsSync(TRANSCRIPTS_DIR)) {
  console.error(`No transcripts found at ${TRANSCRIPTS_DIR}`);
  process.exit(1);
}

let personaConfig = {};
const configPath = path.join(PERSONA_DIR, 'persona.json');
if (fs.existsSync(configPath)) personaConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const displayName = personaConfig.displayName || PERSONA;
const speakerLabel = personaConfig.speakerLabel || displayName;

function extractSection(text, header) {
  const pattern = new RegExp(`${header}\\s*[-=]+\\s*([\\s\\S]+?)(?=\\n[A-Z][A-Z ]+\\s*[-=]+|$)`, 'i');
  const m = text.match(pattern);
  return m ? m[1].trim() : '';
}

function buildCondensed() {
  const files = fs.readdirSync(TRANSCRIPTS_DIR).filter(f => f.endsWith('.txt')).sort();
  return files.map(file => {
    const raw = fs.readFileSync(path.join(TRANSCRIPTS_DIR, file), 'utf8');
    const title = raw.split('\n')[0].trim();
    const dateM = raw.match(/^Date:\s*(.+)/m);
    const date = dateM ? dateM[1].trim() : '';
    const overview = extractSection(raw, 'OVERVIEW');
    const takeaways = extractSection(raw, 'KEY TAKEAWAYS');

    const speakerLines = [];
    for (const line of raw.split('\n')) {
      if (line.startsWith(`${speakerLabel}:`)) {
        const t = line.slice(speakerLabel.length + 1).trim();
        if (t.length > 60 && speakerLines.length < 3) speakerLines.push(`"${t}"`);
      }
    }

    const parts = [`[${date}] ${title}`];
    if (overview) parts.push(`Summary: ${overview.slice(0, 300)}`);
    if (takeaways) parts.push(`Key facts: ${takeaways.slice(0, 300)}`);
    if (speakerLines.length) parts.push(`They said: ${speakerLines.join(' | ')}`);
    return parts.join('\n');
  }).join('\n\n---\n\n');
}

async function extract() {
  const fileCount = fs.readdirSync(TRANSCRIPTS_DIR).filter(f => f.endsWith('.txt')).length;
  console.log(`Building condensed index from ${fileCount} transcripts...`);
  const condensed = buildCondensed();
  console.log(`Sending to Gemini for opinion extraction...\n`);

  const prompt = `You are analyzing personal conversation transcripts for ${displayName}. Extract a structured "opinion graph": who they are, what they believe, how they think.

${condensed}

Return this JSON structure:
{
  "opinions": [{"topic": "short label", "stance": "1-2 sentence position, specific not vague", "strength": 1-5, "category": "relationships|work|health|money|hobbies|philosophy|social|tech|other"}],
  "core_values": ["8-12 specific values consistently demonstrated"],
  "recurring_preoccupations": ["topics they return to unprompted across many conversations"],
  "how_they_argue": "2-3 sentences on rhetorical style",
  "emotional_signature": "2-3 sentences on what makes them animated, flat, defensive, or vulnerable",
  "things_that_annoy_them": ["specific things that reliably irritate them"],
  "things_they_light_up_about": ["specific things that make them genuinely excited"]
}

Rules: max 25 opinions, each stance under 100 chars, each list item under 60 chars. Return ONLY valid JSON, no markdown fences.`;

  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GOOGLE_API_KEY}` },
    body: JSON.stringify({
      model: 'models/gemini-2.5-flash',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 8000,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error('Gemini error:', JSON.stringify(data));
    process.exit(1);
  }

  const text = data.choices?.[0]?.message?.content || '';
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/) || text.match(/(\{[\s\S]+\})/);
  if (!jsonMatch) {
    console.error('Could not find JSON in response:\n', text.slice(0, 500));
    process.exit(1);
  }

  let opinions;
  try {
    opinions = JSON.parse(jsonMatch[1]);
  } catch (e) {
    console.error('JSON parse error:', e.message);
    fs.writeFileSync(OUTPUT + '.raw', text);
    process.exit(1);
  }

  opinions.extracted_at = new Date().toISOString();
  opinions.source_files = fileCount;
  fs.writeFileSync(OUTPUT, JSON.stringify(opinions, null, 2));

  console.log(`Done — ${opinions.opinions?.length || 0} opinions, ${opinions.core_values?.length || 0} core values.`);
  console.log(`Saved to: ${OUTPUT}`);
  console.log('Restart the server to load the new opinions into the prompt.');
}

extract().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
