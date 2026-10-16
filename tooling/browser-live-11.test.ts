import { expect, test } from "bun:test";
import {
  comparePage,
  comparisonBinary,
  datasetExpected,
  join,
  origin,
  requests,
  sheetPromise,
  worker,
} from "./browser-live-setup";

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native media queries and explicit preferences variant %i",
  async (variant) => {
    const url = new URL(`media/${variant}`, origin.url).href;
    const media = {
      width: 800 + variant,
      height: 600 + (variant % 2) * 300,
      colorScheme: variant % 2 === 0 ? "dark" : "light",
      reducedMotion: variant % 3 === 0,
    };
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, media, expression: "comparison" }),
    });
    expect(response.status).toBe(200);
    const expected = Object.fromEntries(
      [
        "identity",
        "serialized",
        "sizes",
        "ranges",
        "negative",
        "orientation",
        "ratio",
        "logical",
        "unknown",
        "types",
        "malformed",
        "escaped",
        "empty",
        "input",
        "events",
        "guards",
      ].map((key) => [key, true]),
    );
    expect(await response.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: {
        ...expected,
        width: media.width,
        height: media.height,
        dark: media.colorScheme === "dark",
        reduced: media.reducedMotion,
      },
    });
    // The pinned comparator does not produce a completed value for this fixture.
    if (comparisonBinary) expect(await comparePage(comparisonBinary, url)).toBeNull();
    expect(requests).toContain(`GET /media/${variant}`);
  },
);

test.each(["value", "attribute", "entries"])(
  "real HTTP → workerd → Wasm: CSS %s limits release page state",
  async (mode) => {
    const url = new URL("styles/0", origin.url).href;
    const expression =
      mode === "value"
        ? "document.createElement('div').style.setProperty('--large','x'.repeat(65537))"
        : mode === "attribute"
          ? "(()=>{const el=document.createElement('div');el.setAttribute('style','x'.repeat(65537));return el.style.length;})()"
          : "document.createElement('div').style.cssText=Array.from({length:1025},(_,i)=>'--n'+i+': x').join(';')";
    const failed = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression }),
    });
    expect(failed.status).toBe(422);
    const message: unknown = expect.stringMatching(
      /^JavaScript: Error: (?:DOM: )?CSS (?:input|declaration) limit(?:\n|$)/,
    );
    expect(await failed.json()).toEqual({ error: message });
    const recovered = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url,
        expression: "[document.createElement('div').style.length, typeof nimboStyle]",
      }),
    });
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: [0, "undefined"],
    });
  },
);

test("real HTTP → workerd → Wasm: external imports preserve the parent cascade", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const expression = `${sheetPromise("/sheets-css/has-import")}.then(()=>{return Number.isFinite(document.body.getBoundingClientRect().height);})`;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: true });
});

