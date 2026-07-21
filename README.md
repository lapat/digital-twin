---
title: Digital Twin
emoji: 🧠
colorFrom: purple
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# Digital Twin

**[🎙️ Talk (voice) →](https://djkyoko-digital-twin.hf.space/talk)** ·
**[💬 Text chat →](https://djkyoko-digital-twin.hf.space/brain)** ·
**[🗣️ Meeting room →](https://djkyoko-digital-twin.hf.space/meeting)**
([source for this Space](https://huggingface.co/spaces/djkyoko/digital-twin))

Build a talking AI clone of yourself (or anyone) from your own life transcripts —
text chat, a phone number, and a video avatar, all driven by one "brain"
built from real conversations.

Ships with fifteen working demo personas out of the box — **Richard Nixon,
Ronald Reagan, John F. Kennedy, FDR, Donald Trump, Will Rogers, Groucho
Marx, Charlie Chaplin, W.C. Fields, Louis Armstrong, Kurt Cobain, Gilda
Radner, Kanye West, Michael Jordan, and Albert Einstein** — each built
from public, on-the-record speeches or interviews, Wikipedia, and (twelve
of the fifteen — Louis Armstrong, Trump, and Einstein are text-only, the
latter two blocked by ElevenLabs' own voice-safety enforcement, not by
choice; see "Disclaimer" for real caveats on the recently-deceased and
living figures that *do* have a voice) a real cloned voice. No personal
data, no API keys required to try them.
Pick a persona from the dropdown on any page, or put two or more of them
in the **meeting room** and give them a topic to argue about with each
other. Fully responsive — works the same on a phone as a desktop.

```
npm install
npm start
```
Open `http://localhost:3000/brain` and pick a persona. No `.env` needed for
this — you only need keys for the pieces you turn on (see below).

## What this actually is

1. **Bee sync** (`scripts/sync-bee.js`) — pulls your own transcripts from a
   [Bee](https://bee.computer) wearable into `personas/<you>/transcripts/`.
   Don't have a Bee? Any speech-to-text tool works — see
   `personas/me.example/README.md` for the file format.
2. **The Brain** (`lib/promptBuilder.js` + `lib/search.js`) — turns those
   transcripts into a system prompt: recent conversations become memory,
   your own sentences become voice examples, and an optional
   "opinion graph" (`scripts/extract-opinions.js`) keeps the persona from
   drifting into a generic helpful-chatbot voice over a long conversation.
3. **Text chat** — `/brain`, talks to the Gemini-powered brain directly.
   Pick which persona from the dropdown — `lib/personaRegistry.js` loads
   every persona under `personas/` at startup, so one deployment serves
   all of them, not just one.
4. **Voice chat** ([ElevenLabs](https://elevenlabs.io)) — `/talk`, type or
   click the mic and talk, hear the persona's real voice reply. Twelve of
   the fifteen bundled personas ship a real cloned voice — see "ElevenLabs"
   below.
5. **Meeting room** (`lib/meetingRoom.js`) — `/meeting`, pick 2+ personas
   and a topic, and they take turns responding to *each other* out loud,
   in their own real voices, not just to you. The prompt explicitly tells
   each persona to react naturally to what was just said — a quick
   agreement, a pushback, cutting in with "well, hold on—" — driven by the
   model's own judgment of the moment, not a scripted pattern. Audio
   playback finishing is what paces the turns (a real gap between lines,
   not a fixed timer). You can interject at any point — type something and
   the next speaker responds to you directly. Capped at a fixed number of
   turns (`MEETING_MAX_TURNS`, default 8) as a hard cost ceiling
   (interjections are free — only persona turns count against the cap).
6. **Phone number** (`lib/twilio.js`) — text or call a Twilio number and get
   the same brain, over SMS/WhatsApp or a live voice call. Bound to one
   persona (a phone number is one identity) via `PERSONA`.
7. **Video avatar** ([Tavus](https://tavus.io)) — `/` embeds a live video
   conversation with a talking avatar, using your persona's system prompt.
   Optional — everything else works without it.

## Setup

Copy `.env.example` to `.env` and fill in only the keys for what you want:

| Feature | Required env vars |
|---|---|
| Text chat (`/brain`) | `GOOGLE_API_KEY` |
| Voice chat (`/talk`) | above + `ELEVENLABS_API_KEY` (+ `ELEVENLABS_VOICE_ID` if the persona doesn't ship its own) |
| Video avatar (Tavus) | `GOOGLE_API_KEY`, `TAVUS_API_KEY`, `TAVUS_FACE_ID` |
| Phone texting | `GOOGLE_API_KEY` + `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` |
| Phone calls | above + `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `PUBLIC_URL` |

### Gemini (the brain)
[Google AI Studio](https://aistudio.google.com/apikey) → create a key → `GOOGLE_API_KEY`.

### ElevenLabs (voice chat)
[elevenlabs.io/app/settings/api-keys](https://elevenlabs.io/app/settings/api-keys) → create a key → `ELEVENLABS_API_KEY`.
That alone is enough for twelve of the fifteen bundled personas — each ships a
`voice.voiceId` in its `persona.json` pointing at a voice cloned in the
original template author's ElevenLabs account. **You won't have access to
those specific voices** unless you're deploying under that same account —
for your own persona (or your own copy of one of these), clone your own
voice or pick one from ElevenLabs' shared Voice Library, then set
`ELEVENLABS_VOICE_ID_<PERSONAID>` (e.g. `ELEVENLABS_VOICE_ID_REAGAN`) to
override what that persona suggests.

### Tavus (video avatar)
1. Sign up at [platform.tavus.io](https://platform.tavus.io) — the free tier
   gives 25 conversation minutes/month, enough to try this. Set `TAVUS_API_KEY`.
2. Pick a `TAVUS_FACE_ID` — one of Tavus's stock faces works to start; a
   custom face (your own) requires their Starter plan.
3. That's it — `POST /api/avatar/start` creates a persona ("PAL") from your
   brain's system prompt on first use and returns a `conversation_url` the
   frontend embeds directly. No client SDK, no bundler.
4. Note: the video avatar's brain is a **static** snapshot of your prompt
   taken when the PAL is created (set `TAVUS_PAL_ID` after the first run to
   reuse it) — it doesn't do live per-message transcript search the way
   `/brain` and the phone number do. That's a real gap, documented rather
   than hidden; wiring Tavus's [custom-LLM mode](https://docs.tavus.io) to
   your own `/api/chat` would close it.

### Twilio (phone number)
For quick personal testing, a [WhatsApp Sandbox](https://www.twilio.com/docs/whatsapp/sandbox)
number works instantly — but it expires every 3 days and only reaches people
who've manually sent it a join code. For a real, permanent number, Twilio
requires [A2P 10DLC registration](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/quickstart)
(brand + campaign approval, currently 10-15 days). Point your Twilio number's
webhook at `https://your-deployed-url/twilio/sms` (and `/twilio/incoming` for
voice).

### Bee (your own data)
```
npm install -g @beeai/cli
bee login --qr        # scan with the Bee app
bee proxy &            # starts a local proxy at 127.0.0.1:8787
PERSONA=me npm run sync-bee
```
This only ever talks to your own logged-in Bee session — see
`personas/me.example/README.md` for the full walkthrough, including how to
build a persona without a Bee at all.

## Building your own persona

```
cp -r personas/me.example personas/me
# fill in personas/me/persona.json and personas/me/transcripts/
PERSONA=me npm start
```

Full instructions: `personas/me.example/README.md`.

## Adding another public figure

This is exactly how the Nixon, Reagan, Kennedy, FDR, and Trump demos were
built — reusable for any U.S. president, and adaptable to other public
figures with a different transcript source. All five load automatically
at startup; there's no config step to "enable" a new one beyond dropping
it under `personas/`.

1. **Get real transcripts of things they actually said.** For any U.S.
   president, [presidency.ucsb.edu](https://www.presidency.ucsb.edu/advanced-search)
   has the full text of essentially every speech and press conference.
   Find a few URLs, add an entry to `SOURCES_BY_PERSONA` in
   `scripts/scrape-presidency.js`, then run:
   ```
   node scripts/scrape-presidency.js <persona-id>
   ```
   The same `field-docs-content` scraper worked unmodified across all
   four — a 1940 FDR radio address and a 1987 Reagan speech parse
   identically. For a non-president public figure, the equivalent move
   is finding *any* source of real, on-the-record transcripts (interviews,
   official remarks, congressional testimony) and writing a similarly
   small scraper — the rest of the pipeline doesn't care where the text
   came from, only that it's in the `OVERVIEW`/`TRANSCRIPT` format
   documented in `personas/me.example/README.md`.
2. **Build a biographical profile:**
   ```
   node scripts/build-profile-from-wikipedia.js <persona-id> "<Wikipedia Page Title>"
   ```
3. **Hand-write the voice** in `personas/<persona-id>/persona.json`
   (`mode: "scripted"`) — speech patterns, positions, emotional texture,
   format rules. Compare `personas/nixon/persona.json`,
   `personas/reagan/persona.json`, `personas/kennedy/persona.json`, and
   `personas/fdr/persona.json` for the shape; an LLM can draft a first
   pass from the profile.json fields, but a human pass to make it sound
   *right* is worth doing.
4. **(Optional) Clone a real voice** — see "ElevenLabs" above for the
   mechanism; see "Disclaimer" below for whether you should, especially
   for a living person.
5. **Test with text first** (`PERSONA=<persona-id> npm start`, then
   `/brain`) before wiring up voice or video.

A note on judgment: this works for any public figure whose own public
statements you're quoting/paraphrasing back through an LLM — it's not a
tool for putting words in someone's mouth they never said, and it's a
different (higher) bar for a living person than a historical one. See
"Disclaimer" below.

## Free hosting

**Option A — let people run their own copy (recommended, zero cost to you,
scales to any number of users):** deploy to Railway/Render/Fly.io and have
each visitor plug in their own API keys. Nobody's usage ever touches your
quota or your wallet.

**Option B — host one live no-setup demo yourself** (e.g. to show off the
bundled personas): this repo is Docker-ready for
[Hugging Face Spaces](https://huggingface.co/spaces). Note: Docker Spaces
currently require HF's Pro plan (~$9/mo) to run on `cpu-basic` — only
*Static* Spaces (no server) are free, which doesn't work for this app.
Also worth knowing: Pro appears to cap how many Docker Spaces can build
*concurrently* — if you're deploying more than one Space at a time and
builds seem to hang, that's very likely why.

1. Create a new Space → SDK: **Docker** → point it at this repo (or push
   this repo's contents to the Space's own git remote — the `Dockerfile`
   and README frontmatter at the top of this file are already set up for it).
2. In the Space's Settings → **Repository secrets**, add `GOOGLE_API_KEY`
   (required), `ELEVENLABS_API_KEY` (for voice), and, if you want video,
   `TAVUS_API_KEY` + `TAVUS_FACE_ID`.
3. That's it — the Space builds the `Dockerfile` and serves every bundled
   persona at once: `/brain` (text), `/talk` (voice), `/meeting`
   (personas talking to each other), and `/` (video, if Tavus keys are set).

Because this is now *your* keys serving *anyone* who visits, safeguards
are already built in:
- **Per-(persona, visitor) conversation history** (`sessionId`-keyed, not
  global) — so strangers' conversations never bleed into each other, and
  switching personas mid-visit doesn't mix conversations either.
- **Rate limiting**, per IP — `RATE_LIMIT_PER_MIN` (chat, default 12/min),
  `SPEAK_RATE_LIMIT_PER_MIN` (voice, default 12/min), `AVATAR_RATE_LIMIT_PER_MIN`
  (Tavus video, default 3/min), `MEETING_START_RATE_LIMIT_PER_MIN` (default
  4/min — caps how many meetings someone can spin up),
  `MEETING_NEXT_RATE_LIMIT_PER_MIN` (default 30/min — a meeting is already
  hard-capped at `MEETING_MAX_TURNS` turns, so this just needs to comfortably
  clear that per meeting). Tune via Space secrets if you need to. These are
  simple in-memory limiters (per container, not distributed) — enough to
  stop one bad actor or a traffic spike from running up your bill, not a
  substitute for real auth if you expect heavy traffic.

## Testing

```
npm test
```

Runs against all fifteen bundled personas and a synthetic example persona —
no API keys, no network calls. Covers persona loading (`lib/personaRegistry.js`),
prompt assembly (both "scripted" and "derived" persona modes), keyword/temporal
transcript search, rate limiting, meeting-room setup validation, and a guard
test that fails the build if any file in the repo contains a hardcoded API
key shape. This is what CI runs on every push.

Separately, after deploying (e.g. to a Hugging Face Space), verify the
real thing actually works end to end — not just that it built:

```
node scripts/smoke-check.js https://your-deployed-url
```

This hits the live URL for real: loads the persona, gets a real streamed
reply from Gemini, checks that two different sessions don't see each
other's history, and checks that rate limiting actually blocks a burst of
requests. It costs a real API call, so it's not part of `npm test`/CI —
run it by hand after every deploy.

## Disclaimer

This project lets you build a voice/likeness clone of a real person and
put it on the phone or video. Four different cases, four escalating bars —
**read the fourth one before you assume the bundled roster is a safe
default to copy.**

- **Yourself, or someone who's clearly and knowingly consented** — the
  main use case this template is built for. Go ahead.
- **A historical figure, safely removed from any active estate, from
  their own public record** — Nixon, Reagan, Kennedy, FDR, Will Rogers,
  Groucho Marx, Charlie Chaplin, and W.C. Fields: decades gone, no one
  actively enforcing rights over their likeness, built from their own
  on-the-record speeches/interviews for text and a voice clone built from
  their own real recordings. Louis Armstrong is in this same low-risk
  tier but text-only (no clean source audio was found). Einstein is also
  historically low-risk but ended up text-only for an unrelated reason —
  see the ElevenLabs safety-enforcement note below.
- **A recently-deceased figure with an active estate — Kurt Cobain and
  Gilda Radner, both with real voice clones, included as an explicit,
  informed choice by this repo's author, not a default recommendation.**
  Cobain died in 1994; California's postmortem right-of-publicity law runs
  70 years after death, his estate has actively protected his likeness
  before (blocking a planned hologram), and his recordings are
  label-owned copyrighted material, not public-domain government speeches
  like the presidents'. Radner died in 1989 and is a lower-profile case
  (no comparable estate enforcement history found), but the same
  postmortem right-of-publicity exposure applies in principle. Both are a
  materially different, higher-risk lane than the 70+-years-gone/
  no-active-estate bar most of the roster meets.
- **A living public figure — Kanye West and Michael Jordan, both with
  real voice clones, included as an explicit, informed choice by this
  repo's author, not a default recommendation and not legal advice that
  this is safe.** This is the highest-risk tier in this roster. Multiple
  state laws create real exposure for unauthorized voice cloning of a
  real, living person: Tennessee's ELVIS Act makes it a **criminal**
  offense, not just civil liability; California Civil Code 3344 and NY
  Civil Rights Law 50-51 are civil right-of-publicity statutes; a federal
  NO FAKES Act is pending. Each of these personas' `persona.json` includes
  an explicit disclaimer instructing the model that it isn't a real-time
  source of that person's current opinions, but that doesn't reduce the
  underlying voice-cloning exposure. If you're extending or redeploying
  this template, **this tier is the one to reconsider first**, not copy
  by default — it was a deliberate, informed call for this specific
  author's specific deployment, not a recommendation.

  **Donald Trump is text-only, not by this repo's choice but because
  ElevenLabs' own platform blocks it.** He was attempted at the same
  explicit, informed risk tolerance as Kanye/Jordan — the clone-creation
  API call succeeded, but the resulting voice was flagged post-creation
  with `safety_control: "ENTERPRISE_BAN"` and every real text-to-speech
  call against it returns HTTP 403. This confirms ElevenLabs' stated
  policy against cloning elected officials/political candidates is
  actually enforced, just asynchronously (after upload, not at it) rather
  than blocking the upload itself — worth knowing if you're relying on
  the platform to catch this for you at clone-creation time; it won't,
  it catches it afterward. Einstein hit a lighter version of the same
  enforcement (`ENTERPRISE_CAPTCHA` — a recognizable-identity flag, not
  specific to living people) and is text-only for the same reason: the
  clone exists but can't actually generate audio through a server-to-server
  API call.

If your own transcripts mention other people by name, be aware their
words may end up reflected in the persona's memory — review before
sharing anything you build with this widely.

## License

MIT — see `LICENSE`.
