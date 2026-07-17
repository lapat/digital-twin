// Thin wrapper around ElevenLabs text-to-speech. Shared by the phone-call
// path (lib/twilio.js) and the browser voice-chat endpoint (server.js
// /api/speak) so there's one place that knows how to talk to ElevenLabs.

async function synthesize(text, voiceId, { model = 'eleven_flash_v2_5', voiceSettings } = {}) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not set — see .env.example');
  if (!voiceId) throw new Error('No voice configured for this persona — see personas/<id>/persona.json "voice" field, or set ELEVENLABS_VOICE_ID');

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: model,
      voice_settings: voiceSettings || { stability: 0.4, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs TTS failed: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

module.exports = { synthesize };
