// Turns a persona folder (persona.json + transcripts/ + optional profile.json
// + optional opinions.json) into a system prompt for the chat model.
//
// Two persona modes:
//   "scripted" — persona.json supplies a hand-written systemPrompt verbatim
//                (e.g. the bundled Nixon demo). Transcripts are only used
//                for RAG search, not prompt assembly.
//   "derived"  — the prompt is assembled FROM the transcripts: recent
//                summaries become "memories", lines spoken by
//                persona.speakerLabel become voice examples. This is the
//                path you use for your own Bee transcripts.

const fs = require('fs');
const path = require('path');
const { extractSection } = require('./search');

function titleCase(snake) {
  return snake.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Renders an arbitrary profile.json (any string/array-of-string fields) as
// a readable block. Works for any persona, not just one hardcoded shape.
function buildProfileBlock(personaDir) {
  const profilePath = path.join(personaDir, 'profile.json');
  if (!fs.existsSync(profilePath)) return '';
  try {
    const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    const lines = [];
    for (const [key, value] of Object.entries(profile)) {
      if (!value) continue;
      if (typeof value === 'string') lines.push(`${titleCase(key)}: ${value}`);
      else if (Array.isArray(value)) lines.push(`${titleCase(key)}: ${value.join(' | ')}`);
    }
    if (!lines.length) return '';
    return `BACKGROUND — biographical/psychological profile:\n${lines.join('\n')}`;
  } catch (e) {
    console.warn(`Could not load profile.json for ${personaDir}:`, e.message);
    return '';
  }
}

// Renders opinions.json (see scripts/extract-opinions.js) into a persona
// anchor (top-of-prompt anti-drift block) plus a fuller opinions block.
function buildOpinionsBlocks(personaDir, displayName) {
  const opinionsPath = path.join(personaDir, 'opinions.json');
  if (!fs.existsSync(opinionsPath)) return { anchor: '', block: '' };
  try {
    const op = JSON.parse(fs.readFileSync(opinionsPath, 'utf8'));

    const strongOpinions = (op.opinions || [])
      .filter(o => (o.strength || 0) >= 4)
      .slice(0, 6)
      .map(o => `- ${o.topic}: ${o.stance}`)
      .join('\n');
    const annoyances = (op.things_that_annoy_them || op.things_that_annoy_him || []).slice(0, 4).join(', ');
    const lightsUp = (op.things_they_light_up_about || op.things_he_lights_up_about || []).slice(0, 4).join(', ');

    const anchor = `PERSONA ANCHOR — read this before every response, no exceptions:
You are ${displayName}. Not an AI assistant. Not playing a character.
If you ever sound like a helpful chatbot, you have failed.

POSITIONS YOU HOLD — never soften, never hedge these away:
${strongOpinions || '(none extracted yet)'}

WHAT LIGHTS YOU UP: ${lightsUp}
WHAT PISSES YOU OFF: ${annoyances}

Default: 1-2 sentences. Only go longer when pulled. Say less, not more.
—`;

    const lines = [];
    if (op.opinions?.length) {
      lines.push('YOUR OPINIONS & BELIEFS (what you actually think — hold these positions):');
      for (const o of op.opinions) {
        const stars = '●'.repeat(o.strength || 3) + '○'.repeat(5 - (o.strength || 3));
        lines.push(`[${stars}] ${o.topic}: ${o.stance}`);
      }
    }
    if (op.core_values?.length) lines.push('\nYOUR CORE VALUES: ' + op.core_values.join(' | '));
    if (op.recurring_preoccupations?.length) lines.push('WHAT YOU OBSESS OVER: ' + op.recurring_preoccupations.join(', '));
    if (op.how_they_argue || op.how_he_argues) lines.push(`\nHOW YOU ARGUE: ${op.how_they_argue || op.how_he_argues}`);
    if (op.emotional_signature) lines.push(`YOUR EMOTIONAL TEXTURE: ${op.emotional_signature}`);
    if (annoyances) lines.push('WHAT ANNOYS YOU: ' + annoyances);
    if (lightsUp) lines.push('WHAT LIGHTS YOU UP: ' + lightsUp);

    return { anchor, block: lines.join('\n') };
  } catch (e) {
    console.warn(`Could not load opinions.json for ${personaDir}:`, e.message);
    return { anchor: '', block: '' };
  }
}

function buildRecentMemories(transcriptIndex, maxFiles) {
  const files = transcriptIndex.files().slice(-maxFiles);
  return files.map(f => {
    const overview = extractSection(f.raw, 'OVERVIEW');
    const atmosphere = extractSection(f.raw, 'ATMOSPHERE');
    const keyTakeaways = extractSection(f.raw, 'KEY TAKEAWAYS');
    const actionItems = extractSection(f.raw, 'ACTION ITEMS');
    return (
      `--- ${f.date}: ${f.title} ---\n` +
      (overview ? `Overview: ${overview}\n` : '') +
      (atmosphere ? `Atmosphere: ${atmosphere}\n` : '') +
      (keyTakeaways ? `Key facts:\n${keyTakeaways}\n` : '') +
      (actionItems ? `On their plate:\n${actionItems}\n` : '')
    );
  }).join('\n');
}

function buildVoiceExamples(transcriptIndex, speakerLabel, max = 20) {
  const lines = [];
  const prefix = `${speakerLabel}:`;
  for (const file of transcriptIndex.files()) {
    for (const line of file.raw.split('\n')) {
      if (line.startsWith(prefix)) {
        const text = line.slice(prefix.length).trim();
        if (text.length > 40) lines.push(text);
      }
    }
  }
  if (!lines.length) return '';
  const step = Math.max(1, Math.floor(lines.length / max));
  return lines.filter((_, i) => i % step === 0).slice(0, max).map(l => `"${l}"`).join('\n');
}

function buildScriptedPrompt(persona, personaDir) {
  const profileBlock = buildProfileBlock(personaDir);
  return [persona.systemPrompt, profileBlock].filter(Boolean).join('\n\n');
}

function buildDerivedPrompt(persona, personaDir, transcriptIndex) {
  const { anchor, block: opinionsBlock } = buildOpinionsBlocks(personaDir, persona.displayName);
  const memories = buildRecentMemories(transcriptIndex, persona.maxMemoryFiles || 50);
  const voiceExamples = persona.speakerLabel
    ? buildVoiceExamples(transcriptIndex, persona.speakerLabel)
    : '';
  const bannedWords = (persona.bannedWords || []).join('", "');

  return `${anchor}

You are ${persona.displayName}. Not playing them — you ARE them. ${persona.styleNotes || ''}

${voiceExamples ? `YOUR ACTUAL VOICE — real things you said, word for word. Match this rhythm and vocabulary:\n${voiceExamples}\n` : ''}
${bannedWords ? `BANNED WORDS — never say these: "${bannedWords}"\n` : ''}
${opinionsBlock}

YOUR MEMORIES — everything from your transcripts:
${memories}

INSTRUCTIONS:
- 1-3 sentences max. You're in a conversation, not giving a speech.
- Match the question's energy. Casual greeting = casual short answer.
- Only go deeper when they pull it out of you.
- Use the memory above to answer specific questions — but don't volunteer it unprompted.
- Incomplete thoughts are fine. Real people do that.
- When in doubt, say less.`;
}

// personaDir: absolute path to the persona's folder
// persona: parsed persona.json
// transcriptIndex: TranscriptIndex over personaDir/transcripts
function buildSystemPrompt(persona, personaDir, transcriptIndex) {
  if (persona.mode === 'scripted') return buildScriptedPrompt(persona, personaDir);
  return buildDerivedPrompt(persona, personaDir, transcriptIndex);
}

function loadPersona(personaDir) {
  const configPath = path.join(personaDir, 'persona.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(`No persona.json found in ${personaDir}`);
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

module.exports = { buildSystemPrompt, loadPersona, buildProfileBlock, buildOpinionsBlocks };
