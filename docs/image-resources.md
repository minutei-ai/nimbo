# Native image resources

The page owns image discovery, source selection, requests and decoded intrinsic
metadata in Rust. QuickJS exposes branded `HTMLImageElement` objects and `Image()`;
requests use the existing native transport in both the CLI and Worker/Wasm.
There is no external browser backend.

## Supported boundary

HTML `img` elements expose `src`, `srcset`, `sizes`, `alt`, `complete`, `currentSrc`,
`naturalWidth` and `naturalHeight`. `Image(width, height)` stores dimension
attributes. The engine decodes PNG, JPEG, GIF and WebP through the pinned `image`
crate, retains only intrinsic dimensions and applies JPEG EXIF orientation.
Animated formats use their first frame; decoded pixels are discarded.

Density descriptors use the pinned `parse-srcset` parser and the engine's fixed
`devicePixelRatio` of 1. Density correction also applies to natural dimensions.
A valid `src` supplies the 1x fallback when the candidate list does not contain one.
The reflected URL and selected `currentSrc` have separate ownership.

Initial markup, detached elements, inserted markup, deep clones and supported
imperative shadow roots enter the same page queue. Nodes owned by inactive
HTML documents do not fetch. Adoption clears old metadata and only the active
page may request the adopted resource. Changed subtree roots are scanned under
the existing DOM/layout work budgets; unchanged responses do not rescan the tree.

The scheduler allows one image request in flight while page scripts and other
native requests continue. A source replacement retains the previous successful
metadata while pending. Late responses for a replaced source or adopted node
are discarded. Successful decoding dispatches `load`; invalid or corrupt bytes
and failed HTTP responses dispatch `error`. Reassigning a failed source retries,
including namespaced attribute setters and `Attr.value`.

Removing `src` immediately clears metadata. Assigning an empty `src` also queues
an asynchronous error; parser scripts can attach the listener before delivery.
A generation token prevents delivery after a later source change or adoption.

## Bounds and unsupported behavior

The existing request count, response-byte, timeout and cancellation limits apply.
Before allocating the decoded output, the decoder checks its reported output
size against `maxResponseBytes`. Each physical dimension is limited to 16,384
pixels. The codec also receives that byte budget as its best-effort allocation
limit; this is not a strict bound on peak process memory. A quota failure ends
extraction with a resource-limit error rather than becoming an image error.

Width descriptors, responsive `sizes`, `picture`, CORS attributes, lazy loading,
zero-density candidates and unsupported URL schemes fail explicitly. This subset
does not implement image painting, `decode()`, loading priorities, a decoded image
cache, configurable DPR or complete HTMLImageElement conformance. Reassigning an
already successful source does not reproduce browser cache revalidation or
repeated cached load events.

Intrinsic resource metadata does not enable replaced-element layout. Image
geometry still fails at the existing layout boundary until native sizing and
inline placement are implemented and independently validated.

## Verification

The shared `image-resources.txt` fixture checks 27 contracts in native Rust and
real HTTP → workerd → Wasm. The same fixture passes in [independent Chromium](evidence/image-resources-chromium-2026-10-16.json);
its DPR is 2, so the fallback case verifies each engine's effective selection
rather than requiring the same selected URL at different DPRs. Separate tests
cover decoded-output quotas, a page without initial image tags and parser-time
empty-source errors. Fixtures contain generated images only.

[Local before/after evidence](evidence/image-resources-2026-10-16.json) records
artifact hashes, test totals and three celld rounds over retained atomic inline
layout. The new codecs and bindings add 636,040 Wasm bytes (about 3.9%). Latency
results are mixed; this feature does not claim a speedup. The retained workload
contains no images and does not measure decoding throughput.
