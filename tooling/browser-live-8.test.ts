import { expect, test } from "bun:test";
import { origin, requestAuthoredButton, requests, worker } from "./browser-live-setup";

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: module graph failures remain explicit variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`module-failures/${variant}`, origin.url).href,
        expression: "'must not succeed'",
      }),
    });
    expect(response.status).toBe(422);
    const result: unknown = await response.json();
    const error: unknown =
      typeof result === "object" && result !== null ? Reflect.get(result, "error") : undefined;
    expect(typeof error).toBe("string");
    const expected = [
      /variable name expected/,
      /bare module specifier/,
      /origin policy/,
      /import attributes/,
      /module requires JavaScript MIME/,
      /404/,
      /export/,
      /module rejected/,
    ][variant % 8];
    if (!expected) throw new Error("missing failure expectation");
    expect(error).toMatch(expected);
  },
);

test("real HTTP → workerd → Wasm: encoding input and live decoder budgets recover across requests", async () => {
  const url = new URL("custom-elements-empty", origin.url).href;
  const expression = `(() => {
    const fails = fn => {try {fn();return false;} catch(error) {return error.message.includes('limit');}};
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const input = fails(() => encoder.encode('x'.repeat(65537))) && fails(() => decoder.decode(new Uint8Array(65537)));
    const boundary = encoder.encode('x'.repeat(65536)).length === 65536 && decoder.decode(new Uint8Array(65536)).length === 65536;
    const live = [decoder];
    while(live.length < 128) live.push(new TextDecoder());
    const capacity = fails(() => new TextDecoder());
    return {input,boundary,capacity,reusable:decoder.decode(new Uint8Array([65])) === 'A'};
  })()`;
  for (let iteration = 0; iteration < 3; iteration++) {
    // The Worker allows one active page; repeat failures and reuse sequentially.
    // oxlint-disable-next-line no-await-in-loop
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression }),
    });
    expect(response.status).toBe(200);
    // Read this response before starting the next page.
    // oxlint-disable-next-line no-await-in-loop
    expect(await response.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: { input: true, boundary: true, capacity: true, reusable: true },
    });
  }
});

test.each(["nodes", "depth"])(
  "real HTTP → workerd → Wasm: geometry %s budget is bounded and recoverable",
  async (mode) => {
    const url = new URL("geometry-empty", origin.url).href;
    const expression = `(() => {const root=document.createElement('div');document.body.appendChild(root);let parent=root;for(let i=0;i<${mode === "nodes" ? 1030 : 130};i++){const el=document.createElement('div');parent.appendChild(el);${mode === "depth" ? "parent=el;" : ""}}return root.getBoundingClientRect();})()`;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression }),
    });
    expect(response.status).toBe(422);
    const message: unknown = expect.stringContaining("resource limit: layout tree");
    expect(await response.json()).toEqual({ error: message });
    const recovered = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "document.body.getBoundingClientRect().width > 0" }),
    });
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: true });
  },
);

test.each([
  [
    "write bytes",
    "document.body.append('x'.repeat(4*1024*1024+1))",
    "resource limit: DOM write bytes",
  ],
  [
    "operations",
    "(()=>{for(let i=0;i<10000;i++)document.body.append('');})()",
    "resource limit: DOM operations",
  ],
])(
  "real HTTP → workerd → Wasm: variadic insertion enforces %s and recovers",
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
      body: JSON.stringify({
        url,
        expression:
          "(()=>{const p=document.createElement('div');document.body.append(p);p.append('b');p.firstChild.before('a');p.firstChild.after('c');return p.textContent==='acb';})()",
      }),
    });
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: true });
  },
);

test("real HTTP → workerd → Wasm: indexed native cascade accepts 4096 selectors", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const expression = `(()=>{const target=document.createElement('div');target.className='target';target.style.height='0';document.body.appendChild(target);const sheet=document.createElement('style');sheet.textContent=Array.from({length:4095},(_,i)=>'.missing_'+i+'{width:1px}').join('')+'.target{width:37px}';document.head.appendChild(sheet);return target.getBoundingClientRect().width;})()`;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: 37 });
});

for (const defaultFontSize of [0, 513, 1.5, "16"]) {
  test(`real HTTP → workerd: invalid initial font size ${defaultFontSize} is rejected before navigation`, async () => {
    const url = new URL("geometry-empty", origin.url).href;
    const before = requests.length;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, media: { defaultFontSize }, expression: "1" }),
    });
    expect(response.status).toBe(400);
    expect(requests.length).toBe(before);
  });
}

test.each([
  ["new Response('text')", "Response construction"],
  ["fetch('/binary/data/0').then(response=>response.body)", "response streams"],
] as const)(
  "real HTTP → workerd → Wasm: explicit response diagnostic %s",
  async (expression, reason) => {
    const url = new URL("geometry-empty", origin.url).href;
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
          "fetch('/binary/data/0').then(response=>response.bytes()).then(bytes=>bytes.length)",
      }),
    });
    expect(healthy.status).toBe(200);
    expect(await healthy.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: 512 });
  },
);

