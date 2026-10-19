# Explicit cookie state between Worker extractions

Worker extractions start with a fresh runtime, DOM, storage and cookie jar by
default. A server-side caller can opt into bounded cookie handoff without
retaining the page or exposing host state to its JavaScript.

Set `captureCookieState: true` to receive an opaque `cookieState` string on a
successful extraction. Pass that string as the next extraction's `cookieState`
and request capture again to retain subsequent cookie updates. Omitting the
input state always starts an isolated jar.

```json
{
  "url": "https://example.com/",
  "expression": "fetch('/session').then(response => response.json())",
  "captureCookieState": true
}
```

The state belongs in protected server-side session storage. It includes
`HttpOnly` cookie values, so callers must not expose it to page JavaScript,
public browser clients, logs, telemetry or shared caches. This API is a trusted
host capability, not a new guest header or document-cookie API.

The native cookie owner serializes expiry, scope and attributes. Import checks
the exact origin, version, native cookie rules and quotas before replacing the
jar atomically. A state from another origin, malformed state, invalid entries
or a quota failure leaves the existing jar unchanged. Session cookies remain
session cookies; persistent expiry is preserved rather than extending Max-Age
on each restore. Expired cookies are omitted. Browser JavaScript still cannot
read or overwrite `HttpOnly` cookies.

The existing jar limits are 128 cookies and 64 KiB of cookie data. Serialized
state is independently capped at 256 KiB; authenticated HTTP extraction input
is capped at 512 KiB, including the state, expression and other options.
Web Storage and DOM state are not exported. Page and transport budgets restart
for each extraction. Cookie handoff does not create a persistent browser process.

Only successful extractions return a new state. A failed extraction does not
return an updated snapshot; the caller may still hold the previous state. This
does not mean that requests or other effects at the source were rolled back.
The caller owns retries, expiry and cleanup of its stored state.
