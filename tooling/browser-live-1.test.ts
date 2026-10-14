import { expect, test } from "bun:test";
import {
  cascadeExpected,
  comparePage,
  comparisonBinary,
  insertionExpected,
  origin,
  requests,
  supportsExpected,
  worker,
} from "./browser-live-setup";

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: selectors, ancestry, mutations and POST variant %i",
  async (variant) => {
    const url = new URL(String(variant), origin.url).href;

    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "globalThis.comparison" }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    const expected = {
      title: `Document ${variant} loaded`,
      before: `α & ${variant}`,
      self: true,
      ancestor: true,
      matches: true,
      missing: null,
      parent: true,
      children: true,
      siblings: true,
      connected: true,
      rootParent: null,
      removed: true,
      changed: true,
      detached: true,
      after: "second",
      restored: true,
      text: `α & ${variant}`,
      nodeChecks: {
        parsedNodes: true,
        hierarchy: true,
        documentNode: true,
        constructed: true,
        fresh: true,
        appended: true,
        mutated: true,
        elementValue: true,
        textDetached: true,
        cycleSafe: true,
      },
      count: 3,
      echo: { method: "POST", body: `payload-${variant}-α` },
    };
    expect(result).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: expected,
    });
    if (comparisonBinary) {
      const baseline = await comparePage(comparisonBinary, url);
      // Pinned v0.2.3 has two observed DOM defects; Nimbo must still pass
      // the standards-based expectations above, rather than inherit them.
      expect(baseline).toEqual({
        ...expected,
        nodeChecks: { ...expected.nodeChecks, documentNode: false, mutated: false },
      });
    }
    expect(requests).toContain(`GET /${variant}`);
    expect(requests).toContain("POST /echo");
    expect(requests).toContain(`GET /script/${variant}`);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native author stylesheet cascade variant %i",
  async (variant) => {
    const url = new URL(`cascade/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "comparison" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: cascadeExpected,
    });
    expect(requests).toContain(`GET /cascade/${variant}`);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native variadic node insertion variant %i",
  async (variant) => {
    const url = new URL(`node-insertion/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "comparison" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: insertionExpected,
    });
    expect(requests).toContain(`GET /node-insertion/${variant}`);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native feature support variant %i",
  async (variant) => {
    const url = new URL(`supports/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "comparison" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: supportsExpected,
    });
  },
);

test.each([
  ["running", "from{width:10px}to{width:90px}", "demo 1s linear -.5s both", "running timeline"],
  ["steps", "from{width:10px}to{width:90px}", "demo 1s steps(2) -.25s paused both", "step easing"],
  [
    "mixed units",
    "from{width:10px}to{width:90%}",
    "demo 1s linear -.5s paused both",
    "mixed interpolation units",
  ],
  [
    "custom property",
    "from{--size:10px}to{--size:90px}",
    "demo 1s linear -.5s paused both",
    "custom property interpolation",
  ],
])(
  "real HTTP → workerd → Wasm: native animation gap %s",
  async (_name, frames, animation, detail) => {
    const url = new URL("geometry/0", origin.url).href;
    const expression = `(()=>{const target=document.createElement('div');target.className='animated';document.body.appendChild(target);const sheet=document.createElement('style');sheet.textContent=${JSON.stringify(`@keyframes demo{${frames}}.animated{height:0;width:11px;animation:${animation}}`)};document.head.appendChild(sheet);try{target.getBoundingClientRect();return 'missing failure';}catch(error){return error.message;}finally{sheet.remove();target.remove();}})()`;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression }),
    });
    expect(response.status).toBe(200);
    const expected: unknown = expect.stringContaining(`animation ${detail}`);
    expect(await response.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: expected,
    });
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: CSS font registry and URL loading variant %i",
  async (variant) => {
    const url = new URL(`font-loading/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: `fontCase(${variant})` }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing comparison");
    expect(Object.keys(value)).toHaveLength(27);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each([
  {
    name: "dimensions",
    expression: "new OffscreenCanvas(4097,1)",
    reason: "canvas: dimensions limit",
  },
  { name: "pixels", expression: "new OffscreenCanvas(2048,2048)", reason: "canvas: pixels limit" },
  {
    name: "memory",
    expression: "Array.from({length:5},()=>new OffscreenCanvas(1024,1024))",
    reason: "canvas: memory limit",
  },
  {
    name: "owners",
    expression: "Array.from({length:65},()=>new OffscreenCanvas(0,0))",
    reason: "canvas: owners limit",
  },
  {
    name: "pixel work",
    expression:
      "(()=>{const x=new OffscreenCanvas(1024,1024).getContext('2d');for(let i=0;i<20;i++)x.fillRect(0,0,1024,1024)})()",
    reason: "canvas: pixel work limit",
  },
  {
    name: "state stack",
    expression:
      "(()=>{const x=new OffscreenCanvas(1,1).getContext('2d');for(let i=0;i<65;i++)x.save()})()",
    reason: "canvas: state stack limit",
  },
  {
    name: "color bytes",
    expression: "new OffscreenCanvas(1,1).getContext('2d').fillStyle='x'.repeat(4097)",
    reason: "canvas: color bytes limit",
  },
  {
    name: "color space",
    expression: "new OffscreenCanvas(1,1).getContext('2d',{colorSpace:'display-p3'})",
    reason: "unsupported: canvas color space",
  },
  {
    name: "text",
    expression: "new OffscreenCanvas(1,1).getContext('2d').measureText('A')",
    reason: "unsupported: font glyph fallback",
  },
  {
    name: "transform",
    expression: "new OffscreenCanvas(1,1).getContext('2d').translate(1,1)",
    reason: "unsupported: canvas translate",
  },
  {
    name: "stroke",
    expression: "new OffscreenCanvas(1,1).getContext('2d').strokeStyle='red'",
    reason: "unsupported: canvas strokeStyle",
  },
])(
  "real HTTP → workerd → Wasm: canvas $name boundary and recovery",
  async ({ expression, reason }) => {
    const url = new URL("canvas/128", origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression }),
    });
    expect(response.status).toBe(422);
    expect(await response.text()).toContain(reason);
    const healthy = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "canvasCase(0)" }),
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
  ["CSSOM sheets", "for(let i=0;i<257;i++)new CSSStyleSheet();"],
  ["CSSOM state", "const s=new CSSStyleSheet();for(let i=0;i<4097;i++)s.insertRule('div{}',i);"],
  ["CSSOM input", "new CSSStyleSheet().insertRule('div{'+ ' '.repeat(65537)+'}');"],
])(
  "real HTTP → workerd → Wasm: constructed stylesheet %s limit and recovery",
  async (reason, setup) => {
    const url = new URL("constructed-sheets/0", origin.url).href;
    const request = (expression: string) =>
      worker.dispatchFetch("https://nimbo.test/scrape", {
        method: "POST",
        headers: { authorization: "Bearer test-secret" },
        body: JSON.stringify({ url, expression }),
      });
    const failed = await request(`(()=>{${setup}return true})()`);
    expect(failed.status).toBe(422);
    expect(await failed.text()).toContain(reason);
    const recovered = await request("new CSSStyleSheet().cssRules.length");
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ value: 0 });
  },
);

