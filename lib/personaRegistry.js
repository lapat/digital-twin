// Loads every persona under personas/ (except the me.example template) at
// startup, so one deployment can serve all of them with a persona picker
// instead of needing a separate deployment per persona.

const fs = require('fs');
const path = require('path');
const { TranscriptIndex } = require('./search');
const { buildSystemPrompt, loadPersona } = require('./promptBuilder');

const PERSONAS_DIR = path.join(__dirname, '..', 'personas');
const EXCLUDED = new Set(['me.example']);

function loadAllPersonas() {
  const registry = new Map(); // id -> { id, persona, dir, transcriptIndex, systemPrompt, voiceId }
  if (!fs.existsSync(PERSONAS_DIR)) return registry;

  const ids = fs.readdirSync(PERSONAS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && !EXCLUDED.has(d.name))
    .map(d => d.name)
    .filter(id => fs.existsSync(path.join(PERSONAS_DIR, id, 'persona.json')));

  for (const id of ids) {
    const dir = path.join(PERSONAS_DIR, id);
    try {
      const persona = loadPersona(dir);
      const transcriptIndex = new TranscriptIndex(path.join(dir, 'transcripts'));
      const systemPrompt = buildSystemPrompt(persona, dir, transcriptIndex);
      // A persona can suggest its own voice, but that voice may belong to
      // the original creator's ElevenLabs account — override per-persona
      // via ELEVENLABS_VOICE_ID_<ID> (e.g. ELEVENLABS_VOICE_ID_REAGAN).
      const voiceId = process.env[`ELEVENLABS_VOICE_ID_${id.toUpperCase()}`] || persona.voice?.voiceId || null;
      registry.set(id, { id, persona, dir, transcriptIndex, systemPrompt, voiceId });
      console.log(`  Loaded persona "${id}": ${persona.displayName} (${transcriptIndex.count()} transcripts)`);
    } catch (e) {
      console.warn(`  Skipping persona "${id}": ${e.message}`);
    }
  }
  return registry;
}

module.exports = { loadAllPersonas };
