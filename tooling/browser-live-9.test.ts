import { expect, test } from "bun:test";
import { comparePage, comparisonBinary, origin, requests, worker } from "./browser-live-setup";

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native Web Storage and request isolation variant %i",
  async (variant) => {
    const url = new URL(`storage/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "globalThis.comparison" }),
    });
    expect(response.status).toBe(200);
    const expected = Object.fromEntries(
      [
        "empty",
        "identity",
        "brand",
        "areas",
        "coercion",
        "unicode",
        "emptyString",
        "reflection",
        "replacement",
        "keys",
        "reserved",
        "hiddenDelete",
        "symbolProperty",
        "defined",
        "removal",
        "guards",
        "extensible",
        "clear",
        "external",
        "module",
      ].map((key) => [key, true]),
    );
    expect(await response.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: expected });
    // The pinned comparator does not produce a completed value for this fixture.
    // Keep Nimbo's standards-based assertions above independent of that failure.
    if (comparisonBinary) expect(await comparePage(comparisonBinary, url)).toBeNull();
    expect(requests).toContain(`GET /storage/${variant}`);
    expect(requests).toContain("GET /storage-external.js");
  },
);

test("real HTTP → workerd → Wasm: link parser limits and failed requests release page state", async () => {
  const url = new URL("custom-elements-empty", origin.url).href;
  const expression =
    "(() => {const a=document.createElement('a');a.href='https://example.com/'+'x'.repeat(65536);return a.href;})()";
  const failed = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(failed.status).toBe(422);
  const limitMessage: unknown = expect.stringMatching(
    /^JavaScript: Error: URL input limit(?:\n|$)/,
  );
  expect(await failed.json()).toEqual({ error: limitMessage });
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression:
        "[document.createElement('a').href,document.baseURI === document.URL,typeof nimboLink]",
    }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    url,
    engine: "rust-wasm-quickjs",
    value: ["", true, "undefined"],
  });
});

test.each([
  [
    "chain",
    "const css=document.createElement('style');css.textContent='#target {'+Array.from({length:140},(_,i)=>'--p'+String(i).padStart(3,'0')+':'+(i===139?'1px':'var(--p'+String(i+1).padStart(3,'0')+')')+';').join('')+'width:var(--p000)}';document.body.appendChild(css);el.id='target';",
    "CSS variable chain",
  ],
  [
    "inherited entries",
    "for(let depth=0;depth<2;depth++){const child=document.createElement('div');el.appendChild(child);el=child;el.style.cssText=Array.from({length:600},(_,i)=>'--p'+depth+'-'+i+':1px;').join('');}",
    "CSS computed variables",
  ],
  [
    "inherited bytes",
    "for(let depth=0;depth<5;depth++){const child=document.createElement('div');el.appendChild(child);el=child;el.style.setProperty('--p'+depth,'x'.repeat(60000));}",
    "CSS computed variable bytes",
  ],
])(
  "real HTTP → workerd → Wasm: native variable %s limit fails and later requests recover",
  async (_name, setup, reason) => {
    const url = new URL("geometry-empty", origin.url).href;
    const expression = `(() => {let el=document.createElement('div');document.body.appendChild(el);${setup}return el.getBoundingClientRect();})()`;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression }),
    });
    expect(response.status).toBe(422);
    const error: unknown = expect.stringContaining(`resource limit: ${reason}`);
    expect(await response.json()).toEqual({ error });
    const recovered = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url,
        expression:
          "(() => {const el=document.createElement('div');el.style.cssText='--w:41px;width:var(--w);';document.body.appendChild(el);return el.getBoundingClientRect().width===41;})()",
      }),
    });
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: true });
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: paused native animation variant %i",
  async (variant) => {
    const url = new URL(`animations/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "comparison" }),
    });
    expect(response.status).toBe(200);
    const expected: Record<string, boolean> = {};
    for (const name of [
      "unused",
      "ease",
      "bezier",
      "frameEasing",
      "zeroLength",
      "variables",
      "unlayeredPriority",
      "vendor",
      "generated",
      "quarter",
      "half",
      "reverse",
      "before",
      "beforeNone",
      "after",
      "afterNone",
      "alternate",
      "alternateReverse",
      "finalAlternate",
      "fractionalCount",
      "infinite",
      "implicitFrom",
      "important",
      "frameImportant",
      "duplicateFrame",
      "duplicateDefinition",
      "mediaFalse",
      "mediaTrue",
      "layer",
      "quoted",
      "missing",
      "zeroDuration",
      "zeroCount",
    ]) {
      expected[name] = true;
      expected[`${name}Recovery`] = true;
    }
    expect(await response.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: expected });
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native software canvas pixels variant %i",
  async (variant) => {
    const url = new URL(`canvas/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: `canvasCase(${variant})` }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing pixels");
    expect(Object.keys(value)).toHaveLength(55);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test("real HTTP → workerd → Wasm: configured node budget counts generated boxes", async () => {
  const url = new URL("layout-budget/generated/0", origin.url).href;
  const expression = "document.querySelector('#root').getBoundingClientRect().width===8";
  const failed = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, maxLayoutNodes: 512, expression }),
  });
  expect(failed.status).toBe(422);
  expect(await failed.text()).toContain("layout tree: nodes");
  const healthy = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, maxLayoutNodes: 2048, expression }),
  });
  expect(healthy.status).toBe(200);
  expect(await healthy.json()).toMatchObject({ value: true });
});

test.each([
  [
    "(()=>{const e=document.createElement('div');e.style.lineHeight='2ex';document.body.append(e);return getComputedStyle(e).lineHeight})()",
    "relative query length",
  ],
  [
    "(()=>{document.body.innerHTML='A<span style=\"white-space:pre\">B</span>';document.body.style.lineHeight='1.5';return document.body.getBoundingClientRect()})()",
    "mixed inline text flow",
  ],
])(
  "real HTTP → workerd → Wasm: unsupported line metrics %s fail explicitly",
  async (expression, reason) => {
    const url = new URL("line-height/0", origin.url).href;
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
      body: JSON.stringify({ url, expression: "lineHeightCase(0)" }),
    });
    expect(healthy.status).toBe(200);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native font family variant %i",
  async (variant) => {
    const url = new URL(`font-family/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: `fontFamilyCase(${variant})` }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing font family values");
    expect(Object.keys(value)).toHaveLength(75);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each([
  ["CSSOM adopted sheets", "document.adoptedStyleSheets=Array(257).fill(s);"],
  [
    "stylesheet total bytes",
    "s.insertRule('#target {color:red;--payload:'+ 'x'.repeat(60000)+'}');document.adoptedStyleSheets=Array(5).fill(s);getComputedStyle(document.getElementById('target')).color;",
  ],
])(
  "real HTTP → workerd → Wasm: adopted stylesheet %s limit and recovery",
  async (reason, setup) => {
    const url = new URL("adopted-sheets/0", origin.url).href;
    const request = (expression: string) =>
      worker.dispatchFetch("https://nimbo.test/scrape", {
        method: "POST",
        headers: { authorization: "Bearer test-secret" },
        body: JSON.stringify({ url, expression }),
      });
    const failed = await request(`(()=>{const s=new CSSStyleSheet();${setup}return true})()`);
    expect(failed.status).toBe(422);
    expect(await failed.text()).toContain(reason);
    const recovered = await request("document.adoptedStyleSheets.length");
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ value: 0 });
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: sticky geometry variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`sticky-geometry/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing result");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing checks");
    expect(Object.keys(value)).toHaveLength(28);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: document stylesheet list variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`document-stylesheets/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing result");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing checks");
    expect(Object.keys(value)).toHaveLength(25);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: font settings variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`font-settings/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      value: Object.fromEntries(
        [
          "normal",
          "tag",
          "on",
          "off",
          "one",
          "zero",
          "list",
          "invalid",
          "variationNormal",
          "weight",
          "slant",
          "inherit",
        ].map((key) => [key, true]),
      ),
    });
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: headings geometry variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`headings/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(body, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing headings checks");
    expect(Object.keys(value)).toHaveLength(10);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);
