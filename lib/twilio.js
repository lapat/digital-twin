// Generic Twilio SMS/WhatsApp + voice-call handlers. Persona-agnostic —
// takes a systemPrompt + transcriptIndex and drives Gemini the same way
// the browser chat does, just with per-phone-number history instead of a
// single session.

const fs = require('fs');
const path = require('path');
const gemini = require('./gemini');
const elevenlabs = require('./elevenlabs');

const SMS_STYLE_SUFFIX =
  '\n\nYou are responding via text message. Keep it short and casual like a real text — 1-2 sentences max. Text like a real person.';

function escapeXml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function twiml(...parts) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${parts.join('')}</Response>`;
}

function gather(action = '/twilio/respond') {
  return `<Gather input="speech" action="${action}" method="POST" speechTimeout="0.5" enhanced="true" language="en-US"></Gather>`;
}

function createTwilioRoutes({ app, systemPrompt, transcriptIndex, greeting, model, voiceId }) {
  const smsHistories = new Map(); // From number -> messages[]
  const callHistories = new Map(); // CallSid -> messages[]

  app.post('/twilio/sms', async (req, res) => {
    const from = req.body.From || '';
    const body = (req.body.Body || '').trim();

    const history = smsHistories.get(from) || [];
    history.push({ role: 'user', content: body });
    const relevant = transcriptIndex.search(body);

    let reply = 'hey';
    try {
      reply = await gemini.chat({
        model,
        systemPrompt: systemPrompt + (relevant ? `\n\nRELEVANT CONTEXT:\n${relevant}` : '') + SMS_STYLE_SUFFIX,
        messages: history,
      });
    } catch (err) {
      console.error('SMS respond error:', err.message);
    }

    history.push({ role: 'assistant', content: reply });
    if (history.length > 40) history.splice(0, 2);
    smsHistories.set(from, history);

    res.type('text/xml');
    res.send(twiml(`<Message>${escapeXml(reply)}</Message>`));
  });

  // Voice calls require ElevenLabs (for TTS) + PUBLIC_URL so Twilio can
  // fetch the generated audio back.
  if (process.env.ELEVENLABS_API_KEY && voiceId) {
    const AUDIO_DIR = path.join(__dirname, '..', 'public', 'audio');
    if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

    async function generateSpeech(text) {
      const audio = await elevenlabs.synthesize(text, voiceId, {
        voiceSettings: { stability: 0.3, similarity_boost: 0.8, style: 0.25, use_speaker_boost: false },
      });
      const filename = `${Date.now()}.mp3`;
      fs.writeFileSync(path.join(AUDIO_DIR, filename), audio);
      for (const f of fs.readdirSync(AUDIO_DIR)) {
        const fp = path.join(AUDIO_DIR, f);
        if (Date.now() - fs.statSync(fp).mtimeMs > 10 * 60 * 1000) fs.unlinkSync(fp);
      }
      return filename;
    }

    app.post('/twilio/incoming', async (req, res) => {
      const callSid = req.body.CallSid;
      callHistories.set(callSid, []);
      res.type('text/xml');

      const publicUrl = process.env.PUBLIC_URL;
      if (!publicUrl) {
        return res.send(twiml('<Say>Server not configured with a public URL. Set PUBLIC_URL.</Say>'));
      }

      try {
        const file = await generateSpeech(greeting);
        callHistories.get(callSid).push({ role: 'assistant', content: greeting });
        res.send(twiml(`<Play>${publicUrl}/audio/${file}</Play>`, gather(), '<Redirect method="POST">/twilio/incoming</Redirect>'));
      } catch (err) {
        console.error('Twilio incoming error:', err.message);
        res.send(twiml('<Say>Give me a sec.</Say>', gather()));
      }
    });

    app.post('/twilio/respond', async (req, res) => {
      const callSid = req.body.CallSid;
      const speech = (req.body.SpeechResult || '').trim();
      res.type('text/xml');

      const publicUrl = process.env.PUBLIC_URL;
      const history = callHistories.get(callSid) || [];
      if (!speech) return res.send(twiml(gather(), '<Redirect method="POST">/twilio/incoming</Redirect>'));

      history.push({ role: 'user', content: speech });
      try {
        const relevant = transcriptIndex.search(speech);
        const reply = await gemini.chat({
          model,
          maxTokens: 80,
          systemPrompt: systemPrompt + (relevant ? `\n\nRELEVANT CONTEXT:\n${relevant}` : ''),
          messages: history,
        });
        history.push({ role: 'assistant', content: reply });
        if (history.length > 40) history.splice(0, 2);
        callHistories.set(callSid, history);

        const file = await generateSpeech(reply);
        res.send(twiml(`<Play>${publicUrl}/audio/${file}</Play>`, gather(), '<Redirect method="POST">/twilio/incoming</Redirect>'));
      } catch (err) {
        console.error('Twilio respond error:', err.message);
        res.send(twiml('<Say>Hold on.</Say>', gather()));
      }
    });

    app.post('/twilio/status', (req, res) => {
      callHistories.delete(req.body.CallSid);
      res.sendStatus(200);
    });
  }
}

module.exports = { createTwilioRoutes };
