import { expect, test } from "bun:test";
import {
  comparePage,
  comparisonBinary,
  origin,
  requests,
  responseEncodingCases,
  scriptModesExpression,
  worker,
} from "./browser-live-setup";

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native module graphs and live bindings variant %i",
  async (variant) => {
    const url = new URL(`modules/${variant}`, origin.url).href;
    const before = requests.length;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "globalThis.moduleDone" }),
    });
    const expected = {
      order: "classic,entry,defer,inline,dcl,after",
      readyStates: "interactive,interactive,interactive,complete",
      live: true,
      identity: true,
      once: true,
      namespace: true,
      cycle: true,
      redirectedMeta: true,
      inlineMeta: true,
      value: true,
      legacy: true,
    };
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: expected });
    const observed = requests.slice(before);
    for (const asset of [
      "shared.js",
      "reexport.js",
      "cycle-a.js",
      "cycle-b.js",
      "nested/entry.js",
      "defer.js",
    ])
      expect(
        observed.filter((request) => request === `GET /module-assets/${variant}/${asset}`).length,
      ).toBe(1);
    expect(observed).toContain(`GET /module-assets/${variant}/redirect.js`);
    if (comparisonBinary)
      expect(await comparePage(comparisonBinary, url)).toEqual({ ...expected, legacy: false });
  },
);

