import { expect, test } from "bun:test";
import {
  comparePage,
  comparisonBinary,
  join,
  origin,
  requests,
  stylesExpected,
  worker,
} from "./browser-live-setup";

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: real-clock timers and microtasks variant %i",
  async (variant) => {
    const url = new URL(`timers/${variant}`, origin.url).href;
    const started = performance.now();
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "globalThis.comparisonPromise" }),
    });
    expect(response.status).toBe(200);
    expect(performance.now() - started).toBeGreaterThanOrEqual(30);
    const expected = {
      order: "micro,promise,a,a-micro,b,c",
      context: true,
      canceled: true,
      interval: true,
      coercion: true,
      nested: true,
      errors: true,
      string: true,
      guarded: true,
      ids: true,
      fetched: true,
    };
    expect(await response.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: expected,
    });
    expect(requests).toContain(`GET /timers/${variant}`);
    expect(requests).toContain("POST /echo");
    if (comparisonBinary)
      expect(await comparePage(url)).toEqual({ ...expected, errors: false, guarded: false });
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native inline declarations and live CSS styles variant %i",
  async (variant) => {
    const url = new URL(`styles/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "comparison" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: stylesExpected,
    });
    expect(requests).toContain(`GET /styles/${variant}`);
  },
);

test.each([
  [
    "expanded declarations",
    "for(let i=0;i<2;i++){const css=document.createElement('style');css.textContent='*{'+Array.from({length:600},(_,j)=>'--x_'+i+'_'+j+':1;').join('')+'}';document.body.appendChild(css);}",
    "CSS declaration limit",
  ],
  [
    "total bytes",
    "for(let i=0;i<5;i++){const css=document.createElement('style');css.textContent='/*'+'x'.repeat(59996)+'*/';document.body.appendChild(css);}",
    "resource limit: stylesheet total bytes",
  ],
  [
    "total selectors",
    "for(let i=0;i<65;i++){const css=document.createElement('style');css.textContent=Array.from({length:64},(_,j)=>'.x'+i+'_'+j).join(',')+'{width:1px}';document.body.appendChild(css);}",
    "resource limit: stylesheet selectors",
  ],
])(
  "real HTTP → workerd → Wasm: stylesheet %s quota is shared across sheets",
  async (_name, setup, reason) => {
    const url = new URL("geometry-empty", origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url,
        expression: `(() => {${setup}return document.body.getBoundingClientRect();})()`,
      }),
    });
    expect(response.status).toBe(422);
    const message: unknown = expect.stringContaining(reason);
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

test("real HTTP → workerd → Wasm: native feature support ignores overridden page query functions", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const expression =
    "(()=>{CSS.supports=()=>false;const target=document.createElement('div');document.body.appendChild(target);const sheet=document.createElement('style');sheet.textContent='@supports(width:1px){div{width:50px}}';document.head.appendChild(sheet);return target.getBoundingClientRect().width===50;})()";
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: true });
});

test("real HTTP → workerd → Wasm: native animation keyframe budget recovers", async () => {
  const url = new URL("geometry/0", origin.url).href;
  const expression = `(()=>{const target=document.createElement('div');target.style.cssText='height:0;width:11px';document.body.appendChild(target);const sheet=document.createElement('style');sheet.textContent='@keyframes demo{'+Array.from({length:1025},()=> '50%{width:30px}').join('')+'}';document.head.appendChild(sheet);let failure;try{target.getBoundingClientRect();}catch(error){failure=error.message;}sheet.remove();const width=target.getBoundingClientRect().width;target.remove();return {failure,width};})()`;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(response.status).toBe(200);
  const failure: unknown = expect.stringContaining("animation keyframes");
  expect(await response.json()).toEqual({
    url,
    engine: "rust-wasm-quickjs",
    value: { failure, width: 11 },
  });
});

for (const initial of [1, 512]) {
  test(`real HTTP → workerd → Wasm: configured font endpoint ${initial} remains usable`, async () => {
    const url = new URL("geometry-empty", origin.url).href;
    const script = await Bun.file(
      join(import.meta.dir, "../crates/engine/tests/fixtures/font-config.txt"),
    ).text();
    const expression = `(()=>{globalThis.variant=${initial - 16};return ${script};})()`;
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
  });
}

test.each([
  { css: "border:1ic solid", reason: "relative query length" },
  { css: "border-image-source:url('/image')", reason: "border-image-source" },
  {
    css: "border-inline-start-width:2px",
    reason: "border-inline-start-width",
    geometryOnly: true,
  },
  { css: "border-top-left-radius:2px", reason: "border-top-left-radius", geometryOnly: true },
])(
  "real HTTP → workerd → Wasm: border geometry boundary $css and recovery",
  async ({ css, reason, geometryOnly }) => {
    const url = new URL("borders/128", origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url,
        expression: geometryOnly
          ? `(()=>{const e=document.createElement('div');document.body.append(e);const before=e.getBoundingClientRect();e.style.cssText=${JSON.stringify(css)};const after=e.getBoundingClientRect();return {stable:before.x===after.x&&before.y===after.y&&before.width===after.width&&before.height===after.height};})()`
          : `(()=>{const e=document.createElement('div');e.style.cssText=${JSON.stringify(css)};document.body.append(e);return e.getBoundingClientRect()})()`,
      }),
    });
    if (geometryOnly) {
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ value: { stable: true } });
    } else {
      expect(response.status).toBe(422);
      expect(await response.text()).toContain(reason);
    }
    const healthy = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "borderCase(0)" }),
    });
    expect(healthy.status).toBe(200);
    const result: unknown = await healthy.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing recovery");
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test("real HTTP → workerd → Wasm: background image state does not block box geometry", async () => {
  const url = new URL("background-images/0", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression:
        "(()=>{document.body.style.cssText='width:40px;height:10px;background-image:url(https://example.test/image.png)';return document.body.getBoundingClientRect()})()",
    }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ value: { width: 40, height: 10 } });
});

test.each([
  ["2ex", "relative query length"],
  ["calc(infinity * 1px)", "non-finite value"],
  [`calc(${Array(40).fill("min(10%, 2px)").join(" + ")})`, "background position nesting"],
] as const)(
  "real HTTP → workerd → Wasm: unsupported sizing %s fails explicitly",
  async (size, detail) => {
    const url = new URL("background-size/0", origin.url).href;
    const failed = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url,
        expression: `(()=>{document.body.style.backgroundSize=${JSON.stringify(size)};return getComputedStyle(document.body).backgroundSize})()`,
      }),
    });
    expect(failed.status).toBe(422);
    expect(await failed.text()).toContain(detail);
    const healthy = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "backgroundSizeCase(0)" }),
    });
    expect(healthy.status).toBe(200);
  },
);

test("real HTTP → workerd → Wasm: constructed stylesheet unsupported scope stays explicit", async () => {
  const url = new URL("constructed-sheets/0", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression:
        "(()=>{const s=new CSSStyleSheet();const failures=[];for(const fn of [()=>s.insertRule('@media all {div{width:1px}}'),()=>new CSSStyleSheet({disabled:true}),()=>s.insertRule('div{& span {width:1px}}')]){try{fn();failures.push('missing')}catch(e){failures.push(e.name)}}return {failures,length:s.cssRules.length}})()",
    }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    value: { failures: ["NotSupportedError", "NotSupportedError", "NotSupportedError"], length: 0 },
  });
});

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: namespaced element variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`namespaced-elements/${variant}`, origin.url).href,
        expression: `namespacedElementsCase(${variant})`,
      }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing result");
    const checks: unknown = Reflect.get(result, "value");
    if (typeof checks !== "object" || checks === null) throw new Error("Missing checks");
    expect(Object.keys(checks)).toHaveLength(38);
    expect(Object.values(checks).every((value) => value === true)).toBe(true);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: contextual box lengths configured media variant %i",
  async (variant) => {
    const media = {
      width: 321 + variant * 8,
      height: 217 + variant * 7,
      defaultFontSize: 10 + (variant % 16),
    };
    const expression = `(()=>{document.documentElement.style.fontSize='initial';document.body.style.fontSize='inherit';const box=document.createElement('div');box.style.cssText='width:2rem;height:10vh';document.body.append(box);const rect=box.getBoundingClientRect();return Math.abs(rect.width-${media.defaultFontSize * 2})<.01&&Math.abs(rect.height-${media.height / 10})<.01&&innerWidth===${media.width}&&innerHeight===${media.height}&&getComputedStyle(document.documentElement).fontSize==='${media.defaultFontSize}px'})()`;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL("contextual-box-lengths/0", origin.url).href,
        expression,
        media,
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ value: true });
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: public font profile variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`font-profile/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      value: Object.fromEntries(
        [
          "regular",
          "bold",
          "italic",
          "boldItalic",
          "light",
          "medium",
          "semibold",
          "positive",
          "negative",
          "combining",
          "ligatureSpacing",
          "characterSpacing",
          "fontRemoval",
          "fontSize",
        ].map((key) => [key, true]),
      ),
    });
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: box shadow geometry variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`box-shadow-geometry/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(body, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing shadow checks");
    expect(Object.keys(value)).toHaveLength(16);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);
