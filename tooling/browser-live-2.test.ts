import { expect, test } from "bun:test";
import {
  comparePage,
  comparisonBinary,
  intersectionRecovery,
  origin,
  requests,
  worker,
} from "./browser-live-setup";

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: fragment transfer and atomic tree mutation variant %i",
  async (variant) => {
    const url = new URL(`tree/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "globalThis.comparison" }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    expect(result).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: {
        documentType: true,
        fragmentState: true,
        inserted: true,
        noops: true,
        replaced: true,
        moved: true,
        same: true,
        removed: true,
        errors: [
          "NotFoundError",
          "NotFoundError",
          "NotFoundError",
          "HierarchyRequestError",
          "HierarchyRequestError",
          "HierarchyRequestError",
          "HierarchyRequestError",
          "HierarchyRequestError",
          "HierarchyRequestError",
          "HierarchyRequestError",
        ],
        atomic: true,
        fragmentAtomic: true,
        fragmentText: true,
        emptyText: true,
        emptyElement: true,
        documentReplace: true,
      },
    });
    if (comparisonBinary) {
      // The pinned comparator aborts at this valid insertion. Nimbo must
      // complete the entire standards-based fixture above.
      expect(await comparePage(comparisonBinary, url)).toEqual({
        exception: "HierarchyRequestError",
        message:
          "Failed to execute 'appendChild' on 'Node': The new child would create an invalid tree.",
        stage: "append-text-to-fragment",
      });
    }
    expect(requests).toContain(`GET /tree/${variant}`);
  },
);

test("real HTTP → workerd → Wasm: cssText recovers from an oversized external attribute", async () => {
  const url = new URL("styles/0", origin.url).href;
  const expression = `(() => {
    const el=document.createElement('div');const style=el.style;
    el.setAttribute('style','x'.repeat(65537));let limited=false;
    try {style.length;} catch(error){limited=error.message.includes('CSS input limit');}
    style.cssText='width: 8px';
    return {limited,identity:style===el.style,value:style.width,attribute:el.getAttribute('style'),length:style.length};
  })()`;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    url,
    engine: "rust-wasm-quickjs",
    value: { limited: true, identity: true, value: "8px", attribute: "width: 8px;", length: 1 },
  });
});

test.each([
  ["delay", "new IntersectionObserver(()=>{},{delay:1})", "unsupported: delay"],
  [
    "visibility",
    "new IntersectionObserver(()=>{},{trackVisibility:true})",
    "unsupported: visibility tracking",
  ],
  [
    "scroll margin",
    "new IntersectionObserver(()=>{},{scrollMargin:'1px'})",
    "unsupported: scroll margins",
  ],
  [
    "threshold cap",
    "new IntersectionObserver(()=>{},{threshold:Array(1025).fill(.5)})",
    "intersection threshold limit",
  ],
  [
    "margin cap",
    "new IntersectionObserver(()=>{},{rootMargin:' '.repeat(1025)})",
    "intersection margin bytes",
  ],
  [
    "registration cap",
    "(()=>{const observer=new IntersectionObserver(()=>{});for(let i=0;i<1025;i++)observer.observe(document.createElement('div'));})()",
    "intersection registration limit",
  ],
  [
    "automatic scrollbar gutters",
    "new Promise(()=>{const el=document.createElement('div');el.style.cssText='width:20px;height:20px;overflow:auto';el.innerHTML='<div style=\"width:40px;height:40px\"></div>';document.body.appendChild(el);new IntersectionObserver(()=>{}).observe(el);})",
    "layout unsupported: automatic scrollbar gutters",
  ],
  [
    "viewport overflow",
    "new Promise(()=>{document.body.style.overflow='hidden';new IntersectionObserver(()=>{}).observe(document.body);})",
    "layout unsupported: viewport overflow propagation",
  ],
  [
    "mixed inline text flow",
    "new Promise(()=>{const el=document.createElement('div');el.innerHTML='A<span style=\"white-space:pre\">B</span>';document.body.appendChild(el);new IntersectionObserver(()=>{}).observe(el);})",
    "layout unsupported: mixed inline text flow",
  ],
])(
  "real HTTP → workerd → Wasm: intersection rejects %s and recovers",
  async (_name, expression, detail) => {
    const url = new URL("geometry-empty", origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression }),
    });
    expect(response.status).toBe(422);
    const message: unknown = expect.stringContaining(detail);
    expect(await response.json()).toEqual({ error: message });
    const recovered = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: intersectionRecovery }),
    });
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: true });
  },
);

test.each([
  ["<length>", "0px", "--p:2em", "registered relative length"],
  ["<length>", "2vw", "", "registered contextual length"],
  ["<color>", "red", "--p:currentColor", "registered dependent color"],
  ["<color>", "currentColor", "", "registered dependent color"],
  ["<color>", "lab(50% 0 0)", "", "registered computed value type"],
  ["<url>", "url(example.test)", "", "registered computed value type"],
  ["<image>", "linear-gradient(red,blue)", "", "registered computed value type"],
  ["<transform-function>", "translateX(1px)", "", "registered computed value type"],
  ["<length-percentage>", "calc(10px + 5%)", "", "registered computed value type"],
] as const)(
  "real HTTP → workerd → Wasm: explicit registered value diagnostic %s/%s",
  async (syntax, initial, declarations, reason) => {
    const url = new URL("geometry-empty", origin.url).href;
    const css = `@property --p {syntax:"${syntax}";inherits:false;initial-value:${initial};}.target{width:var(--p);${declarations}}`;
    const expression = `(()=>{const sheet=document.createElement('style');sheet.textContent=${JSON.stringify(css)};document.head.appendChild(sheet);const target=document.createElement('div');target.className='target';document.body.appendChild(target);return target.getBoundingClientRect().width;})()`;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression }),
    });
    expect(response.status).toBe(422);
    const error: unknown = expect.stringContaining(reason);
    expect(await response.json()).toMatchObject({ error });
    const healthy = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url,
        expression:
          "(()=>{const node=document.createElement('div');node.style.width='11px';document.body.appendChild(node);return node.getBoundingClientRect().width;})()",
      }),
    });
    expect(healthy.status).toBe(200);
    expect(await healthy.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: 11 });
  },
);

test.each(["copy", "source-in", "source-out", "destination-in", "destination-atop"])(
  "real HTTP → workerd → Wasm: canvas compositing %s charges the full bitmap and recovers",
  async (mode) => {
    const url = new URL("canvas/140", origin.url).href;
    const expression = `(()=>{const x=new OffscreenCanvas(1024,1024).getContext('2d');x.globalCompositeOperation='${mode}';for(let i=0;i<20;i++)x.fillRect(5000,5000,1,1)})()`;
    const failed = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression }),
    });
    expect(failed.status).toBe(422);
    expect(await failed.text()).toContain("canvas: pixel work limit");
    const healthy = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "canvasCompositingCase(0).checks" }),
    });
    expect(healthy.status).toBe(200);
    const result: unknown = await healthy.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing recovery");
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each([
  [
    "(()=>{const e=document.createElement('div');e.style.tabSize='2ex';document.body.append(e);return getComputedStyle(e).tabSize})()",
    "relative query length",
  ],
  [
    "(()=>{document.body.textContent=String.fromCharCode(65,9,66);document.body.style.tabSize='4';document.body.style.whiteSpace='pre';return document.body.getBoundingClientRect()})()",
    "text white-space",
  ],
])(
  "real HTTP → workerd → Wasm: unsupported tab layout %s fails explicitly",
  async (expression, reason) => {
    const url = new URL("tabs/0", origin.url).href;
    const failed = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression }),
    });
    expect(failed.status).toBe(422);
    expect(await failed.text()).toContain(reason);
    const healthy = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "tabsCase(0)" }),
    });
    expect(healthy.status).toBe(200);
  },
);

test("real HTTP → workerd → Wasm: image errors preserve layer context scalars and conservative paint support", async () => {
  const url = new URL("background-layers/0", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression:
        "(()=>{document.body.style.cssText='background-image:url(https://example.test/a),url(https://example.test/b);background-attachment:fixed,local;background-origin:content-box;background-clip:border-area';const s=getComputedStyle(document.body);return {attachment:s.backgroundAttachment,origin:s.backgroundOrigin,clip:s.backgroundClip,paint:['background-attachment','background-origin','background-clip'].map(name=>CSS.supports(name,s.getPropertyValue(name)))}})()",
    }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    value: {
      attachment: "fixed, local",
      origin: "content-box, content-box",
      clip: "border-area, border-area",
      paint: [false, false, false],
    },
  });
});

test("real HTTP → workerd → Wasm: large live child collections at default budgets", async () => {
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url: new URL("large-dom/live-children", origin.url).href,
      expression: "largeLiveChildrenCase()",
    }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    value: {
      counts: true,
      collections: true,
      first: true,
      last: true,
      removal: true,
      text: true,
      insertion: true,
      retained: true,
    },
  });
});

test.each(["scrollTop", "clientHeight", "offsetParent"])(
  "real HTTP → workerd → Wasm: viewport geometry remains explicit for %s",
  async (property) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL("sticky-geometry/0", origin.url).href,
        expression: `document.documentElement.${property}`,
      }),
    });
    expect(response.status).toBe(422);
    expect(await response.text()).toContain("viewport geometry");
    const recovered = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL("sticky-geometry/0", origin.url).href,
        expression: "Object.values(globalThis.comparison).every(Boolean)",
      }),
    });
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ value: true });
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native font shaping variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`font-shaping/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      value: Object.fromEntries(
        [
          "a",
          "b",
          "pair",
          "kerning",
          "space",
          "euro",
          "accent",
          "decomposed",
          "empty",
          "repeat",
          "white",
          "newLine",
          "sameFont",
          "invalidIgnored",
          "metricsBrand",
          "metricsReadonly",
          "requiredArgument",
          "restoreFont",
          "binaryFont",
          "binaryLoaded",
          "fontOwnsBytes",
          "hiddenNativeBridge",
          "privateFontState",
          "resetFont",
          "resizeFont",
          "ignoredLineHeight",
          "metricsReceiver",
        ].map((name) => [name, true]),
      ),
    });
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: translation geometry variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`translation/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(body, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing translation checks");
    expect(Object.keys(value)).toHaveLength(19);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);
