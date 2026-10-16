import { expect, test } from "bun:test";
import { origin, requests, worker } from "./browser-live-setup";
import { Schema } from "effect";
import { Success } from "@nimbo/client/schema";

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd: invalid media environments are rejected before navigation variant %i",
  async (variant) => {
    const invalid = [
      { width: 0 },
      { height: 0 },
      { width: 16385 },
      { height: 16385 },
      { width: 1.5 },
      { height: "600" },
      { colorScheme: "invalid" },
      { reducedMotion: 1 },
    ][variant % 8];
    const url = new URL(`media/invalid-${variant}`, origin.url).href;
    const before = requests.length;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, media: invalid, expression: "1" }),
    });
    expect(response.status).toBe(400);
    expect(requests.slice(before)).not.toContain(`GET /media/invalid-${variant}`);
  },
);

test("real HTTP → workerd → Wasm: registry quotas and fresh request recovery", async () => {
  const url = new URL("custom-elements-empty", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression: `(async () => {
      for (let i=0;i<1024;i++) customElements.define('x-limit-'+i,class extends HTMLElement{});
      let definitionLimit=false;
      try {customElements.define('x-overflow',class extends HTMLElement{})} catch(error) {definitionLimit=error.message==='custom element definition limit'}
      for (let i=0;i<1024;i++) customElements.whenDefined('x-pending-'+i);
      let promiseLimit=false;
      try {await customElements.whenDefined('x-pending-overflow')} catch(error) {promiseLimit=error.message==='when-defined promise limit'}
      return [definitionLimit,promiseLimit,customElements.get('x-overflow')===undefined];
    })()`,
    }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    url,
    engine: "rust-wasm-quickjs",
    value: [true, true, true],
  });
  const recovery = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression:
        "[customElements.get('x-limit-0')===undefined,typeof nimboDom,customElements instanceof CustomElementRegistry]",
    }),
  });
  expect(recovery.status).toBe(200);
  expect(await recovery.json()).toEqual({
    url,
    engine: "rust-wasm-quickjs",
    value: [true, "undefined", true],
  });
});

test.each([
  ["bytes", "'x'.repeat(262145)", "resource limit: stylesheet bytes"],
  [
    "selectors",
    "Array.from({length:4097},(_,i)=>'.x'+i).join(',')+'{width:1px}'",
    "resource limit: stylesheet selectors",
  ],
  [
    "rules",
    "Array.from({length:4097},(_,i)=>'.x'+i+'{width:1px}').join('')",
    "resource limit: stylesheet rules",
  ],
  [
    "nesting",
    "':is('.repeat(34)+'.x'+')'.repeat(34)+'{width:1px}'",
    "resource limit: stylesheet nesting",
  ],
  ["nested unknown rule", "'div { @unknown{} }'", "layout unsupported: nested stylesheet rule"],
  ["scope", "'@scope (.test) {div {width:1px;}}'", "layout unsupported: stylesheet at-rule"],
  [
    "forgiving recovery",
    "':is(.x, :bogus#never) {width:1px;}'",
    "layout unsupported: forgiving selector recovery",
  ],
])(
  "real HTTP → workerd → Wasm: stylesheet %s fails explicitly and releases the request",
  async (_name, source, reason) => {
    const url = new URL("geometry-empty", origin.url).href;
    const expression = `(() => {const css=document.createElement('style');css.textContent=${source};document.body.appendChild(css);return document.body.getBoundingClientRect();})()`;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression }),
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

test("real HTTP → workerd → Wasm: native dataset exposes unsupported exotic descriptors", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const expression =
    "(()=>{const e=document.createElement('div'),d=e.dataset;return !Reflect.defineProperty(d,'locked',{value:'x',configurable:false})&&!Reflect.defineProperty(d,'accessor',{get(){return 'x';}})&&!e.hasAttribute('data-locked')&&!e.hasAttribute('data-accessor');})()";
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: true });
});

