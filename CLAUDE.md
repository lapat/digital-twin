# Digital Twin — Project Rules

## PROJECT IDENTITY — read this first

This is the **public** template project (GitHub `lapat/digital-twin`, HF
Space `djkyoko/digital-twin`) — 15 generic historical/celebrity personas, no
real personal data. It is a **separate, unrelated** project from
`vibe/digitaltwin` ("Lou's Assistant" — Louis's real private twin, real
transcripts, real voice clone, must stay private). If a session's cwd is
`vibe/digitaltwin` but the work is about personas/HF Space/`djkyoko`, that
work belongs here instead — don't touch this repo from that one's directory,
and don't let this repo's files/routes/memory bleed into that one. See that
project's CLAUDE.md for the reciprocal warning.


## HARD RULE: Keep Gemini token usage as cheap as possible — never trade cost for quality without saying so first

This app runs on a real API key, often on a public demo (see README "Free
hosting") where traffic isn't fully predictable. Every change touching an
LLM call must actively keep cost down, not just avoid making it worse:

- **Model tier**: chat uses `gemini-2.5-flash-lite` (the cheapest/fastest
  Gemini tier) via `CHAT_MODEL`. Don't upgrade the default to a pricier
  model without a specific reason — and if you do, gate it behind an env
  var so the default stays cheap.
- **`max_tokens` caps stay tight**: text chat defaults to 200
  (`persona.maxTokens`), phone calls to 80. These aren't arbitrary — a
  rambling reply costs more AND reads worse for this app's "1-3 sentences,
  say less not more" persona style. Tight caps here cost nothing in quality.
- **RAG stays narrow**: `lib/search.js` pulls only the top 2-3 relevant
  transcripts per message, not the whole corpus — keep it that way. If
  `maxMemoryFiles` (default 50) or a search `topN` ever needs to go up,
  do it per-persona in that persona's `persona.json`, not as a new global
  default.
- **One-off build scripts can use a fuller model** —
  `scripts/extract-opinions.js` and `scripts/build-profile-from-wikipedia.js`
  use `gemini-2.5-flash` because they run once per persona build, not per
  chat message. Don't let that model choice leak into the per-message chat
  path (`server.js`, `lib/twilio.js`) — those stay on the cheap tier.
- **Rate limiting stays on for any public deployment**
  (`RATE_LIMIT_PER_MIN`, `AVATAR_RATE_LIMIT_PER_MIN`) — this is the actual
  backstop against a cost blowup from a traffic spike or abuse, not a
  nice-to-have.
- Before adding any new LLM call to a per-message path (chat, SMS, voice),
  ask: does this need to run every message, or could it run once and get
  cached (the way the opinion graph does)?

If a real cost/quality tradeoff comes up, don't just silently optimize for
cheap — say what the tradeoff is and let the call be made explicitly.
