import test from 'node:test';
import assert from 'node:assert/strict';
import { createResponseHeaderPolicy, applyResponseHeaderPolicy } from '../src/index.mjs';

test('defaults fill only absent headers and leave CSP/HSTS application-owned', () => {
  const original = new Headers({ 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(self)' });
  const output = createResponseHeaderPolicy().applyHeaders(original);
  for (const [name, value] of original) assert.equal(output.get(name), value);
  assert.equal(output.get('x-content-type-options'), 'nosniff');
  assert.equal(output.get('content-security-policy'), null);
  assert.equal(output.get('strict-transport-security'), null);
  assert.equal(original.get('x-content-type-options'), null);
});

test('the complete default baseline is deterministic', () => {
  assert.deepEqual(Object.fromEntries(createResponseHeaderPolicy().applyHeaders({})), {
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY',
  });
});

test('default preserves even empty existing values; it is not policy repair', () => {
  assert.equal(createResponseHeaderPolicy().applyHeaders({ 'x-frame-options': '' }).get('x-frame-options'), '');
});

test('application rules and per-call rules have explicit precedence', () => {
  const policy = createResponseHeaderPolicy({ headers: { 'X-Frame-Options': { action: 'enforce', value: 'SAMEORIGIN' } } });
  assert.equal(policy.applyHeaders({ 'x-frame-options': 'DENY' }).get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(policy.applyHeaders({}, { headers: { 'x-frame-options': { action: 'enforce', value: 'DENY' } } }).get('x-frame-options'), 'DENY');
  assert.equal(policy.applyHeaders({}).get('x-frame-options'), 'SAMEORIGIN');
});

test('a default override replaces the earlier rule, not merely its action', () => {
  const p = createResponseHeaderPolicy({ headers: { 'x-frame-options': { action: 'enforce', value: 'DENY' } } });
  assert.throws(() => p.applyHeaders({}, { headers: { 'x-frame-options': { action: 'default' } } }), /nonempty/);
});

test('skip retains existing values and suppresses missing defaults; remove deletes', () => {
  const policy = createResponseHeaderPolicy({ headers: { 'x-frame-options': { action: 'skip' }, 'permissions-policy': { action: 'remove' } } });
  const output = policy.applyHeaders({ 'x-frame-options': 'SAMEORIGIN', 'permissions-policy': 'camera=(self)' });
  assert.equal(output.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(output.get('permissions-policy'), null);
  assert.equal(policy.applyHeaders({}).get('x-frame-options'), null);
});

test('custom headers use the same four actions, without adding unrelated defaults when disabled', () => {
  const p = createResponseHeaderPolicy({ defaults: false, headers: { 'x-app-policy': { action: 'default', value: 'v1' } } });
  assert.deepEqual([...p.applyHeaders({})], [['x-app-policy', 'v1']]);
  assert.equal(p.applyHeaders({ 'x-app-policy': 'v2' }).get('x-app-policy'), 'v2');
  assert.equal(p.applyHeaders({}, { defaults: true }).get('x-frame-options'), 'DENY');
});

test('defaults=false per call removes built-ins but retains explicit application rules', () => {
  const p = createResponseHeaderPolicy({ headers: { 'x-app': { action: 'enforce', value: 'owned' } } });
  assert.deepEqual([...p.applyHeaders({}, { defaults: false })], [['x-app', 'owned']]);
});

test('caller mutations after compilation do not change a policy', () => {
  const options = { headers: { 'x-app': { action: 'enforce', value: 'first' } } };
  const p = createResponseHeaderPolicy(options);
  options.headers['x-app'].value = 'second';
  delete options.headers['x-app'];
  assert.equal(p.applyHeaders({}).get('x-app'), 'first');
  assert.ok(Object.isFrozen(p));
});

test('response calls have isolated header state', () => {
  const p = createResponseHeaderPolicy();
  const a = p.applyHeaders({ 'x-private': 'a' });
  const b = p.applyHeaders({ 'x-private': 'b' });
  a.set('x-private', 'changed');
  assert.equal(b.get('x-private'), 'b');
  assert.equal(p.applyHeaders({}).get('x-private'), null);
});

test('existing enforced CSP and report-only CSP are preserved without merging', () => {
  const headers = { 'Content-Security-Policy': "default-src 'self'; frame-ancestors 'self'", 'Content-Security-Policy-Report-Only': "script-src 'nonce-example'" };
  const output = createResponseHeaderPolicy().applyHeaders(headers);
  for (const [name, value] of Object.entries(headers)) assert.equal(output.get(name), value);
  assert.equal(output.get('x-frame-options'), null, 'do not add fallback XFO alongside application-owned frame-ancestors');
});

test('CSP with no frame-ancestors still receives a missing XFO default', () => {
  assert.equal(createResponseHeaderPolicy().applyHeaders({ 'content-security-policy': "default-src 'self'" }).get('x-frame-options'), 'DENY');
});

test('report-only frame-ancestors does not suppress enforced framing protection', () => {
  assert.equal(createResponseHeaderPolicy().applyHeaders({ 'content-security-policy-report-only': "frame-ancestors 'self'" }).get('x-frame-options'), 'DENY');
});

test('explicit CSP is applied atomically and independent of header rule order', () => {
  for (const headers of [
    { 'content-security-policy': { action: 'enforce', value: "frame-ancestors 'self'" }, 'x-frame-options': { action: 'default', value: 'DENY' } },
    { 'x-frame-options': { action: 'default', value: 'DENY' }, 'content-security-policy': { action: 'enforce', value: "frame-ancestors 'self'" } },
  ]) {
    const h = createResponseHeaderPolicy({ headers }).applyHeaders({});
    assert.equal(h.get('content-security-policy'), "frame-ancestors 'self'");
    assert.equal(h.get('x-frame-options'), null);
  }
});

test('removing CSP permits the ordinary missing XFO baseline', () => {
  const p = createResponseHeaderPolicy({ headers: { 'content-security-policy': { action: 'remove' } } });
  const h = p.applyHeaders({ 'content-security-policy': "frame-ancestors 'self'" });
  assert.equal(h.get('content-security-policy'), null);
  assert.equal(h.get('x-frame-options'), 'DENY');
});

test('explicit XFO enforcement remains an explicit application decision', () => {
  const p = createResponseHeaderPolicy({ headers: { 'x-frame-options': { action: 'enforce', value: 'sameorigin' } } });
  assert.equal(p.applyHeaders({ 'content-security-policy': "frame-ancestors 'self'" }).get('x-frame-options'), 'SAMEORIGIN');
});

test('preserves status, status text, body and all unrelated response headers', async () => {
  const input = new Response('hello', { status: 202, statusText: 'Accepted', headers: { 'cache-control': 'private, no-store', vary: 'Cookie, Origin', 'www-authenticate': 'Bearer', etag: '"abc"', 'x-robots-tag': 'noindex' } });
  const output = applyResponseHeaderPolicy(input);
  assert.notEqual(output, input);
  assert.equal(output.status, 202);
  assert.equal(output.statusText, 'Accepted');
  assert.equal(output.body, input.body);
  assert.equal(input.bodyUsed, false);
  for (const [name, value] of input.headers) assert.equal(output.headers.get(name), value);
  assert.equal(input.headers.get('x-frame-options'), null);
  assert.equal(await output.text(), 'hello');
  assert.equal(input.bodyUsed, true);
});

test('multiple Set-Cookie fields survive the unmodified header copy', () => {
  const h = new Headers();
  h.append('set-cookie', 'one=1; Path=/; HttpOnly');
  h.append('set-cookie', 'two=2; Path=/other; Secure');
  assert.deepEqual(applyResponseHeaderPolicy(new Response(null, { headers: h })).headers.getSetCookie(), h.getSetCookie());
});

test('supports redirects and null-body HTTP responses', () => {
  const redirect = applyResponseHeaderPolicy(Response.redirect('https://example.org/', 308));
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get('location'), 'https://example.org/');
  for (const status of [204, 205, 304]) {
    const response = applyResponseHeaderPolicy(new Response(null, { status }));
    assert.equal(response.status, status);
    assert.equal(response.body, null);
  }
});

test('streaming requires no read or tee and preserves cancellation', async () => {
  let cancellations = 0;
  const stream = new ReadableStream({ cancel() { cancellations++; } });
  const input = new Response(stream);
  const output = applyResponseHeaderPolicy(input);
  assert.equal(output.body, stream);
  assert.equal(input.bodyUsed, false);
  await output.body.cancel();
  assert.equal(cancellations, 1);
});

test('repeated application is header-idempotent without reading bodies', () => {
  const a = applyResponseHeaderPolicy(new Response('test'));
  const b = applyResponseHeaderPolicy(a);
  assert.deepEqual([...a.headers], [...b.headers]);
  assert.equal(a.body, b.body);
  assert.equal(a.bodyUsed, false);
});

test('rejects used and locked bodies with actionable failures', async () => {
  const used = new Response('used');
  await used.text();
  assert.throws(() => applyResponseHeaderPolicy(used), /unread and unlocked/);
  const locked = new Response('locked');
  const reader = locked.body.getReader();
  assert.throws(() => applyResponseHeaderPolicy(locked), /unread and unlocked/);
  reader.releaseLock();
});

test('rejects error/opaque/upgrade responses and non-Response inputs', () => {
  assert.throws(() => applyResponseHeaderPolicy(Response.error()), /ordinary HTTP/);
  assert.throws(() => applyResponseHeaderPolicy({ headers: new Headers(), status: 101, clone() {} }), /ordinary HTTP/);
  assert.throws(() => applyResponseHeaderPolicy({ headers: new Headers(), status: 200, webSocket: {}, clone() {} }), /ordinary HTTP/);
  for (const value of [null, {}, 'response']) assert.throws(() => applyResponseHeaderPolicy(value), /Fetch-compatible/);
});

test('encoded responses use the headers-only path rather than risking recompression', () => {
  const input = new Response(new Uint8Array([1, 2]), { headers: { 'content-encoding': 'gzip' } });
  const p = createResponseHeaderPolicy();
  assert.throws(() => p.apply(input), /host-owned/);
  const headers = p.applyHeaders(input.headers);
  assert.equal(headers.get('content-encoding'), 'gzip');
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.equal(input.bodyUsed, false);
});

test('response metadata limitations are visible rather than copied as invented properties', async () => {
  const input = await fetch('data:text/plain,body');
  const output = applyResponseHeaderPolicy(input);
  assert.notEqual(input.url, '');
  assert.equal(output.url, '');
  assert.equal(output.type, 'default');
});

test('rejects ambiguous names, invalid actions, unknown fields and unsafe values', () => {
  for (const options of [null, [], { default: true }, { defaults: 'false' }, { headers: [] }, { headers: { 'bad name': { action: 'remove' } } }, { headers: { X: { action: 'remove' }, x: { action: 'skip' } } }, { headers: { x: { action: 'append', value: 'a' } } }, { headers: { x: { action: 'skip', value: 'a' } } }, { headers: { x: { action: 'enforce', typo: true, value: 'a' } } }]) {
    assert.throws(() => createResponseHeaderPolicy(options), TypeError);
  }
  for (const value of ['', '   ', 'value\r\ninjected: yes', 'value\n', 'value\t', 'value\0', 42, 'עברית']) {
    assert.throws(() => createResponseHeaderPolicy({ headers: { x: { action: 'enforce', value } } }), TypeError);
  }
});

test('validates supported known header values without claiming to parse a complete CSP', () => {
  for (const [name, value] of [['x-frame-options', 'ALLOW-FROM https://example.org'], ['x-content-type-options', 'sniff'], ['referrer-policy', 'made-up']]) {
    assert.throws(() => createResponseHeaderPolicy({ headers: { [name]: { action: 'enforce', value } } }), TypeError);
  }
  assert.equal(createResponseHeaderPolicy({ headers: { 'x-frame-options': { action: 'enforce', value: 'sameorigin' } } }).applyHeaders({}).get('x-frame-options'), 'SAMEORIGIN');
});

test('accepts null-prototype declarative records', () => {
  const headers = Object.create(null);
  headers['x-app'] = { action: 'enforce', value: 'test' };
  assert.equal(createResponseHeaderPolicy({ headers }).applyHeaders({}).get('x-app'), 'test');
});
