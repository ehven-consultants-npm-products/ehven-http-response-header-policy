const DEFAULT_RULES = Object.freeze({
  'x-content-type-options': Object.freeze({ action: 'default', value: 'nosniff' }),
  'referrer-policy': Object.freeze({ action: 'default', value: 'strict-origin-when-cross-origin' }),
  'x-frame-options': Object.freeze({ action: 'default', value: 'DENY' }),
  'permissions-policy': Object.freeze({ action: 'default', value: 'camera=(), microphone=(), geolocation=()' }),
});
const ACTIONS = new Set(['default', 'enforce', 'skip', 'remove']);
const REFERRERS = new Set(['no-referrer', 'no-referrer-when-downgrade', 'origin', 'origin-when-cross-origin', 'same-origin', 'strict-origin', 'strict-origin-when-cross-origin', 'unsafe-url']);
const NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

function record(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${label} must be a plain object.`);
  }
}

function normalizeOptions(options) {
  record(options, 'Policy options');
  for (const key of Object.keys(options)) {
    if (!['defaults', 'headers'].includes(key)) throw new TypeError(`Unknown policy option: ${key}.`);
  }
  if (Object.hasOwn(options, 'defaults') && typeof options.defaults !== 'boolean') {
    throw new TypeError('defaults must be a boolean.');
  }
  const rules = new Map();
  if (Object.hasOwn(options, 'headers')) {
    record(options.headers, 'headers');
    for (const [name, input] of Object.entries(options.headers)) {
      if (!NAME.test(name)) throw new TypeError('Invalid HTTP header name.');
      const lower = name.toLowerCase();
      if (rules.has(lower)) throw new TypeError(`Duplicate header policy: ${lower}.`);
      record(input, `Rule for ${lower}`);
      for (const key of Object.keys(input)) {
        if (!['action', 'value'].includes(key)) throw new TypeError(`Unknown rule option for ${lower}: ${key}.`);
      }
      if (!ACTIONS.has(input.action)) throw new TypeError(`Invalid action for ${lower}.`);
      const needsValue = input.action === 'default' || input.action === 'enforce';
      if (!needsValue && Object.hasOwn(input, 'value')) throw new TypeError(`Action ${input.action} does not accept a value.`);
      let value;
      if (needsValue) {
        if (typeof input.value !== 'string' || !input.value.trim()
            || /[\x00-\x1f\x7f]/.test(input.value)) {
          throw new TypeError(`Value for ${lower} must be a nonempty string without control characters.`);
        }
        // Let the host validate the HTTP ByteString representation as well.
        const probe = new Headers();
        probe.set(lower, input.value);
        value = probe.get(lower);
        if (lower === 'x-content-type-options' && value.toLowerCase() !== 'nosniff') {
          throw new TypeError('X-Content-Type-Options must be nosniff.');
        }
        if (lower === 'x-frame-options') {
          value = value.toUpperCase();
          if (!['DENY', 'SAMEORIGIN'].includes(value)) throw new TypeError('X-Frame-Options must be DENY or SAMEORIGIN.');
        }
        if (lower === 'referrer-policy' && !REFERRERS.has(value)) throw new TypeError('Unsupported Referrer-Policy value.');
      }
      rules.set(lower, Object.freeze(needsValue ? { action: input.action, value } : { action: input.action }));
    }
  }
  return { defaults: options.defaults, rules };
}

function resolveRules(base, override) {
  const rules = new Map();
  if ((override.defaults ?? base.defaults ?? true)) {
    for (const entry of Object.entries(DEFAULT_RULES)) rules.set(...entry);
  }
  for (const [name, rule] of base.rules) rules.set(name, rule);
  for (const [name, rule] of override.rules) rules.set(name, rule);
  return rules;
}

function applyRules(input, rules) {
  const headers = new Headers(input);
  for (const [name, rule] of rules) {
    if (rule.action === 'remove') headers.delete(name);
    else if (rule.action === 'enforce') headers.set(name, rule.value);
    else if (rule.action === 'default' && !headers.has(name)) {
      // An application-owned enforced framing directive is authoritative. Do not
      // introduce an additional fallback XFO declaration alongside it.
      const cspRule = rules.get('content-security-policy');
      const csp = cspRule?.action === 'remove' ? null
        : cspRule?.action === 'enforce' ? cspRule.value
        : headers.get('content-security-policy') ?? (cspRule?.action === 'default' ? cspRule.value : null);
      if (name === 'x-frame-options' && csp && /(?:^|[;,])\s*frame-ancestors\s/i.test(csp)) continue;
      headers.set(name, rule.value);
    }
  }
  return headers;
}

function transform(response, rules) {
  // A structural check supports host Responses without relying on one realm's
  // constructor identity. Constructors still perform final body validation.
  if (!response || typeof response !== 'object' || !response.headers
      || typeof response.clone !== 'function' || typeof response.status !== 'number') {
    throw new TypeError('Expected a Fetch-compatible Response.');
  }
  if (response.status < 200 || response.status > 599 || response.webSocket != null) {
    throw new TypeError('Only ordinary HTTP Responses with status 200–599 are supported; error, opaque and upgrade responses are excluded.');
  }
  if (response.bodyUsed || response.body?.locked) throw new TypeError('Response body must be unread and unlocked.');
  if (response.headers.has('content-encoding')) {
    throw new TypeError('Encoded responses require host-owned response construction; use applyHeaders().');
  }
  const headers = applyRules(response.headers, rules);
  // Reading the returned body consumes this same stream. No body buffering or
  // tee is introduced. URL/type/redirect history and host extensions are not copied.
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** Compile a reusable policy. Inputs are copied; calls share no response state. */
export function createResponseHeaderPolicy(options = {}) {
  const base = normalizeOptions(options);
  const apply = (response, overrides = {}) => transform(response, resolveRules(base, normalizeOptions(overrides)));
  const applyHeaders = (headers, overrides = {}) => applyRules(headers, resolveRules(base, normalizeOptions(overrides)));
  return Object.freeze({ apply, applyHeaders });
}

/** Apply a one-off response policy. Prefer the factory for repeated requests. */
export function applyResponseHeaderPolicy(response, options = {}) {
  return createResponseHeaderPolicy(options).apply(response);
}