test.each(Array.from({ length: 64 }, (_, index) => index))(
  "real HTTP → workerd → Wasm: document and transport cookie variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`cookies/${variant}`, origin.url).href,
        expression: `cookiesCase(${variant})`,
      }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing result");
    expect(Reflect.get(result, "value")).toEqual({
      server: true,
      accumulate: true,
      httpOnly: true,
      domain: true,
      pathHidden: true,
      pathOrder: true,
      expiration: true,
      attributes: true,
      binding: true,
      httpShared: true,
      defaultPath: true,
      explicitPath: true,
      serverUpdate: true,
      variant: true,
    });
  },
);

test.each([
  ["context.measureText('C').width", "font glyph fallback"],
  ["context.measureText('שלום').width", "font glyph fallback"],
  ["context.measureText('A'.repeat(1025)).width", "font shaping limit"],
  [
    "context.measureText('A'.repeat(1024)); for(let i=0;i<64;i++)context.measureText('A'.repeat(1024));",
    "font shaping limit",
  ],
  ["context.font='bold 16px NimboShape'", "canvas font synthesis or variants"],
  ["context.font='1em NimboShape'", "canvas contextual font size"],
  ["context.font='4097px NimboShape'", "font size"],
  ["context.measureText('A').actualBoundingBoxLeft", "text bounding box metrics"],
  ["document.fonts.clear(); context.measureText('A').width", "font glyph fallback"],
] as const)("real HTTP → workerd → Wasm: font shaping boundary %s", async (expression, reason) => {
  const url = new URL("font-shaping/0", origin.url).href;
  const run = (source: string) =>
    worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: source }),
    });
  const response = await run(
    `(async()=>{await globalThis.comparison; const canvas = new OffscreenCanvas(8,8); const context=canvas.getContext('2d'); context.font='16px NimboShape'; ${expression}; return true;})()`,
  );
  expect(response.status).toBe(422);
  const error: unknown = expect.stringContaining(reason);
  expect(await response.json()).toMatchObject({ error });
  const healthy = await run("globalThis.comparison");
  expect(healthy.status).toBe(200);
  expect(await healthy.json()).toMatchObject({
    value: { pair: true, kerning: true, accent: true, decomposed: true },
  });
});

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: Unicode text-transform variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`text-transform/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      value: Object.fromEntries(
        [
          "upperLatin",
          "lowerLatin",
          "turkishUpper",
          "turkishLower",
          "languageInheritance",
          "emptyLanguage",
          "inherit",
          "unset",
          "initial",
          "none",
          "mutation",
          "wrap",
          "spacing",
        ].map((key) => [key, true]),
      ),
    });
  },
);
