const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rateLimit } = require('../lib/rateLimit');

function mockReqRes(ip) {
  const req = { headers: {}, socket: { remoteAddress: ip } };
  let statusCode = 200;
  let body = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(payload) { body = payload; },
  };
  return { req, res, getStatus: () => statusCode, getBody: () => body };
}

test('allows requests under the limit', () => {
  const limiter = rateLimit({ windowMs: 60_000, max: 3 });
  const { req, res } = mockReqRes('1.2.3.4');
  let nextCalled = 0;
  for (let i = 0; i < 3; i++) limiter(req, res, () => nextCalled++);
  assert.equal(nextCalled, 3);
});

test('blocks the request once the limit is exceeded', () => {
  const limiter = rateLimit({ windowMs: 60_000, max: 2 });
  const { req, res, getStatus, getBody } = mockReqRes('5.6.7.8');
  let nextCalled = 0;
  limiter(req, res, () => nextCalled++);
  limiter(req, res, () => nextCalled++);
  limiter(req, res, () => nextCalled++); // third — should be blocked

  assert.equal(nextCalled, 2);
  assert.equal(getStatus(), 429);
  assert.match(getBody().error, /too many requests/i);
});

test('tracks different IPs independently', () => {
  const limiter = rateLimit({ windowMs: 60_000, max: 1 });
  const a = mockReqRes('10.0.0.1');
  const b = mockReqRes('10.0.0.2');
  let aCalled = 0, bCalled = 0;
  limiter(a.req, a.res, () => aCalled++);
  limiter(b.req, b.res, () => bCalled++);
  assert.equal(aCalled, 1);
  assert.equal(bCalled, 1);
});
