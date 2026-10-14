import { expect, test } from "bun:test";
import {
  anchorExpected,
  comparePage,
  comparisonBinary,
  largeDomExpression,
  origin,
  requestTextLayout,
  requests,
  textLayoutBoundaries,
  worker,
} from "./browser-live-setup";

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native custom element upgrades and reactions variant %i",
  async (variant) => {
    const url = new URL(`custom-elements/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "comparisonPromise" }),
    });
    expect(response.status).toBe(200);
    const expected = Object.fromEntries(
      [
        "registered",
        "upgrade",
        "once",
        "attributes",
        "lifecycle",
        "construction",
        "explicit",
        "insertion",
        "fragments",
        "replacement",
        "failure",
        "guards",
        "promise",
        "detachedHTML",
        "constructorValidation",
        "unicode",
        "documentNoop",
        "parsedHTML",
      ].map((key) => [key, true]),
    );
    expect(await response.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: expected });
    expect(requests).toContain(`GET /custom-elements/${variant}`);
    if (comparisonBinary) expect(await comparePage(comparisonBinary, url)).toBeNull();
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native anchor URLs and reflected attributes variant %i",
  async (variant) => {
    const url = new URL(`anchors/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "comparison" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: anchorExpected,
    });
    expect(requests).toContain(`GET /anchors/${variant}`);
    if (comparisonBinary)
      expect(await comparePage(comparisonBinary, url)).toEqual({
        ...Object.fromEntries(Object.keys(anchorExpected).map((key) => [key, false])),
        parsed: true,
        components: true,
        host: true,
        invalidSetters: true,
        emptyParts: true,
        clearing: true,
        text: true,
        rel: true,
        bases: true,
      });
  },
);

test("real HTTP → workerd → Wasm: failed stylesheet parsing preserves inline state and permits page reuse", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const expression = `(() => {
    document.body.style.margin='0';const el=document.createElement('div');el.id='target';el.style.cssText='width:10px;height:5px';document.body.appendChild(el);
    const css=document.createElement('style');css.textContent='#target {width:50px !important;}';document.body.appendChild(css);
    const snapshot=el.getBoundingClientRect();const invalid=document.createElement('style');invalid.textContent='x'.repeat(262145);document.body.appendChild(invalid);
    let failed=false;try{el.getBoundingClientRect();}catch(error){failed=error.message.includes('resource limit: stylesheet bytes');}
    invalid.remove();const recovered=el.getBoundingClientRect().width===50;css.textContent='#target {width:60px !important;}';
    return {failed,recovered,changed:el.getBoundingClientRect().width===60,snapshot:snapshot.width===50,inline:el.style.width==='10px'};
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
    value: { failed: true, recovered: true, changed: true, snapshot: true, inline: true },
  });
});

test.each([
  [
    "statements",
    "'@layer '+Array.from({length:1025},(_,i)=>'a'+i).join(',')+';'",
    "stylesheet layers",
  ],
  ["blocks", "Array.from({length:1025},()=> '@layer{}').join('')", "stylesheet layers"],
  [
    "dotted depth",
    "'@layer '+Array.from({length:33},(_,i)=>'a'+i).join('.')+';'",
    "stylesheet layer depth",
  ],
])("real HTTP → workerd → Wasm: cascade layers bound %s", async (_name, source, detail) => {
  const url = new URL("geometry-empty", origin.url).href;
  const expression = `(()=>{const css=document.createElement('style');css.textContent=${source};document.head.appendChild(css);try{document.body.getBoundingClientRect();return false;}catch(error){return error.message.includes(${JSON.stringify(detail)});}finally{css.remove();}})()`;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: true });
});

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native selector AST variant %i",
  async (variant) => {
    const url = new URL(`selector-ast/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "comparison" }),
    });
    expect(response.status).toBe(200);
    const expected: Record<string, boolean> = {};
    for (const name of [
      "backdrop",
      "backdropList",
      "backdropOrigin",
      "placeholder",
      "selection",
      "marker",
      "fileButton",
      "hasChild",
      "hasAdjacent",
      "hasFollowing",
      "hasMissing",
      "hasNegation",
      "nthOf",
      "nthLastOf",
      "nthAbsent",
      "root",
      "notRoot",
      "isHas",
      "whereHas",
      "absentModal",
      "notModal",
      "absentFocus",
      "notFocus",
      "upperBackdrop",
      "escapedBackdrop",
    ]) {
      expected[name] = true;
      expected[`${name}Recovery`] = true;
    }
    expect(await response.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: expected });
  },
);

