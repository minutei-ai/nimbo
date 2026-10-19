import { expect, test } from "bun:test";
import {
  comparePage,
  comparisonBinary,
  origin,
  requestAtomicInline,
  requests,
  sheetPromise,
  worker,
} from "./browser-live-setup";

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: DOM event dispatch and abortable listeners variant %i",
  async (variant) => {
    const url = new URL(`events/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "globalThis.comparison" }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    const expected = {
      phases: true,
      reset: true,
      captures: true,
      duplicates: true,
      once: true,
      propagation: true,
      immediate: true,
      cancellation: true,
      uncancelable: true,
      passive: true,
      defaultPolicy: true,
      mutated: true,
      object: true,
      reentry: true,
      errors: true,
      abort: true,
      preAbort: true,
      pathStable: true,
      guarded: true,
      lifecycle: ["document:interactive:2", "window:interactive:3", "load:complete:2"],
      lifecycleTrusted: true,
    };
    expect(result).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: expected,
    });
    expect(requests).toContain(`GET /events/${variant}`);
    if (comparisonBinary) expect(await comparePage(url)).toEqual({ ...expected, errors: false });
  },
);

test("real HTTP → workerd → Wasm: exponential variable substitution becomes invalid and uses fallback", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const expression =
    "(() => {const el=document.createElement('div');el.style.cssText='--p0:1px;'+Array.from({length:24},(_,i)=>'--p'+(i+1)+':var(--p'+i+') var(--p'+i+');').join('')+'width:var(--p24,42px);';document.body.appendChild(el);return el.getBoundingClientRect().width===42;})()";
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: true });
});

test.each([
  [
    "response bytes",
    sheetPromise("/sheets-css/oversized"),
    "resource limit: stylesheet total bytes",
  ],
  [
    "aggregate bytes",
    `Promise.all([${sheetPromise("/sheets-css/total-a")},${sheetPromise("/sheets-css/total-b")}])`,
    "resource limit: stylesheet total bytes",
  ],
  [
    "integrity",
    "new Promise(()=>{const link=document.createElement('link');link.setAttribute('rel','stylesheet');link.setAttribute('href','/sheets-css/main');link.setAttribute('integrity','sha256-invalid');document.head.appendChild(link);})",
    "stylesheet integrity is not implemented",
  ],
])(
  "real HTTP → workerd → Wasm: external stylesheets reject %s and recover",
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
      body: JSON.stringify({ url, expression: sheetPromise("/sheets-css/main") }),
    });
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: true });
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: contextual native font and query lengths variant %i",
  async (variant) => {
    const url = new URL(`font-queries/${variant}`, origin.url).href;
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
    expect(Object.keys(value)).toHaveLength(78);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test("real HTTP → workerd → Wasm: binary transport byte limit and recovery", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression:
        "fetch('/binary/large').then(response=>response.arrayBuffer()).then(buffer=>buffer.byteLength)",
    }),
  });
  expect(response.status).toBe(413);
  const error: unknown = expect.stringContaining("byte limit");
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
});

test("real HTTP → workerd → Wasm: rejected canvas resize preserves bitmap and state", async () => {
  const url = new URL("canvas/129", origin.url).href;
  const expression =
    "(()=>{const c=new OffscreenCanvas(1024,2),x=c.getContext('2d');x.fillStyle='red';x.fillRect(0,0,1,1);let limit=false;try{c.height=2048}catch(e){limit=String(e).includes('canvas: pixels limit')}const data=x.getImageData(0,0,1,1).data;return limit&&c.width===1024&&c.height===2&&x.fillStyle==='#ff0000'&&data[0]===255&&data[3]===255})()";
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ value: true });
});

test.each([0, -1, 1.5, 4097, "2048", true, null, {}])(
  "real HTTP → workerd → Wasm: invalid layout node budget %j is rejected before navigation",
  async (maxLayoutNodes) => {
    const url = new URL("layout-budget/0", origin.url).href,
      count = requests.length;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, maxLayoutNodes, expression: "true" }),
    });
    expect(response.status).toBe(400);
    expect(requests.length).toBe(count);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native background image layers variant %i",
  async (variant) => {
    const url = new URL(`background-images/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: `backgroundImagesCase(${variant})` }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null)
      throw new Error("Missing background image values");
    expect(Object.keys(value)).toHaveLength(48);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test("real HTTP → workerd → Wasm: expanded positioning serialization is bounded", async () => {
  const url = new URL("background-position/0", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression:
        "(()=>{const e=document.body;e.style.backgroundImage=Array(2048).fill('none').join(',');e.style.backgroundPosition='min('+Array(512).fill('10%').join(',')+') top';return getComputedStyle(e).backgroundPositionX})()",
    }),
  });
  expect(response.status).toBe(422);
  expect(await response.text()).toContain("computed background position bytes");
});