test("real HTTP → workerd → Wasm: generated boxes share the native layout tree budget", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const expression = `(()=>{const container=document.createElement('div');for(let i=0;i<500;i++)container.appendChild(document.createElement('div'));document.body.appendChild(container);const sheet=document.createElement('style');sheet.textContent='div::before,div::after{content:"";display:block;height:1px}';document.head.appendChild(sheet);let failed=false;try{container.getBoundingClientRect();}catch(error){failed=error.message.endsWith('resource limit: layout tree: nodes');}sheet.remove();container.remove();return failed&&Number.isFinite(document.body.getBoundingClientRect().height);})()`;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: true });
});

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native dataset variant %i",
  async (variant) => {
    const url = new URL(`dataset/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "comparison" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: datasetExpected,
    });
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: configured initial font size variant %i",
  async (variant) => {
    const initial = 16 + variant;
    const url = new URL("geometry-empty", origin.url).href;
    const script = await Bun.file(
      join(import.meta.dir, "../crates/engine/tests/fixtures/font-config.txt"),
    ).text();
    const expression = `(()=>{globalThis.variant=${variant};return ${script};})()`;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url,
        media: { width: initial * 10, height: initial * 8, defaultFontSize: initial },
        expression,
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: {
        initialRem: true,
        mediaRem: true,
        mediaEm: true,
        mediaRootIndependent: true,
        recovery: true,
      },
    });
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: configured stylesheet budget variant %i",
  async (variant) => {
    const url = new URL(`css-budget/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url,
        maxStylesheetBytes: 700000,
        expression: `cssBudgetCase(${variant})`,
      }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing checks");
    expect(Object.keys(value)).toHaveLength(12);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each([
  {
    name: "default nodes",
    path: "layout-budget/0",
    maxLayoutNodes: undefined,
    expression: "layoutBudgetCase(0)",
    reason: "layout tree: nodes",
  },
  {
    name: "below exact node count",
    path: "layout-budget/0",
    maxLayoutNodes: 1104,
    expression: "layoutBudgetCase(0)",
    reason: "layout tree: nodes",
  },
  {
    name: "depth",
    path: "layout-budget/depth/0",
    maxLayoutNodes: 4096,
    expression: "document.querySelector('#root').getBoundingClientRect()",
    reason: "layout tree: depth",
  },
  {
    name: "independent DOM operations",
    path: "layout-budget/0",
    maxLayoutNodes: 4096,
    expression:
      "(()=>{const r=document.querySelector('#root');for(let i=0;i<100;i++){r.style.width=(100+i)+'px';r.getBoundingClientRect()}})()",
    reason: "DOM operations",
  },
])(
  "real HTTP → workerd → Wasm: layout budget $name boundary and recovery",
  async ({ path, maxLayoutNodes, expression, reason }) => {
    const url = new URL(path, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, maxLayoutNodes, expression }),
    });
    expect(response.status).toBe(422);
    expect(await response.text()).toContain(reason);
    const healthy = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL("layout-budget/0", origin.url).href,
        maxLayoutNodes: 1105,
        expression: "layoutBudgetCase(0)",
      }),
    });
    expect(healthy.status).toBe(200);
    const result: unknown = await healthy.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing recovery");
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native computed display and blockification variant %i",
  async (variant) => {
    const url = new URL(`display/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: `displayCase(${variant})` }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing display values");
    expect(Object.keys(value)).toHaveLength(105);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: custom boxes and contents variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`custom-boxes/${variant}`, origin.url).href,
        expression: `customBoxesCase(${variant})`,
      }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing result");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing checks");
    expect(Object.keys(value)).toHaveLength(26);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: real-clock CSS transitions variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`transitions/${variant}`, origin.url).href,
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
  "real HTTP → workerd → Wasm: DOM operation budget variant %i",
  async (variant) => {
    const url = new URL(`dom-budget/${variant}`, origin.url).href;
    const expression = `(() => { const target=document.getElementById('example'); let valid=true; for(let i=0;i<12000+${variant};i++)valid=valid && target.getAttribute('data-index')===String(${variant}); return {valid,scriptExecuted}; })()`;
    const send = (maxDomOperations?: number) =>
      worker.dispatchFetch("https://nimbo.test/scrape", {
        method: "POST",
        headers: { authorization: "Bearer test-secret" },
        body: JSON.stringify({ url, expression, maxDomOperations }),
      });
    const configured = await send(20_000);
    expect(configured.status).toBe(200);
    expect(await configured.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: { valid: true, scriptExecuted: true },
    });
    const reject = async (budget?: number) => {
      const rejected = await send(budget);
      expect(rejected.status).toBe(422);
      expect(await rejected.text()).toContain("DOM operations");
    };
    // The shared isolate admits one scrape at a time.
    await reject();
    await reject(100);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: positioned generated variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`positioned-generated/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      value: Object.fromEntries(
        [
          "own",
          "flow",
          "rootOverflow",
          "percentage",
          "negative",
          "flex",
          "ancestor",
          "mutation",
          "stretch",
          "grid",
        ].map((key) => [key, true]),
      ),
    });
  },
);

test("external imports load relative resources before the parent event", async () => {
  const expression = await Bun.file(
    new URL("../crates/engine/tests/fixtures/stylesheet-imports.txt", import.meta.url),
  ).text();
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url: new URL("geometry-empty", origin.url).href, expression }),
  });
  expect(response.status).toBe(200);
  const result: unknown = await response.json();
  if (typeof result !== "object" || result === null) throw new Error("missing import response");
  const value: unknown = Reflect.get(result, "value");
  if (typeof value !== "object" || value === null) throw new Error("missing import checks");
  expect(Object.keys(value)).toHaveLength(16);
  expect(Object.values(value).every((check) => check === true)).toBe(true);
});

test.each([
  ["import-large.css", { maxStylesheetBytes: 1024 }, "stylesheet total bytes"],
  ["depth-0.css", {}, "request count"],
])("external imports enforce shared limits: %s", async (path, limits, message) => {
  const url = new URL("geometry-empty", origin.url).href;
  const expression = `new Promise(resolve=>{const link=document.createElement('link');link.rel='stylesheet';link.href='/sheets-css/${path}';link.onload=()=>resolve(true);link.onerror=()=>resolve(false);document.head.append(link);})`;
  const failed = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression, ...limits }),
  });
  expect(failed.status).toBe(422);
  expect(await failed.text()).toContain(message);
  const fresh = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression: "document.styleSheets.length" }),
  });
  expect(fresh.status).toBe(200);
  expect(await fresh.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: 0 });
});