for (const [name, css, reason] of [
  [
    "style conditions",
    "@container style(--value:test){.target{width:1px}}",
    "container style query",
  ],
  [
    "scroll-state conditions",
    "@container scroll-state(stuck:top){.target{width:1px}}",
    "container scroll-state query",
  ],
  [
    "glyph-relative conditions",
    "@container (width > 1ex){.target{width:1px}}",
    "container relative query length",
  ],
  ["name inheritance", ".target{container-name:inherit}", "container name inheritance"],
] as const) {
  test(`real HTTP → workerd → Wasm: container gap ${name} fails explicitly and recovers`, async () => {
    const url = new URL("geometry-empty", origin.url).href;
    const expression = `(()=>{const parent=document.createElement('div');parent.className='parent';const target=document.createElement('div');target.className='target';parent.appendChild(target);document.body.appendChild(parent);const sheet=document.createElement('style');sheet.textContent=${JSON.stringify(css)};document.head.appendChild(sheet);let failure='';try{target.getBoundingClientRect()}catch(error){failure=String(error)}sheet.remove();target.style.width='11px';return {failure,width:target.getBoundingClientRect().width};})()`;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression }),
    });
    expect(response.status).toBe(200);
    const failure: unknown = expect.stringContaining(reason);
    expect(await response.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: { failure, width: 11 },
    });
  });
}

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: font matching variant %i",
  async (variant) => {
    const url = new URL(`font-matching/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: `fontMatchCase(${variant})` }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing comparison");
    expect(Object.keys(value)).toHaveLength(55);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native canvas compositing variant %i",
  async (variant) => {
    const url = new URL(`canvas/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: `canvasCompositingCase(${variant})` }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing pixels");
    const checks: unknown = Reflect.get(value, "checks");
    if (typeof checks !== "object" || checks === null) throw new Error("Missing checks");
    expect(Object.keys(checks)).toHaveLength(222);
    expect(Object.values(checks).every((check) => check === true)).toBe(true);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: text adjustment cascade variant %i",
  async (variant) => {
    const url = new URL(`text-adjust/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: `textAdjustCase(${variant})` }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing adjustment values");
    expect(Object.keys(value)).toHaveLength(44);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test("real HTTP → workerd → Wasm: positioning preserves independent scalars and image layer count", async () => {
  const url = new URL("background-position/0", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression:
        "(()=>{const e=document.body;e.style.cssText='font-size:18px;background-position:2ex 30%';const s=getComputedStyle(e);const font=s.fontSize,y=s.backgroundPositionY;e.style.cssText='background-image:url(https://example.test/a),url(https://example.test/b);background-position:10px 20%';return {font,y,x:s.backgroundPositionX,layersY:s.backgroundPositionY,paint:CSS.supports('background-position-x','10px')}})()",
    }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    value: { font: "18px", y: "30%", x: "10px, 10px", layersY: "20%, 20%", paint: false },
  });
});

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native background layer context variant %i",
  async (variant) => {
    const url = new URL(`background-layers/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: `backgroundLayersCase(${variant})` }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null)
      throw new Error("Missing background layer values");
    expect(Object.keys(value)).toHaveLength(143);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test("real HTTP → workerd → Wasm: live collection iteration follows native mutations", async () => {
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url: new URL("large-dom/iteration", origin.url).href,
      expression: "collectionIterationCase()",
    }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    value: {
      large: true,
      keys: true,
      forEach: true,
      prepend: true,
      callback: true,
      entries: true,
      snapshot: true,
      tags: true,
      attributes: true,
      shadow: true,
      xml: true,
    },
  });
});

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: z-index computed state variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`z-index/${variant}`, origin.url).href,
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
  "real HTTP → workerd → Wasm: Window named properties variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`window-named/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing result");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing checks");
    expect(Object.keys(value)).toHaveLength(34);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: text baseline variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`text-baseline/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      value: Object.fromEntries(
        [
          "flex",
          "grid",
          "anonymous",
          "synthesis",
          "edges",
          "nested",
          "wrap",
          "normal",
          "fractional",
          "mutation",
        ].map((key) => [key, true]),
      ),
    });
  },
);

test.each([
  ["grid-template-columns:repeat(257,1px)", "div", "grid track limit"],
  ["grid-template-columns:[named] 1fr", "div", "named grid lines"],
  ["grid-template-columns:repeat(auto-fit,20px)", "div", "automatic grid repetition"],
  ["grid-column:span 257", "div", "overlarge grid placement"],
  ["", "ol", "list marker"],
])(
  "real HTTP → workerd → Wasm: bounded grid/list rejection and recovery %s",
  async (css, tag, error) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL("geometry-empty", origin.url).href,
        expression: `(()=>{const n=document.createElement(${JSON.stringify(tag)});n.style.cssText=${JSON.stringify(css)};document.body.append(n);return n.getBoundingClientRect().width})()`,
      }),
    });
    expect(response.status).toBe(422);
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) throw new Error("Missing rejection");
    expect(Reflect.get(body, "error")).toContain(error);
    const recovered = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL("explicit-grid/0", origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(recovered.status).toBe(200);
    const result: unknown = await recovered.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing recovery");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing geometry checks");
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

const selectorBudget = await Bun.file(
  new URL("../crates/engine/tests/fixtures/stylesheet-selector-budget.txt", import.meta.url),
).text();

test.each([
  [undefined, 81, 1, true],
  [undefined, 4096, 1, true],
  [undefined, 4097, 1, false],
  [undefined, 2049, 2, false],
  [8192, 8192, 1, true],
  [8192, 8193, 1, false],
  [8192, 4096, 2, true],
  [8192, 4097, 2, false],
  [32768, 8192, 4, true],
  [32768, 8193, 4, false],
])(
  "native stylesheet selector budget %s: %i selectors across %i sheets",
  async (maxStylesheetSelectors, count, sheets, accepted) => {
    const url = new URL("geometry-empty", origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url,
        expression: `${selectorBudget}(${count},${sheets})`,
        maxStylesheetSelectors,
        maxStylesheetBytes: 2 * 1024 * 1024,
        maxDomOperations: 1_000_000,
      }),
    });
    if (accepted) {
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: "73px" });
    } else {
      expect(response.status).toBe(422);
      expect(await response.text()).toContain("resource limit: stylesheet selectors");
    }
    const recovered = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "document.styleSheets.length" }),
    });
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: 0 });
  },
);

test.each([0, -1, 1.5, 32769, "8192", true, null, {}])(
  "invalid stylesheet selector budget is rejected before navigation: %s",
  async (maxStylesheetSelectors) => {
    const before = requests.length;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL("geometry-empty", origin.url).href,
        expression: "1",
        maxStylesheetSelectors,
      }),
    });
    expect(response.status).toBe(400);
    expect(requests.length).toBe(before);
  },
);

const importedSelectorBudget = await Bun.file(
  new URL("../crates/engine/tests/fixtures/stylesheet-selector-import.txt", import.meta.url),
).text();

test.each([
  [162, true],
  [161, false],
])(
  "native stylesheet selector budget includes imports: %i",
  async (maxStylesheetSelectors, accepted) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL("geometry-empty", origin.url).href,
        expression: importedSelectorBudget,
        maxStylesheetSelectors,
      }),
    });
    if (accepted) {
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ value: "73px" });
    } else {
      expect(response.status).toBe(422);
      expect(await response.text()).toContain("resource limit: stylesheet selectors");
    }
  },
);

test("stylesheet selector budgets stay request-local in the shared Worker", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const expression = `${selectorBudget}(4097)`;
  const configured = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression, maxStylesheetSelectors: 8192 }),
  });
  expect(configured.status).toBe(200);
  expect(await configured.json()).toMatchObject({ value: "73px" });
  const defaults = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(defaults.status).toBe(422);
  expect(await defaults.text()).toContain("resource limit: stylesheet selectors");
});

const nesting = await Bun.file(
  new URL("../crates/engine/tests/fixtures/nesting.txt", import.meta.url),
).text();

test("native nesting preserves cascade conditions and live changes", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression: nesting }),
  });
  expect(response.status).toBe(200);
  const expected = Object.fromEntries(
    [
      "customBlock",
      "descendant",
      "implicit",
      "child",
      "list",
      "specificity",
      "deep",
      "media",
      "inactive",
      "supports",
      "layer",
      "order",
      "declarationsAfter",
      "customNested",
      "sibling",
      "initial",
      "mutated",
      "detached",
      "reattached",
      "generated",
      "fontIdentity",
    ].map((name) => [name, true]),
  );
  expect(await response.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: expected });
});

const nestingLimits = await Bun.file(
  new URL("../crates/engine/tests/fixtures/nesting-limits.txt", import.meta.url),
).text();

test("nesting output is bounded before cascade and recovers", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression: nestingLimits, maxStylesheetBytes: 1024 }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    url,
    engine: "rust-wasm-quickjs",
    value: { limited: true, recovered: true },
  });
});

const vendorRules = await Bun.file(
  new URL("../crates/engine/tests/fixtures/vendor-rules.txt", import.meta.url),
).text();

test("unrecognized prefixed stylesheet rules preserve local styles", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression: vendorRules }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    url,
    engine: "rust-wasm-quickjs",
    value: { block: true, statement: true, media: true, escaped: true },
  });
});

const computedTraversal = await Bun.file(
  new URL("../crates/engine/tests/fixtures/computed-traversal.txt", import.meta.url),
).text();

test("computed cascade traversal keeps DOM and layout budgets separate", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression: computedTraversal,
      maxLayoutNodes: 16,
      maxDomOperations: 100_000,
    }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    url,
    engine: "rust-wasm-quickjs",
    value: { display: true, layoutLimited: true, recovered: true },
  });
});

const computedInsets = await Bun.file(
  new URL("../crates/engine/tests/fixtures/computed-insets.txt", import.meta.url),
).text();

test("computed insets use native positioning and live containing blocks", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression: computedInsets }),
  });
  expect(response.status).toBe(200);
  const result = Schema.decodeUnknownSync(Success)(await response.json());
  expect(result.url).toBe(url);
  expect(result.engine).toBe("rust-wasm-quickjs");
  const checks = Schema.decodeUnknownSync(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        actual: Schema.Array(Schema.String),
        expected: Schema.Array(Schema.String),
      }),
    ),
  )(result.value);
  expect(Object.keys(checks)).toHaveLength(23);
  for (const check of Object.values(checks)) {
    expect(check.actual).toEqual(check.expected);
  }
});

const inlineBaseline = await Bun.file(
  new URL("../crates/engine/tests/fixtures/inline-baseline.txt", import.meta.url),
).text();

const inlineBaselineBoundary = await Bun.file(
  new URL("../crates/engine/tests/fixtures/inline-baseline-boundary.txt", import.meta.url),
).text();

test("baseline inline wrappers preserve native text shaping", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression: inlineBaseline }),
  });
  expect(response.status).toBe(200);
  const result = Schema.decodeUnknownSync(Success)(await response.json());
  const checks = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Boolean))(
    result.value,
  );
  expect(Object.keys(checks)).toHaveLength(18);
  expect(Object.values(checks).every((check) => check)).toBe(true);
});

test("non-baseline inline alignment remains explicit and recovers on the same page", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression: inlineBaselineBoundary }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    url,
    engine: "rust-wasm-quickjs",
    value: { rejected: true, recovered: true },
  });
});

const inlinePadding = await Bun.file(
  new URL("../crates/engine/tests/fixtures/inline-padding.txt", import.meta.url),
).text();

const inlinePaddingBoundary = await Bun.file(
  new URL("../crates/engine/tests/fixtures/inline-padding-boundary.txt", import.meta.url),
).text();

test("inline padding participates in native text width and line breaks", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression: inlinePadding }),
  });
  expect(response.status).toBe(200);
  const result = Schema.decodeUnknownSync(Success)(await response.json());
  const checks = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Boolean))(
    result.value,
  );
  expect(Object.keys(checks)).toHaveLength(32);
  expect(Object.values(checks).every((check) => check)).toBe(true);
});

test("inline padding keeps resource and fragment boundaries explicit and recovers", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression: inlinePaddingBoundary }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    url,
    engine: "rust-wasm-quickjs",
    value: { vertical: true, transform: true, limited: true, recovered: true },
  });
});

const mixedInlineBlocks = await Bun.file(
  new URL("../crates/engine/tests/fixtures/mixed-inline-blocks.txt", import.meta.url),
).text();
const mixedInlineBoundary = await Bun.file(
  new URL("../crates/engine/tests/fixtures/mixed-inline-boundary.txt", import.meta.url),
).text();

test("mixed inline and block children form anonymous blocks", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression: mixedInlineBlocks }),
  });
  expect(response.status).toBe(200);
  const result = Schema.decodeUnknownSync(Success)(await response.json());
  const checks = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Boolean))(
    result.value,
  );
  expect(Object.keys(checks)).toHaveLength(21);
  expect(Object.values(checks).every((check) => check)).toBe(true);
});

test("anonymous blocks preserve unsupported boundaries and recover", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression: mixedInlineBoundary }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    url,
    engine: "rust-wasm-quickjs",
    value: {
      flow: true,
      nestedBlock: true,
      contents: true,
      fragment: true,
      limit: true,
      recovery: true,
    },
  });
});

const inlineFontMetrics = await Bun.file(
  new URL("../crates/engine/tests/fixtures/inline-font-metrics.txt", import.meta.url),
).text();
const inlineFontMetricsBoundary = await Bun.file(
  new URL("../crates/engine/tests/fixtures/inline-font-metrics-boundary.txt", import.meta.url),
).text();

test("inline text uses span metrics and per-line baselines", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression: inlineFontMetrics }),
  });
  expect(response.status).toBe(200);
  const result = Schema.decodeUnknownSync(Success)(await response.json());
  const checks = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Boolean))(
    result.value,
  );
  expect(Object.keys(checks)).toHaveLength(35);
  expect(Object.values(checks).every((check) => check)).toBe(true);
});

test("inline font metrics enforce flow and resource boundaries and recover", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression: inlineFontMetricsBoundary }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    url,
    engine: "rust-wasm-quickjs",
    value: {
      whitespace: true,
      direction: true,
      transform: true,
      transformedMetrics: true,
      borders: true,
      vertical: true,
      source: true,
      budget: true,
      recovery: true,
      rounding: true,
    },
  });
});

const userSelectGeometry = await Bun.file(
  new URL("../crates/engine/tests/fixtures/user-select-geometry.txt", import.meta.url),
).text();
const userSelectContract = await Bun.file(
  new URL("../crates/engine/tests/fixtures/user-select-contract.txt", import.meta.url),
).text();

test("native user-select aliases preserve block and inline geometry", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression: userSelectGeometry }),
  });
  expect(response.status).toBe(200);
  const result = Schema.decodeUnknownSync(Success)(await response.json());
  const checks = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Boolean))(
    result.value,
  );
  expect(Object.keys(checks)).toHaveLength(44);
  expect(Object.values(checks).every((check) => check)).toBe(true);
});

test("native user-select aliases preserve CSS grammar and unsupported layout boundaries", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression: userSelectContract }),
  });
  expect(response.status).toBe(200);
  const result = Schema.decodeUnknownSync(Success)(await response.json());
  const checks = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Boolean))(
    result.value,
  );
  expect(Object.keys(checks)).toHaveLength(16);
  expect(Object.values(checks).every((check) => check)).toBe(true);
});

const semanticEmphasis = await Bun.file(
  new URL("../crates/engine/tests/fixtures/semantic-emphasis.txt", import.meta.url),
).text();
const semanticEmphasisBoundary = await Bun.file(
  new URL("../crates/engine/tests/fixtures/semantic-emphasis-boundary.txt", import.meta.url),
).text();

test("semantic inline emphasis uses HTML defaults and native computed font traits", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression: semanticEmphasis }),
  });
  expect(response.status).toBe(200);
  const result = Schema.decodeUnknownSync(Success)(await response.json());
  const checks = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Boolean))(
    result.value,
  );
  expect(Object.keys(checks)).toHaveLength(40);
  expect(Object.values(checks).every((check) => check)).toBe(true);
});

test("semantic emphasis validates font grammar and preserves unsupported formatting boundaries", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression: semanticEmphasisBoundary }),
  });
  expect(response.status).toBe(200);
  const result = Schema.decodeUnknownSync(Success)(await response.json());
  const checks = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Boolean))(
    result.value,
  );
  expect(Object.keys(checks)).toHaveLength(15);
  expect(Object.values(checks).every((check) => check)).toBe(true);
});

const buttonFlow = await Bun.file(
  new URL("../crates/engine/tests/fixtures/button-flow.txt", import.meta.url),
).text();

test("native button flow uses fit-content widths and safe content alignment", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression: buttonFlow }),
  });
  expect(response.status).toBe(200);
  const result = Schema.decodeUnknownSync(Success)(await response.json());
  const checks = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Boolean))(
    result.value,
  );
  expect(Object.keys(checks)).toHaveLength(36);
  expect(Object.values(checks).every((check) => check)).toBe(true);
});

const buttonFlowBoundary = await Bun.file(
  new URL("../crates/engine/tests/fixtures/button-flow-boundary.txt", import.meta.url),
).text();

test("native appearance grammar preserves button formatting boundaries and recovery", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression: buttonFlowBoundary }),
  });
  expect(response.status).toBe(200);
  const result = Schema.decodeUnknownSync(Success)(await response.json());
  const checks = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Boolean))(
    result.value,
  );
  expect(Object.keys(checks)).toHaveLength(15);
  expect(Object.values(checks).every((check) => check)).toBe(true);
});

const staticInlineInsets = await Bun.file(
  new URL("../crates/engine/tests/fixtures/static-inline-insets.txt", import.meta.url),
).text();
const staticInlineInsetsBoundary = await Bun.file(
  new URL("../crates/engine/tests/fixtures/static-inline-insets-boundary.txt", import.meta.url),
).text();

test("static inline insets preserve flow and scrollable geometry", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression: staticInlineInsets }),
  });
  expect(response.status).toBe(200);
  const result = Schema.decodeUnknownSync(Success)(await response.json());
  const checks = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Boolean))(
    result.value,
  );
  expect(Object.keys(checks)).toHaveLength(58);
  expect(Object.values(checks).every((check) => check)).toBe(true);
});

test("static inline inset validation preserves positioned boundaries and recovery", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression: staticInlineInsetsBoundary }),
  });
  expect(response.status).toBe(200);
  const result = Schema.decodeUnknownSync(Success)(await response.json());
  const checks = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Boolean))(
    result.value,
  );
  expect(Object.keys(checks)).toHaveLength(6);
  expect(Object.values(checks).every((check) => check)).toBe(true);
});

const atomicMiddle = await Bun.file(
  new URL("../crates/engine/tests/fixtures/atomic-middle.txt", import.meta.url),
).text();

test("atomic middle alignment uses parent font metrics and native baselines", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression: atomicMiddle }),
  });
  expect(response.status).toBe(200);
  const result = Schema.decodeUnknownSync(Success)(await response.json());
  const checks = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Boolean))(
    result.value,
  );
  expect(Object.keys(checks)).toHaveLength(37);
  expect(Object.values(checks).every((check) => check)).toBe(true);
});