test("real HTTP → workerd → Wasm: expanded sizing expression copies consume work", async () => {
  const url = new URL("background-size/0", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression:
        "(()=>{const e=document.body;e.style.backgroundImage=Array(512).fill('none').join(',');e.style.backgroundSize='min('+Array(32).fill('10%,2px').join(',')+')';return getComputedStyle(e).backgroundSize})()",
    }),
  });
  expect(response.status).toBe(422);
  expect(await response.text()).toContain("DOM operations");
  const healthy = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression: "backgroundSizeCase(0)" }),
  });
  expect(healthy.status).toBe(200);
});

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: adopted stylesheet variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`adopted-sheets/${variant}`, origin.url).href,
        expression: `adoptedSheetsCase(${variant})`,
      }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing adoption checks");
    expect(Object.keys(value)).toHaveLength(36);
    for (const check of Object.values(value)) expect(check).toBe(true);
  },
);

test("real HTTP → workerd → Wasm: URL limits preserve query state and recover", async () => {
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url: new URL("urls/0", origin.url).href,
      expression: "urlsLimitsCase()",
    }),
  });
  expect(response.status).toBe(200);
  const result: unknown = await response.json();
  if (typeof result !== "object" || result === null) throw new Error("Missing result");
  expect(Reflect.get(result, "value")).toEqual({
    boundedURL: true,
    boundedQuery: true,
    statePreserved: true,
    recovered: true,
  });
});

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: animation frame callbacks variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`animation-frames/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing result");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing checks");
    expect(Object.keys(value)).toHaveLength(32);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test("real HTTP → workerd → Wasm: default fonts collapse tabs and line breaks", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const expression =
    "(()=>{const e=document.createElement('div');e.style.cssText='font:16px/1.5 serif;width:max-content';e.textContent='A\\tB';document.body.append(e);const a=e.getBoundingClientRect();e.textContent='A\\nB';const b=e.getBoundingClientRect();e.textContent='A B';const c=e.getBoundingClientRect();return {height:a.height,tab:a.width===c.width,newline:b.width===c.width};})()";
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ value: { height: 24, tab: true, newline: true } });
});

test("native inline flow places adjacent atomic boxes after text", async () => {
  const response = await requestAtomicInline(
    "(()=>{const p=document.createElement('section');p.style.cssText='font:16px/24px serif;width:max-content';p.append('A');document.body.append(p);const text=p.getBoundingClientRect().width;for(let i=0;i<2;i++){const e=document.createElement('div');e.style.cssText='display:inline-flex;width:20px;height:20px';p.append(e);}const box=p.getBoundingClientRect(),first=p.firstElementChild.getBoundingClientRect(),last=p.lastElementChild.getBoundingClientRect();return {width:Math.abs(box.width-text-40)<.07,first:Math.abs(first.x-box.x-text)<.07,last:Math.abs(last.x-first.x-20)<.07,aligned:first.y===last.y,height:box.height>=24};})()",
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    value: { width: true, first: true, last: true, aligned: true, height: true },
  });
});

test.each([
  [
    "vertical alignment",
    "const p=document.createElement('section'),e=document.createElement('div');e.style.cssText='display:inline-flex;vertical-align:text-bottom;width:20px;height:20px';p.append(e);document.body.append(p);return p.getBoundingClientRect()",
    "atomic inline vertical alignment",
  ],
  [
    "unimplemented control appearance",
    "const p=document.createElement('section'),e=document.createElement('button');e.style.cssText='display:inline-flex;appearance:textfield;width:20px;height:20px';p.append(e);document.body.append(p);return p.getBoundingClientRect()",
    "appearance",
  ],
  [
    "inline grid",
    "const p=document.createElement('section'),e=document.createElement('div');e.style.cssText='display:inline-grid;width:20px;height:20px';p.append(e);document.body.append(p);return p.getBoundingClientRect()",
    "display formatting",
  ],
])(
  "native atomic inline flow rejects unsupported %s and recovers",
  async (_name, setup, message) => {
    const failed = await requestAtomicInline("(()=>{" + setup + "})()");
    expect(failed.status).toBe(422);
    expect(await failed.text()).toContain(message);
    const healthy = await requestAtomicInline("globalThis.comparison");
    expect(healthy.status).toBe(200);
    expect(await healthy.json()).toMatchObject({
      value: { text: true, box: true, button: true, shrink: true },
    });
  },
);

test.each([
  ["import", '@import url("/extra.css");'],
  ["page", "@page { margin: 1cm; }"],
  ["scope", "@scope (.outer) { body { color: red; } }"],
])("unsupported stylesheet rules preserve their name: %s", async (name, source) => {
  const expression = `(()=>{const style=document.createElement('style');style.textContent=${JSON.stringify(source)};document.head.append(style);return getComputedStyle(document.body).display})()`;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url: new URL("geometry-empty", origin.url).href, expression }),
  });
  expect(response.status).toBe(422);
  const error: unknown = expect.stringContaining(`stylesheet at-rule: ${name}`);
  expect(await response.json()).toMatchObject({ error });
});
