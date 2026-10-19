# Bounded JSON response projection

`responseProjection` allows a caller to omit unconsumed JSON object keys before
response data enters the page's QuickJS heap. It applies only to page fetches at
one exact, same-origin URL. Navigation, other URLs, redirects, challenges and
non-success HTTP responses retain their existing behavior and budgets.

```json
{
  "url": "https://example.com/",
  "expression": "fetch('/search').then(response => response.json())",
  "maxResponseBytes": 2097152,
  "responseProjection": {
    "url": "https://example.com/search",
    "omitJsonKeys": ["unusedBody", "debug"],
    "maxReceivedBytes": 8388608
  }
}
```

The native Rust projection validates the complete UTF-8 JSON document through
Serde, discards the selected keys recursively, and emits bounded JSON. It does
not construct a full JSON value tree. Original chunks enter a bounded native
buffer; the returned bytes alone enter QuickJS. Invalid JSON, including invalid
values under omitted keys, fails explicitly.

`maxReceivedBytes` bounds the combined original bytes of all projected responses
in the extraction, up to 32 MiB. `maxResponseBytes` continues to bound retained
response bytes across the whole page, including projected output and all other
responses. Original transfer and retained-byte limits are independent. The
projection accepts at most 64 nonempty keys of at most 256 UTF-16 code units.
Only one projected request may be active at a time; overlap fails with 429 to
bound simultaneous native buffers. Sequential projected requests share the
received-byte allowance.

Projection is explicit and does not depend on the server's declared MIME type
or charset. A successful projection becomes `application/json; charset=utf-8`;
original content-length and content-encoding headers are removed. Cookies,
HTTP status, authorization and same-origin policy retain their native owners.
Responses marked as challenges and non-success statuses are never projected.

The received-byte cap bounds the source buffer, not total process memory. The
allocator, parser, response transport, Wasm linear memory and page runtime also
consume memory. No additional decoding budget or browser fallback is implied.
This option currently belongs to the Worker extraction input; the native CLI
continues to use its existing navigation and byte budgets.
