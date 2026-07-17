// Minimal in-memory per-IP rate limiter. No dependency, no persistence —
// good enough to stop a single public demo (running on the owner's own
// API keys) from being hammered into a huge bill. Not meant for a real
// multi-instance production deployment (state doesn't share across
// processes); fine for a single free-tier container.

function rateLimit({ windowMs = 60_000, max = 12 } = {}) {
  const hits = new Map(); // ip -> [timestamps]

  // Periodically drop stale entries so the map doesn't grow forever.
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [ip, timestamps] of hits) {
      const kept = timestamps.filter(t => t > cutoff);
      if (kept.length) hits.set(ip, kept);
      else hits.delete(ip);
    }
  }, windowMs).unref();

  return (req, res, next) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const cutoff = now - windowMs;
    const timestamps = (hits.get(ip) || []).filter(t => t > cutoff);

    if (timestamps.length >= max) {
      return res.status(429).json({ error: 'Too many requests — slow down a bit and try again in a minute.' });
    }

    timestamps.push(now);
    hits.set(ip, timestamps);
    next();
  };
}

module.exports = { rateLimit };
