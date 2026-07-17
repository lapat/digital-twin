// Thin wrapper around Gemini's OpenAI-compatible chat completions endpoint.

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

function requireKey() {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new Error('GOOGLE_API_KEY is not set — see .env.example');
  return key;
}

async function chat({ model = 'models/gemini-2.5-flash-lite', systemPrompt, messages, maxTokens = 200 }) {
  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${requireKey()}` },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Gemini error ${res.status}`);
  return data.choices?.[0]?.message?.content?.trim() || '';
}

async function chatVision({ model = 'models/gemini-2.5-flash', content, maxTokens = 200 }) {
  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${requireKey()}` },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content }] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Gemini error ${res.status}`);
  return data.choices?.[0]?.message?.content?.trim() || '';
}

// Streams tokens via a callback; returns the full reply text once done.
async function chatStream({ model = 'models/gemini-2.5-flash-lite', systemPrompt, messages, maxTokens = 200, onToken }) {
  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${requireKey()}` },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      stream: true,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err);
  }

  let fullReply = '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        const token = parsed.choices?.[0]?.delta?.content || '';
        if (token) {
          fullReply += token;
          onToken?.(token);
        }
      } catch { /* ignore partial JSON chunks */ }
    }
  }
  return fullReply;
}

module.exports = { chat, chatVision, chatStream };
