// Tavus Conversational Video Interface adapter.
// Docs: https://docs.tavus.io/api-reference/conversations/create-conversation
//
// Flow:
//   1. Create a PAL once (persona: system_prompt + context) — do this via
//      `npm run build-profile` output or the Tavus dashboard, then set
//      TAVUS_PAL_ID. This module can also create one on the fly if unset.
//   2. Create a conversation (pairs a face_id + pal_id) — returns a
//      conversation_url the frontend embeds directly in an <iframe>. Tavus
//      hosts the full audio/video/STT/TTS loop; no client SDK needed.

const TAVUS_BASE = 'https://tavusapi.com/v2';

function requireKey() {
  const key = process.env.TAVUS_API_KEY;
  if (!key) throw new Error('TAVUS_API_KEY is not set — see .env.example');
  return key;
}

async function tavusFetch(endpoint, options = {}) {
  const res = await fetch(`${TAVUS_BASE}${endpoint}`, {
    ...options,
    headers: {
      'x-api-key': requireKey(),
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `Tavus ${endpoint}: HTTP ${res.status}`);
  return data;
}

// Creates a reusable PAL (persona) from a system prompt. Returns pal_id.
async function createPal({ name, systemPrompt, context, greeting }) {
  const data = await tavusFetch('/pals', {
    method: 'POST',
    body: JSON.stringify({
      pal_name: name,
      system_prompt: systemPrompt,
      context: context || '',
      default_conversational_context: greeting || '',
    }),
  });
  return data.pal_id || data.id;
}

// Starts a live conversation session. Returns { conversationUrl, conversationId }.
async function createConversation({ faceId, palId, conversationalContext }) {
  const data = await tavusFetch('/conversations', {
    method: 'POST',
    body: JSON.stringify({
      face_id: faceId,
      pal_id: palId,
      ...(conversationalContext ? { conversational_context: conversationalContext } : {}),
    }),
  });
  return { conversationUrl: data.conversation_url, conversationId: data.conversation_id || data.id };
}

async function endConversation(conversationId) {
  await tavusFetch(`/conversations/${conversationId}/end`, { method: 'POST' });
}

module.exports = { createPal, createConversation, endConversation };
