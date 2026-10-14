import { expect, test } from "bun:test";
import {
  comparePage,
  comparisonBinary,
  encodingExpected,
  origin,
  requests,
  styleVariablesExpected,
  variablesExpected,
  worker,
} from "./browser-live-setup";

test("real HTTP → workerd → Wasm: timer deadline releases page capacity", async () => {
  const started = performance.now();
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url: new URL("tree/0", origin.url).href,
      expression: "new Promise(resolve => setTimeout(resolve, 60000))",
    }),
  });
  expect(response.status).toBe(504);
  expect(performance.now() - started).toBeGreaterThanOrEqual(9000);
  expect(await response.json()).toEqual({ error: "scrape deadline or invalid input" });
  const recovered = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url: new URL("timers/63", origin.url).href,
      expression: "globalThis.comparisonPromise.then(value => value.fetched)",
    }),
  });
  expect(recovered.status).toBe(200);
  expect(await recovered.json()).toEqual({
    url: new URL("timers/63", origin.url).href,
    engine: "rust-wasm-quickjs",
    value: true,
  });
}, 20000);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native encoding Unicode and codec variant %i",
  async (variant) => {
    const url = new URL(`encoding/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "comparison" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: encodingExpected,
    });
    expect(requests).toContain(`GET /encoding/${variant}`);
    if (comparisonBinary) {
      expect(await comparePage(comparisonBinary, url)).toEqual({
        ...Object.fromEntries(Object.keys(encodingExpected).map((key) => [key, false])),
        views: true,
        utf16: true,
        coercion: true,
      });
    }
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native variable values and pending CSS shorthands variant %i",
  async (variant) => {
    const url = new URL(`style-variables/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "comparison" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: styleVariablesExpected,
    });
    expect(requests).toContain(`GET /style-variables/${variant}`);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native custom property resolution variant %i",
  async (variant) => {
    const url = new URL(`variables/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "comparison" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: variablesExpected,
    });
    expect(requests).toContain(`GET /variables/${variant}`);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native cascade layers variant %i",
  async (variant) => {
    const url = new URL(`layers/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "comparison" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: Object.fromEntries(
        [
          "anonymous",
          "anonymousImportant",
          "caseSensitive",
          "crossSheet",
          "crossSheetOrder",
          "dotted",
          "dottedReopened",
          "escaped",
          "importance",
          "important",
          "inactiveOrder",
          "inlineImportant",
          "inlineNormal",
          "invalidBlock",
          "media",
          "nested",
          "nestedImportant",
          "normal",
          "parent",
          "parentGroup",
          "reopened",
          "reorder",
          "reserved",
          "shorthand",
          "snapshot",
          "sourceOrder",
          "specificity",
          "unlayered",
          "unlayeredImportant",
          "variables",
        ].map((key) => [key, true]),
      ),
    });
  },
);

test("real HTTP → workerd → Wasm: registration resource limit and recovery", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const expression =
    "(()=>{const sheet=document.createElement('style');let css='';for(let i=0;i<1025;i++)css+='@property --p'+i+'{syntax:invalid;}';sheet.textContent=css;document.head.appendChild(sheet);return document.body.getBoundingClientRect().width;})()";
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(response.status).toBe(422);
  const error: unknown = expect.stringContaining("property registrations");
  expect(await response.json()).toMatchObject({ error });
  const healthy = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression: "document.body.children.length" }),
  });
  expect(healthy.status).toBe(200);
  expect(await healthy.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: 0 });
});

test.each([0, -1, 1.5, 2097153, "700000", true, null, {}])(
  "real HTTP → workerd → Wasm: invalid stylesheet budget %j is rejected before navigation",
  async (maxStylesheetBytes) => {
    const url = new URL("css-budget/130", origin.url).href;
    const count = requests.length;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, maxStylesheetBytes, expression: "true" }),
    });
    expect(response.status).toBe(400);
    expect(requests.length).toBe(count);
  },
);