test.each(["classic", "module"])(
  "real HTTP → workerd → Wasm: cross-origin base cannot authorize %s requests",
  async (mode) => {
    const url = new URL(`base-origin/${mode}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "({url:document.URL,denied})" }),
    });
    const result: unknown = await response.json();
    if (mode === "classic") {
      expect(response.status).toBe(200);
      expect(result).toMatchObject({ value: { url, denied: 1 } });
    } else {
      expect(response.status).toBe(422);
      expect(JSON.stringify(result)).toContain("origin policy");
    }
    expect(requests).toContain(`GET /base-origin/${mode}`);
  },
);

test.each([
  ["text shaping", "el.innerHTML='A<span style=\"font-size:20px\">B</span>';"],
  [
    "stylesheet at-rule",
    "const css=document.createElement('style');css.textContent='@scope {div {width: 50px;}}';document.body.appendChild(css);",
  ],
  [
    "stylesheet sets",
    "const css=document.createElement('link');css.setAttribute('rel','stylesheet');css.setAttribute('title','alternate');document.body.appendChild(css);",
  ],
  ["non-translation transform", "el.style.transform='rotate(10deg)';"],
  ["environment substitution", "el.style.width='env(safe-area-inset-left, 10px)';"],
  ["fixed static position", "el.style.position='fixed';"],
  [
    "display formatting",
    "const child=document.createElement('span');child.style.display='inline-table';el.appendChild(child);",
  ],
  ["element formatting", "const child=document.createElement('img');el.appendChild(child);"],
  ["relative query length", "el.style.width='2ic';"],
])(
  "real HTTP → workerd → Wasm: geometry rejects %s without fictional values",
  async (reason, setup) => {
    const url = new URL("geometry-empty", origin.url).href;
    const expression = `(() => {const el=document.createElement('div');document.body.appendChild(el);${setup}return el.getBoundingClientRect();})()`;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression }),
    });
    expect(response.status).toBe(422);
    const message: unknown = expect.stringContaining(`layout unsupported: ${reason}`);
    expect(await response.json()).toEqual({ error: message });
    const recovered = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url,
        expression: "document.createElement('div').getBoundingClientRect().toJSON()",
      }),
    });
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 },
    });
  },
);

test("real HTTP → workerd → Wasm: native feature support leaves unsupported capabilities explicit", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const expression =
    "['color:red','transform:rotate(1deg)','width:var(--x)','selector(div)'].map(query=>CSS.supports(query))";
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    url,
    engine: "rust-wasm-quickjs",
    value: [false, false, false, false],
  });
});

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native container query variant %i",
  async (variant) => {
    const url = new URL(`containers/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url,
        expression: "Object.assign({ratioPrecision:containerRatioPrecision}, comparison)",
      }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    expect(result).toMatchObject({ url, engine: "rust-wasm-quickjs" });
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing comparison");
    expect(Object.keys(value)).toHaveLength(80);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: binary response body variant %i",
  async (variant) => {
    const url = new URL(`binary-cases/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "comparison" }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    expect(result).toMatchObject({ url, engine: "rust-wasm-quickjs" });
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing comparison");
    expect(Object.keys(value)).toHaveLength(31);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each([
  {
    name: "default downloaded bytes",
    path: "css-budget/130",
    expression: "true",
    maxStylesheetBytes: undefined,
    reason: "stylesheet total bytes",
  },
  {
    name: "configured downloaded bytes",
    path: "css-budget/131",
    expression: "true",
    maxStylesheetBytes: 290000,
    reason: "stylesheet total bytes",
  },
  {
    name: "configured single inline bytes",
    path: "geometry-empty",
    expression:
      "(()=>{const s=document.createElement('style');s.textContent='/*'+'é'.repeat(150000)+'*/';document.head.appendChild(s);return document.body.getBoundingClientRect()})()",
    maxStylesheetBytes: 290000,
    reason: "stylesheet bytes",
  },
  {
    name: "configured combined inline bytes",
    path: "geometry-empty",
    expression:
      "(()=>{for(let i=0;i<2;i++){const s=document.createElement('style');s.textContent='/*'+'x'.repeat(180000)+'*/';document.head.appendChild(s)}return document.body.getBoundingClientRect()})()",
    maxStylesheetBytes: 300000,
    reason: "stylesheet total bytes",
  },
])(
  "real HTTP → workerd → Wasm: $name limit and fresh recovery",
  async ({ path, expression, maxStylesheetBytes, reason }) => {
    const url = new URL(path, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression, maxStylesheetBytes }),
    });
    expect(response.status).toBe(422);
    expect(await response.text()).toContain(reason);
    const healthyUrl = new URL("css-budget/132", origin.url).href;
    const healthy = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: healthyUrl,
        expression: "document.getElementById('target').getBoundingClientRect().width",
        maxStylesheetBytes: 700000,
      }),
    });
    expect(healthy.status).toBe(200);
    expect(await healthy.json()).toMatchObject({ value: 432 });
  },
);

test("real HTTP → workerd → Wasm: image errors preserve repeat scalars and conservative tiling support", async () => {
  const url = new URL("background-repeat/0", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression:
        "(()=>{document.body.style.cssText='background-image:url(https://example.test/a),url(https://example.test/b);background-repeat:space round';return {repeat:getComputedStyle(document.body).backgroundRepeat,tiling:CSS.supports('background-repeat','space round')}})()",
    }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    value: { repeat: "space round, space round", tiling: false },
  });
  const geometry = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression:
        "(()=>{document.body.style.cssText='background-image:url(https://example.test/a);background-repeat:space round';return document.body.getBoundingClientRect()})()",
    }),
  });
  expect(geometry.status).toBe(422);
  expect(await geometry.text()).toContain("URL provenance and loading");
});

test.each(Array.from({ length: 256 }, (_, index) => [Math.floor(index / 4), index % 4]))(
  "real HTTP → workerd → Wasm: native HTML box categories variant %i group %i",
  async (variant, group) => {
    const url = new URL(`html-boxes/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: `htmlBoxesCase(${variant},${group})` }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing HTML box values");
    expect(Object.keys(value)).toHaveLength(group === 3 ? 24 : 51);
    expect(Reflect.get(value, "externalMutation")).toBe(true);
    for (const check of Object.values(value)) {
      expect(check).toBe(true);
    }
  },
);

test.each(
  responseEncodingCases.flatMap((fixture, index) =>
    Array.from({ length: 8 }, (_, variant) => ({ fixture, index, variant })),
  ),
)(
  "real HTTP → workerd → Wasm: response encoding $fixture.name variant $variant",
  async ({ fixture, index, variant }) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`response-encoding/${index}/${variant}`, origin.url).href,
        expression: "({dom:document.getElementById('out').textContent,script:encodingResult})",
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      value: { dom: fixture.expected, script: fixture.expected },
    });
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: classic script modes variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`script-modes/${variant}`, origin.url).href,
        expression: scriptModesExpression,
      }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing result");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing checks");
    expect(Object.keys(value)).toHaveLength(37);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test("real HTTP → workerd → Wasm: default font text reaches intersection callbacks", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const expression =
    "new Promise(resolve=>{const el=document.createElement('div');el.textContent='real text';document.body.appendChild(el);const observer=new IntersectionObserver(entries=>{observer.disconnect();resolve({height:el.getBoundingClientRect().height,intersecting:entries[0].isIntersecting,ratio:entries[0].intersectionRatio});});observer.observe(el);})";
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    value: { height: 18, intersecting: true, ratio: 1 },
  });
});

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: clip geometry variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`clip-geometry/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      value: Object.fromEntries(
        [
          "hiddenTarget",
          "rootClip",
          "empty",
          "emptySeparated",
          "degenerate",
          "inset",
          "box",
          "mutation",
          "none",
          "polygon",
          "calc",
          "em",
          "viewport",
          "escaped",
          "nonContainingRoot",
        ].map((key) => [key, true]),
      ),
    });
  },
);
