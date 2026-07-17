# Building your own persona

This folder is a template — copy it to `personas/me/` (or any other name)
and fill it in. `personas/me/` is gitignored, so your real transcripts and
persona files never get committed.

```
cp -r personas/me.example personas/me
```

## 1. Get transcripts

**With a Bee (bee.computer):**
```
npm install -g @beeai/cli
bee login --qr
bee proxy &
PERSONA=me npm run sync-bee
```

**Without a Bee:** any speech-to-text transcript works, as long as each file
in `personas/me/transcripts/` follows this format:

```
Title of the conversation
Date: March 3, 2026

OVERVIEW
--------
One or two sentence summary of what this was about.

ATMOSPHERE
----------
Casual / tense / celebratory / etc. — the vibe of the conversation.

KEY TAKEAWAYS
-------------
- Bullet point facts worth remembering.

ACTION ITEMS
------------
- Anything left to follow up on.

TRANSCRIPT
----------
YourName: the actual words you said, one line per turn.
Other Person: what they said back.
```

Tools like Otter.ai, Whisper, or any podcast/voice-note transcriber can
produce the `TRANSCRIPT` section; you can write `OVERVIEW`/`ATMOSPHERE`/
`KEY TAKEAWAYS` by hand or ask an LLM to summarize each transcript into
those sections.

## 2. Write persona.json

Edit `persona.json` in this folder:

```json
{
  "id": "me",
  "displayName": "Your Name",
  "mode": "derived",
  "speakerLabel": "YourName",
  "styleNotes": "Two or three sentences describing how you talk — casual/formal, fast-talking, dry humor, whatever's true.",
  "bannedWords": ["stoked", "fascinating", "genuinely"],
  "greeting": "Hey — what's up?",
  "maxTokens": 200,
  "maxMemoryFiles": 50
}
```

`speakerLabel` must exactly match how you're labeled in the `TRANSCRIPT`
sections (e.g. `"YourName:"`).

## 3. (Optional) Extract an opinion graph

Deepens the persona with actual beliefs/values pulled from your transcripts,
used to anchor tone across long conversations:

```
PERSONA=me GOOGLE_API_KEY=... node scripts/extract-opinions.js
```

## 4. Run it

```
PERSONA=me npm start
```

Open `http://localhost:3000/brain` to chat over text first — that's the
fastest way to sanity-check the persona before wiring up voice/video/phone.