test("real HTTP → workerd → Wasm: maximum-size canvas upload writes actual edge pixels", async () => {
  const url = new URL("canvas/131", origin.url).href;
  const expression =
    "(()=>{const c=new OffscreenCanvas(1024,1024),x=c.getContext('2d'),d=new ImageData(1024,1024);d.data.fill(255);x.putImageData(d,0,0);const a=x.getImageData(0,0,1,1).data,b=x.getImageData(1023,1023,1,1).data;return a[0]===255&&a[3]===255&&b[0]===255&&b[3]===255})()";
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ value: true });
}, 15000);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: logical dimensions and cascade variant %i",
  async (variant) => {
    const url = new URL(`logical-size/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: `logicalSizeCase(${variant})` }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing logical geometry");
    expect(Object.keys(value)).toHaveLength(45);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each([
  ["url(example.test/image.png)", "URL provenance and loading"],
  ["radial-gradient(red,blue)", "radial, conic or legacy gradient"],
  ["linear-gradient(red 2ex,blue)", "relative query length"],
  ["linear-gradient(red calc(infinity * 1px),blue)", "non-finite position"],
  ["linear-gradient(red calc(20% + 2px),blue)", "mixed percentage calculation"],
  ["linear-gradient(color(display-p3 1 0 0),blue)", "computed color space or context color"],
])("real HTTP → workerd → Wasm: explicit background image gap %s", async (image, detail) => {
  const url = new URL("background-images/0", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression: `(()=>{document.body.style.backgroundImage=${JSON.stringify(image)};return getComputedStyle(document.body).backgroundImage})()`,
    }),
  });
  expect(response.status).toBe(422);
  expect(await response.text()).toContain(detail);
  const healthy = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression: "backgroundImagesCase(0)" }),
  });
  expect(healthy.status).toBe(200);
});

test.each([
  ["background-attachment", "local"],
  ["background-origin", "content-box"],
  ["background-clip", "text"],
] as const)(
  "real HTTP → workerd → Wasm: background context %s budget and recovery",
  async (name, value) => {
    const url = new URL("background-layers/0", origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url,
        expression: `(()=>{document.body.style.setProperty(${JSON.stringify(name)},Array(10001).fill(${JSON.stringify(value)}).join(','));return getComputedStyle(document.body).getPropertyValue(${JSON.stringify(name)})})()`,
      }),
    });
    expect(response.status).toBe(422);
    expect(await response.text()).toContain(
      name === "background-origin" ? "CSS input limit" : "DOM operations",
    );
    const healthy = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "backgroundLayersCase(0)" }),
    });
    expect(healthy.status).toBe(200);
  },
);

test.each([
  { count: 600, nested: false, maxLayoutNodes: 512, reason: "layout tree: nodes" },
  { count: 130, nested: true, maxLayoutNodes: 2048, reason: "layout tree: depth" },
])(
  "real HTTP → workerd → Wasm: contents preserves $reason and recovery",
  async ({ count, nested, maxLayoutNodes, reason }) => {
    const url = new URL("custom-boxes/0", origin.url).href;
    const expression = `(()=>{document.body.innerHTML='';let parent=document.body;for(let i=0;i<${count};i++){const e=document.createElement('x-flat');e.style.display='contents';parent.append(e);${nested ? "parent=e;" : ""}}return document.body.getBoundingClientRect().width})()`;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression, maxLayoutNodes }),
    });
    expect(response.status).toBe(422);
    expect(await response.text()).toContain(reason);
    const recovered = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url,
        expression:
          "(()=>{document.body.innerHTML='<div style=\"width:11px;height:7px\"></div>';return document.body.firstElementChild.getBoundingClientRect().width})()",
      }),
    });
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ value: 11 });
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: SVG viewport variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`svg-viewport/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing result");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing checks");
    expect(Object.keys(value)).toHaveLength(39);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: order layout variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`order-layout/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      value: Object.fromEntries(
        [
          "flex",
          "stable",
          "computed",
          "mutation",
          "reverse",
          "block",
          "grid",
          "generated",
          "contents",
        ].map((key) => [key, true]),
      ),
    });
  },
);

test.each(["capitalize", "full-width", "full-size-kana"])(
  "real HTTP → workerd → Wasm: unsupported text-transform %s and recovery",
  async (mode) => {
    const url = new URL("text-transform/0", origin.url).href;
    const request = (expression: string) =>
      worker.dispatchFetch("https://nimbo.test/scrape", {
        method: "POST",
        headers: { authorization: "Bearer test-secret" },
        body: JSON.stringify({ url, expression }),
      });
    const failed = await request(
      `(()=>{const e=document.createElement('div');e.style.textTransform=${JSON.stringify(mode)};e.textContent='sample';document.body.append(e);return e.getBoundingClientRect();})()`,
    );
    expect(failed.status).toBe(422);
    expect(await failed.text()).toContain("text-transform");
    const healthy = await request("globalThis.comparison");
    expect(healthy.status).toBe(200);
    expect(await healthy.json()).toMatchObject({
      value: { upperLatin: true, languageInheritance: true },
    });
  },
);
