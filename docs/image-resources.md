# Native image resources

The page owns image discovery, source selection, requests and decoded intrinsic
metadata in Rust. QuickJS exposes branded `HTMLImageElement` objects and `Image()`;
requests use the existing native transport in both the CLI and Worker/Wasm.
There is no external browser backend.

## Supported boundary

HTML `img` elements expose `src`, `srcset`, `sizes`, `alt`, `complete`, `currentSrc`,
`naturalWidth` and `naturalHeight`. `Image(width, height)` stores dimension
attributes. The engine decodes PNG, JPEG, GIF, WebP and ICO through the pinned `image`
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

## Image document navigation

Native and Worker navigation accept the supported image MIME types, including
`image/x-icon` and `image/vnd.microsoft.icon`. They construct an image document
with the final URL in its `img` source, preserve `document.contentType`, and run
the existing image scheduler to decode its intrinsic dimensions. The document
retains the navigation's origin and cookies for subsequent same-origin fetches.
This follows the [HTML image document structure](https://html.spec.whatwg.org/multipage/document-lifecycle.html#read-media).

The scheduler currently makes its own request for the image after navigation;
both physical transfers count toward the page's existing resource budgets.
No image response cache or painting implementation is implied. SVG, audio,
video, PDF and other document MIME types remain unsupported.

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

## Intrinsic layout

Images now share replaced-box sizing with SVG viewports and canvas through the
existing native Taffy adapter. The page's loaded dimensions feed the layout directly;
no second metadata or extraction pipeline is involved. Internal dimensions retain
fractional density correction, while the public naturalWidth/naturalHeight values
keep their integer DOM contract.

The supported layout includes intrinsic dimensions and orientation, legacy HTML
width/height hints, CSS overrides, percentages, min/max constraints, padding,
borders and content-box/border-box sizing. The adapter resolves the replaced-box
ratio constraints before native leaf layout so an early generic aspect-ratio
calculation cannot override the final content size. This follows the
[CSS replaced-element sizing rules](https://www.w3.org/TR/CSS22/visudet.html#min-max-heights).

Block, flow-root, flex/grid items and atomic inline images use the existing native
layout and line-box owners. Inline images retain their computed display, baseline,
wrapping and overflow behavior. Mutations and completed loads invalidate the same
page layout cache. Initial pending images without previous metadata have zero
intrinsic dimensions and adopt the decoded size after loading.

A failed image with definite CSS width and height still has that explicit box.
Intrinsic broken-image icons and alternate text measurement remain unsupported and
fail explicitly. Element onerror handlers now register through the existing shared
DOM event-handler implementation; Window's special error-handler semantics are
outside this change.

Mixed text/image inline formatting and non-replaced inline wrappers around images
remain unsupported. Image painting, object-fit rendering, full fragmentation and
complete CSS/HTML image conformance are not provided by these box measurements.

## Verification

The shared `image-resources.txt` fixture checks 27 contracts in native Rust and
real HTTP → workerd → Wasm. The same fixture passes in
[independent Chromium](evidence/image-resources-chromium-2026-10-16.json);
its DPR is 2, so the fallback case verifies each engine's effective selection
rather than requiring the same selected URL at different DPRs. Separate tests
cover decoded-output quotas, a page without initial image tags and parser-time
empty-source errors. Fixtures contain generated images only.

[Resource-loading measurements](evidence/image-resources-2026-10-16.json) record
the codec addition. [Intrinsic-layout measurements](evidence/image-layout-2026-10-16.json)
compare this layout with the loader-only build. Layout adds 7,900 Wasm bytes;
its measured p50 is higher in all three retained rounds. These are local
observations over a retained workload without images, not decoding throughput
or a speedup claim. Both records retain exact artifact hashes and test scope.

The shared `image-layout.txt` fixture checks 59 layout contracts against the
native engine, Worker/Wasm and
[independent Chromium](evidence/image-layout-chromium-2026-10-16.json), including fractional
`srcset` density, conflicting min/max constraints, eight display modes, inline
overflow/wrapping, error-handler delivery, unsourced images and ratio-only SVG box
regressions. Separate negative tests preserve
the explicit alternate-text layout boundary. Each scenario removes its completed
fixture nodes, keeping the test within the normal page budgets.
