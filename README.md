# @ehven/http-response-header-policy

Declarative HTTP response header policies with zero runtime dependencies.

**Unreleased candidate.** Registry installation and Cloudflare Workers acceptance
are pending. The currently exercised runtime is Node.js 24.22.3.

## Install and first use

After the first release:

```sh
npm install @ehven/http-response-header-policy
```

```js
import { createResponseHeaderPolicy } from '@ehven/http-response-header-policy';

const policy = createResponseHeaderPolicy();
const response = policy.apply(new Response('Hello', { status: 200 }));
```

This is an ESM server library using the host's `Headers` and `Response` globals.
No build, initialization service, global middleware, network connection or account
is required. The package does not fetch requests or install a header policy on its
own. Apply it to the responses your application selects.

## Defaults

Existing values always win over built-in defaults, including existing empty or
invalid values. This is preservation, not automatic security repair.

| Header | Value supplied when absent |
| --- | --- |
| X-Content-Type-Options | `nosniff` |
| Referrer-Policy | `strict-origin-when-cross-origin` |
| X-Frame-Options | `DENY` |
| Permissions-Policy | `camera=(), microphone=(), geolocation=()` |

The missing X-Frame-Options default is omitted when the effective enforced CSP
already declares `frame-ancestors`. An existing X-Frame-Options value remains
untouched. Report-Only CSP does not suppress this default.

The package adds no CSP, CSP Report-Only, HSTS, CORS, cache, authentication,
robots, COOP, COEP or CORP policy unless you explicitly configure that header.
The defaults can prevent intentional embedding or browser capability use;
configure those needs explicitly.

## Customize without editing the package

Keep reusable application settings in an application-owned module or JSON file.
The package accepts an ordinary object; it does not scan directories or execute
configuration files. For example, import settings from
`config/packages/npm/http-response-header-policy/index.json` in a host that
supports JSON imports, then pass them to the factory.

```js
const policy = createResponseHeaderPolicy({
  headers: {
    'x-frame-options': { action: 'enforce', value: 'SAMEORIGIN' },
    'permissions-policy': {
      action: 'enforce',
      value: 'camera=(self), microphone=(self), geolocation=()',
    },
    'x-application-policy': { action: 'default', value: 'v1' },
  },
});

// Only this response permits embedding under its explicit CSP.
const embeddable = policy.apply(new Response('Embeddable page'), {
  headers: {
    'x-frame-options': { action: 'remove' },
    'content-security-policy': {
      action: 'enforce',
      value: "default-src 'self'; frame-ancestors https://partner.example",
    },
  },
});
```

| Action | Behavior |
| --- | --- |
| `default` | Set the supplied value only when the header is absent. |
| `enforce` | Replace any existing value with the supplied value. |
| `skip` | Do not change the header or supply its default. |
| `remove` | Delete the header, including an existing value. |

`default` and `enforce` require a nonempty string `value`. `skip` and `remove`
reject a `value`. Header names are case-insensitive. Duplicate differently cased
names in one object are rejected. Header values reject control characters;
known X-Frame-Options, X-Content-Type-Options and Referrer-Policy values receive
additional checks. Values and secrets are not included in validation messages.

Precedence is built-in defaults, application rules, then per-call rules. A later
rule replaces the entire earlier rule; fields and header strings are never
implicitly merged. `defaults: false` disables built-in defaults only. Explicit
application rules remain active; per-call `skip` or `remove` can replace them.

The factory copies its configuration. Later caller mutations cannot change the
compiled policy, and one response's overrides cannot affect another response.

## CSP and framing ownership

Supply a complete CSP when your application needs one. Existing enforced and
Report-Only policies are preserved unless explicitly replaced or removed.
There is no CSP directive merger, nonce generator or CSP safety certification.
Permissions-Policy and custom policy strings are not fully parsed either.