test.each([
  {
    name: "font shorthand length",
    expression: "document.fonts.check('12px '+ 'x'.repeat(4097))",
    reason: "font matching input",
  },
  {
    name: "font sample length",
    expression: "document.fonts.check('12px Example', 'A'.repeat(65537))",
    reason: "encoding input limit",
  },
  {
    name: "font matching face count",
    expression:
      "(()=>{for(let i=0;i<1025;i++)document.fonts.add(new FontFace('Example', 'url(/font-assets/font/0)'));return document.fonts.check('12px Example')})()",
    reason: "font matching input",
  },
  {
    name: "font matching payload",
    expression:
      "(()=>{for(let i=0;i<300;i++)document.fonts.add(new FontFace('x'.repeat(4096)+i, 'url(/font-assets/font/0)'));return document.fonts.check('12px Example')})()",
    reason: "font matching payload limit",
  },
])("real HTTP → workerd → Wasm: $name boundary and recovery", async ({ expression, reason }) => {
  const url = new URL("font-matching/129", origin.url).href;
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
    body: JSON.stringify({ url, expression: "document.fonts.check('12px Example')" }),
  });
  expect(healthy.status).toBe(200);
  expect(await healthy.json()).toMatchObject({ value: true });
});

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native computed tabs variant %i",
  async (variant) => {
    const url = new URL(`tabs/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: `tabsCase(${variant})` }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing computed tabs");
    expect(Object.keys(value)).toHaveLength(46);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native background repeat variant %i",
  async (variant) => {
    const url = new URL(`background-repeat/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: `backgroundRepeatCase(${variant})` }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null)
      throw new Error("Missing background repeat values");
    expect(Object.keys(value)).toHaveLength(66);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test("real HTTP → workerd → Wasm: font family scalar and default native text geometry", async () => {
  const url = new URL("font-family/0", origin.url).href;
  const request = (expression: string) =>
    worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression }),
    });
  const scalar = await request(
    "(()=>{document.body.innerHTML='<div style=\"font-family:serif\">Actual text</div>';const e=document.body.firstElementChild;return {family:getComputedStyle(e).fontFamily,support:CSS.supports('font-family','serif')}})()",
  );
  expect(scalar.status).toBe(200);
  expect(await scalar.json()).toMatchObject({ value: { family: "serif", support: false } });
  const geometry = await request(
    "(()=>{document.body.innerHTML='<div style=\"font-family:serif\">Actual text</div>';return document.body.firstElementChild.getBoundingClientRect().height})()",
  );
  expect(geometry.status).toBe(200);
  expect(await geometry.json()).toMatchObject({ value: 18 });
});

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: 5000-row DOM and JavaScript variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`large-dom/${variant}`, origin.url).href,
        expression: largeDomExpression(variant),
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      value: {
        value: "row",
        changed: `updated-${variant}`,
        count: 5000,
        keys: 5000,
        retained: true,
        remaining: 4999,
        last: "row",
      },
    });
  },
);

test.each([
  ...Array.from({ length: 64 }, (_, variant) => ({ route: "logical-spacing", count: 45, variant })),
  ...Array.from({ length: 64 }, (_, variant) => ({
    route: "logical-spacing-transitions",
    count: 11,
    variant,
  })),
])("real HTTP → workerd → Wasm: logical spacing contract %j", async ({ route, count, variant }) => {
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url: new URL(`${route}/${variant}`, origin.url).href,
      expression: "globalThis.comparison",
    }),
  });
  expect(response.status).toBe(200);
  const result: unknown = await response.json();
  if (typeof result !== "object" || result === null) throw new Error("Missing result");
  const value: unknown = Reflect.get(result, "value");
  if (typeof value !== "object" || value === null) throw new Error("Missing checks");
  expect(Object.keys(value)).toHaveLength(count);
  expect(Object.values(value).every((check) => check === true)).toBe(true);
});

test.each(textLayoutBoundaries)(
  "native text layout rejects unsupported %s and recovers on a fresh page",
  async (_name, mutation, message) => {
    const rejected = await requestTextLayout(
      `(async()=>{await globalThis.comparison;try{${mutation};document.querySelector('div').getBoundingClientRect();return 'unexpected success';}catch(error){return String(error);}})()`,
    );
    expect(rejected.status).toBe(200);
    const result: unknown = await rejected.json();
    expect(
      typeof result === "object" && result !== null ? Reflect.get(result, "value") : undefined,
    ).toContain(message);
    const recovered = await requestTextLayout("globalThis.comparison");
    expect(recovered.status).toBe(200);
    const body: unknown = await recovered.json();
    expect(body).toMatchObject({
      value: { wide: true, ligature: true, wrap: true, canonical: true },
    });
  },
);

test.each(["circle(25%)", 'url("#shape")', "inset(10%) content-box", "inset(10% round 4px)"])(
  "real HTTP → workerd → Wasm: unsupported clip shape %s and recovery",
  async (css) => {
    const url = new URL("clip-geometry/0", origin.url).href;
    const request = (expression: string) =>
      worker.dispatchFetch("https://nimbo.test/scrape", {
        method: "POST",
        headers: { authorization: "Bearer test-secret" },
        body: JSON.stringify({ url, expression }),
      });
    const failed = await request(
      `(()=>{const e=document.createElement('div');e.style.clipPath=${JSON.stringify(css)};document.body.append(e);return e.getBoundingClientRect();})()`,
    );
    expect(failed.status).toBe(422);
    expect(await failed.text()).toContain("clip-path");
    const healthy = await request("globalThis.comparison");
    expect(healthy.status).toBe(200);
    expect(await healthy.json()).toMatchObject({
      value: { inset: true, polygon: true, calc: true },
    });
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: explicit grid geometry variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`explicit-grid/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(body, "value");
    if (typeof value !== "object" || value === null)
      throw new Error("Missing explicit grid checks");
    expect(Object.keys(value)).toHaveLength(23);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);