test.each([
  {
    name: "pixel work",
    expression:
      "(()=>{const x=new OffscreenCanvas(1024,1024).getContext('2d'),d=new ImageData(1024,1024);for(let i=0;i<13;i++)x.reset();x.putImageData(d,0,0)})()",
    reason: "canvas: pixel work limit",
  },
  {
    name: "operation count",
    expression:
      "(()=>{const x=new OffscreenCanvas(1,1).getContext('2d'),d=new ImageData(1,1);for(let i=0;i<10000;i++)x.putImageData(d,0,0)})()",
    reason: "canvas: operation limit",
  },
])(
  "real HTTP → workerd → Wasm: canvas upload $name boundary and recovery",
  async ({ expression, reason }) => {
    const url = new URL("canvas/130", origin.url).href;
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
      body: JSON.stringify({ url, expression: "canvasUploadCase(0)" }),
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
  "real HTTP → workerd → Wasm: native background positioning variant %i",
  async (variant) => {
    const url = new URL(`background-position/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: `backgroundPositionCase(${variant})` }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null)
      throw new Error("Missing background positioning values");
    expect(Object.keys(value)).toHaveLength(64);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test("real HTTP → workerd → Wasm: unsupported sizing geometry stays explicit", async () => {
  const url = new URL("background-size/0", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression:
        "(()=>{document.body.style.backgroundSize='2ex';return document.body.getBoundingClientRect()})()",
    }),
  });
  expect(response.status).toBe(422);
  expect(await response.text()).toContain("relative query length");
});

test.each(["inline-block", "flow-root"])(
  "real HTTP → workerd → Wasm: computed %s display has native formatting",
  async (display) => {
    const url = new URL("display/0", origin.url).href;
    const expression = `(()=>{document.body.innerHTML='<div></div>';const e=document.body.firstElementChild;e.style.cssText='display:${display};width:23px;height:7px';const r=e.getBoundingClientRect();return {display:getComputedStyle(e).display,support:CSS.supports('display',e.style.display),width:r.width,height:r.height}})()`;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      value: { display, support: true, width: 23, height: 7 },
    });
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: positioned boxes variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`positioned-boxes/${variant}`, origin.url).href,
        expression: `positionedBoxesCase(${variant})`,
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

test("real HTTP → workerd → Wasm: unsupported transition interpolation fails and releases the page", async () => {
  const url = new URL("outlines/0", origin.url).href;
  const failed = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression:
        "(()=>{const b=document.body;b.style.cssText='color:red;transition:color 1s';getComputedStyle(b).color;b.style.color='blue';return getComputedStyle(b).color})()",
    }),
  });
  expect(failed.status).toBe(422);
  expect(await failed.text()).toContain("transition interpolation: color");
  const healthy = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression: "document.body.style.transitionDuration" }),
  });
  expect(healthy.status).toBe(200);
});

test.each([0, -1, 1.5, 1_000_001, "20000", true, null, {}])(
  "real HTTP → workerd → Wasm: invalid DOM operation budget %j fails before navigation",
  async (maxDomOperations) => {
    const url = new URL("dom-budget/0", origin.url).href,
      count = requests.length;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "true", maxDomOperations }),
    });
    expect(response.status).toBe(400);
    expect(requests.length).toBe(count);
  },
);

test.each([
  [
    "button defaults",
    "for(const s of document.querySelectorAll('style'))s.remove();const b=document.createElement('button');b.style.display='flex';document.body.append(b);return b.getBoundingClientRect()",
    "button UA default",
  ],
  [
    "partial font variant",
    "const e=document.createElement('div');e.style.fontVariantCaps='small-caps';e.textContent='AB';document.body.append(e);return e.getBoundingClientRect()",
    "text font features or variations",
  ],
  [
    "font feature setting",
    "const e=document.createElement('div');e.style.fontFeatureSettings='\"kern\" 0';e.textContent='AB';document.body.append(e);return e.getBoundingClientRect()",
    "text font features or variations",
  ],
  [
    "font variation setting",
    "const e=document.createElement('div');e.style.fontVariationSettings='\"wght\" 600';e.textContent='AB';document.body.append(e);return e.getBoundingClientRect()",
    "text font features or variations",
  ],
])("native authored controls reject unsupported %s and recover", async (_name, setup, message) => {
  const failed = await requestAuthoredButton("(()=>{" + setup + "})()");
  expect(failed.status).toBe(422);
  expect(await failed.text()).toContain(message);
  const healthy = await requestAuthoredButton("globalThis.comparison");
  expect(healthy.status).toBe(200);
  expect(await healthy.json()).toMatchObject({
    value: { base: true, natural: true, inherit: true, disabled: true },
  });
});

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: logical border geometry variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`logical-borders/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(body, "value");
    if (typeof value !== "object" || value === null)
      throw new Error("Missing logical border checks");
    expect(Object.keys(value)).toHaveLength(20);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);