Explicit enforcement is an application decision. If you enforce X-Frame-Options
while preserving an existing CSP, ensure its `frame-ancestors` agrees with your
intended embedding behavior. An enforced `frame-ancestors` takes precedence in
conforming browsers. See the [CSP specification](https://www.w3.org/TR/CSP3/#frame-ancestors-and-frame-options).

To retain a baseline CSP only where your application has not supplied one:

```js
const policy = createResponseHeaderPolicy({
  headers: {
    'content-security-policy': {
      action: 'default',
      value: "base-uri 'self'; object-src 'none'; frame-ancestors 'none'",
    },
    'x-frame-options': { action: 'enforce', value: 'DENY' },
  },
});
```

That example deliberately enforces framing denial; it is not a universal policy
for applications that permit embedding. These three CSP directives are not a
complete script/style or XSS protection policy.

## APIs

- `createResponseHeaderPolicy(options?)` returns a frozen reusable policy.
- `policy.apply(response, overrides?)` returns a new ordinary Fetch Response.
- `policy.applyHeaders(headers, overrides?)` returns new Headers for host-owned
  response construction. It accepts a Headers object, header pairs or an object.
- `applyResponseHeaderPolicy(response, options?)` applies a one-off policy.

Type declarations are included. The initial declared Node support is 24 or later;
each additional runtime requires its own acceptance checks. No CommonJS entry,
Express plugin, Astro dependency or PHP/WordPress runtime adapter is included.

## Response and host boundaries

`apply()` preserves status, status text, unrelated headers and the original body
stream. It does not buffer or tee the body. Consuming the returned body consumes
that shared stream; do not then read or send the original response as well.
Cancellation propagates through the shared stream. Input headers are not changed.
Repeated application does not consume the body and is header-idempotent for a
fixed policy. Independent responses share no mutable response state.

Use only ordinary HTTP responses with status 200–599 and an unread, unlocked
body. Redirects and null-body 204/205/304 responses are supported. Network-error,
opaque, WebSocket-upgrade, already-consumed and locked responses are rejected.
The wrapper also rejects `Content-Encoding` responses; their compression
semantics require host-owned construction through `applyHeaders()`.

The new Response does not preserve `url`, `redirected`, `type`, runtime metadata
or platform-specific properties. Do not use the wrapper when those are required.
Headers-only composition changes none of those properties or the body itself.
Multiple existing Set-Cookie fields are retained by the tested Node Headers
copy; an explicit rule for Set-Cookie replaces its complete value set.

For example, a Worker handling already-compressed bytes can keep construction
explicit, using the platform's supported options:

```js
const headers = policy.applyHeaders(upstream.headers);
return new Response(upstream.body, {
  status: upstream.status,
  statusText: upstream.statusText,
  headers,
  encodeBody: 'manual', // Cloudflare-specific; only for already-compressed bytes.
});
```

This recipe is not a general instruction to mark every upstream body compressed.
Follow the [Workers Response documentation](https://developers.cloudflare.com/workers/runtime-apis/response/)
and test the actual host's compression path. Workers acceptance is still pending.

## Migration and removal

Replace local hardcoded header mutations with a compiled application policy.
To preserve a previous policy that overwrote headers, mark those rules `enforce`;
mark its conditional CSP fallback `default`. Verify public, denied, redirect,
metadata and authenticated responses, especially cookies and cache headers.

To remove the package, remove its import/application call and dependency. Policy
files remain application-owned; there is no persistent registration, telemetry,
database, timer or background process to clean up. Retain replacement headers
where your application's security requirements still need them.

## Support and security

Use [GitHub issues](https://github.com/ehven-consultants-npm-products/ehven-http-response-header-policy/issues)
for non-sensitive bugs. For sensitive findings, use the repository's private
vulnerability reporting if enabled, or the contact route at
[gilad-ehven.com](https://gilad-ehven.com/). Do not post credentials or private
response data in public issues. No response-time SLA is promised.

MIT licensed. See LICENSE. Sponsorship and consulting links will be added when
a maintained destination is available.
