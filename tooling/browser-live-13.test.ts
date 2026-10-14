import { expect, test } from "bun:test";
import {
  codecResults,
  externalStyleExpected,
  join,
  origin,
  requests,
  worker,
} from "./browser-live-setup";

test("real HTTP → workerd → Wasm: media parser budgets and isolate recovery", async () => {
  const url = new URL("media/budget", origin.url).href;
  // One active page is permitted; each failed request must finish before the next.
  for (const expression of [
    "matchMedia('x'.repeat(65537))",
    "matchMedia('('.repeat(40) + 'width' + ')'.repeat(40))",
  ]) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, scripts: "skip", expression }),
    });
    expect(response.status).toBe(422);
    // oxlint-disable-next-line eslint/no-await-in-loop
    const result: unknown = await response.json();
    const error: unknown =
      typeof result === "object" && result !== null ? Reflect.get(result, "error") : undefined;
    expect(error).toMatch(/media query (bytes|nesting)/);
  }
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      scripts: "skip",
      expression:
        "[innerWidth, innerHeight, typeof nimboMedia, typeof nimboMediaEnvironment, matchMedia('(width:1024px)').matches]",
    }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    url,
    engine: "rust-wasm-quickjs",
    value: [1024, 768, "undefined", "undefined", true],
  });
});

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: independent incremental codec vectors variant %i",
  async (variant) => {
    const labels = [
      "utf-8",
      "utf-16le",
      "utf-16be",
      "shift_jis",
      "iso-2022-jp",
      "gb18030",
      "big5",
      "euc-kr",
      "windows-1252",
    ] as const;
    const chunks = Array.from({ length: 8 }, (_, chunk) =>
      Array.from(
        { length: 1 + ((variant + chunk) % 7) },
        (_unusedByte, byte) => (variant * 73 + chunk * 41 + byte * 97) % 256,
      ),
    );
    const cases = labels.flatMap((label) =>
      [false, true].map((fatal) => ({ label, fatal, chunks })),
    );
    const expected = cases.map(({ label, fatal, chunks: inputs }) =>
      codecResults(label, fatal, inputs),
    );
    const expression = `(() => {
      const cases = ${JSON.stringify(cases)};
      return cases.map(({label,fatal,chunks}) => {
        const decoder = new TextDecoder(label,{fatal});
        const results = [];
        for (const [index,chunk] of [...chunks,[]].entries()) {
          try {results.push(decoder.decode(new Uint8Array(chunk),{stream:index < chunks.length}));}
          catch(error) {results.push('error:' + error.name);break;}
        }
        return results;
      });
    })()`;
    const url = new URL("custom-elements-empty", origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: expected });
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: real external stylesheets variant %i",
  async (variant) => {
    const url = new URL(`external-styles/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "comparison" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: externalStyleExpected,
    });
    expect(requests).toContain(`GET /sheets-css/main`);
  },
);

test.each([
  ["query bytes", "CSS.supports('x'.repeat(65537))", "supports bytes"],
  ["value bytes", "CSS.supports('width','x'.repeat(65537))", "supports bytes"],
  ["query depth", "CSS.supports('('.repeat(34)+'width:1px'+')'.repeat(34))", "supports nesting"],
  [
    "value depth",
    "CSS.supports('width','calc('.repeat(34)+'1px'+')'.repeat(34))",
    "supports nesting",
  ],
])("real HTTP → workerd → Wasm: native feature support bounds %s", async (_name, query, detail) => {
  const url = new URL("geometry-empty", origin.url).href;
  const expression = `(()=>{let failed=false;try{${query};}catch(error){failed=error.message.includes(${JSON.stringify(detail)});}return failed&&CSS.supports('width','1px');})()`;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: true });
});

test("real HTTP → workerd → Wasm: container layout work is bounded and fresh pages recover", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const expression = await Bun.file(
    join(import.meta.dir, "../crates/engine/tests/fixtures/container-budget.txt"),
  ).text();
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(response.status).toBe(200);
  const failure: unknown = expect.stringContaining("DOM operations");
  expect(await response.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: failure });
  const healthy = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression:
        "(()=>{const node=document.createElement('div');node.style.width='11px';document.body.appendChild(node);return node.getBoundingClientRect().width;})()",
    }),
  });
  expect(healthy.status).toBe(200);
  expect(await healthy.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: 11 });
});

test.each([
  ["document.fonts.ready", "font layout readiness"],
  [
    "new FontFace('Example', new Uint8Array(), {featureSettings:'\"liga\" 0'})",
    "font descriptor featureSettings",
  ],
  [
    "new FontFace('Example', new Uint8Array([119,79,70,50]))",
    "compressed, CFF or collection fonts",
  ],
  ["new FontFace('Example', new Uint8Array(1048577))", "font data limit"],
  ["(()=>{for(let i=0;i<129;i++)new FontFace('Example',new Uint8Array());})()", "font data limit"],
  [
    "(()=>{const bytes=new Uint8Array(1048576);for(let i=0;i<5;i++)new FontFace('Example',bytes);})()",
    "font data limit",
  ],
] as const)(
  "real HTTP → workerd → Wasm: explicit font diagnostic %s",
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
          "fetch('/binary/font.ttf').then(r=>r.arrayBuffer()).then(b=>new FontFace('Example',b).status)",
      }),
    });
    expect(healthy.status).toBe(200);
    expect(await healthy.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: "loaded" });
  },
);

test.each([
  ["getComputedStyle(document.body).left", "computed style left"],
  ["getComputedStyle(document.body).getPropertyValue('--custom')", "computed style --custom"],
  [
    "(()=>{document.body.style.color='color(display-p3 1 0 0)';return getComputedStyle(document.body).color})()",
    "computed color space",
  ],
  [
    "(()=>{const sheet=document.createElement('style');sheet.textContent='@container (width > 1px){body{outline-width:2px}}';document.head.append(sheet);return getComputedStyle(document.body).outlineWidth})()",
    "computed style container queries",
  ],
])(
  "real HTTP → workerd → Wasm: unsupported computed values %s fail explicitly",
  async (expression, reason) => {
    const url = new URL("outlines/0", origin.url).href;
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
      body: JSON.stringify({ url, expression: "outlineCase(0)" }),
    });
    expect(healthy.status).toBe(200);
  },
);

test.each([
  [12000, "space round", "CSS input limit"],
  [10001, "round", "DOM operations"],
] as const)(
  "real HTTP → workerd → Wasm: repeat layer budget %i / %s and fresh recovery",
  async (count, repeat, detail) => {
    const url = new URL("background-repeat/0", origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url,
        expression: `(()=>{document.body.style.backgroundRepeat=Array(${count}).fill(${JSON.stringify(repeat)}).join(',');return getComputedStyle(document.body).backgroundRepeat})()`,
      }),
    });
    expect(response.status).toBe(422);
    expect(await response.text()).toContain(detail);
    const healthy = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "backgroundRepeatCase(0)" }),
    });
    expect(healthy.status).toBe(200);
  },
);

test.each([
  [
    "SVG graphics",
    "document.createElementNS('http://www.w3.org/2000/svg','rect')",
    "element formatting: SVG",
  ],
  [
    "SVG viewport transform",
    "(()=>{const e=document.createElementNS('http://www.w3.org/2000/svg','svg');e.setAttribute('transform','translate(5)');return e})()",
    "SVG viewport transform",
  ],
  [
    "replaced element or native control",
    "document.createElement('button')",
    "element formatting: replaced element or native control",
  ],
  [
    "unsupported HTML tag",
    "document.createElement('table')",
    "element formatting: unsupported HTML tag",
  ],
])(
  "real HTTP → workerd → Wasm: unsupported box geometry rejects %s",
  async (_category, creation, diagnostic) => {
    const url = new URL("geometry-empty", origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url,
        expression: `(()=>{const e=${creation};e.setAttribute('style','display:block');document.body.appendChild(e);return e.getBoundingClientRect().width})()`,
      }),
    });
    expect(response.status).toBe(422);
    expect(await response.text()).toContain(diagnostic);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: contextual box lengths variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`contextual-box-lengths/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing result");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing checks");
    expect(Object.keys(value)).toHaveLength(50);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native text layout variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`text-layout/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      value: Object.fromEntries(
        [
          "wide",
          "ligature",
          "kerning",
          "wrap",
          "resize",
          "collapse",
          "canonical",
          "mutation",
          "lineHeight",
          "fontSize",
          "adjacent",
          "empty",
        ].map((key) => [key, true]),
      ),
    });
  },
);

test.each([
  [
    "fixed",
    'content:"";display:block;position:fixed;left:0;top:0;width:9px;height:7px',
    "fixed generated boxes",
  ],
  [
    "sticky",
    'content:"";display:block;position:sticky;left:0;top:0;width:9px;height:7px',
    "sticky generated boxes",
  ],
  ["text", 'content:"sample";display:block;position:absolute;width:9px;height:7px', "text shaping"],
])(
  "real HTTP → workerd → Wasm: unsupported generated %s and recovery",
  async (_name, css, reason) => {
    const url = new URL("positioned-generated/0", origin.url).href;
    const request = (expression: string) =>
      worker.dispatchFetch("https://nimbo.test/scrape", {
        method: "POST",
        headers: { authorization: "Bearer test-secret" },
        body: JSON.stringify({ url, expression }),
      });
    const failed = await request(
      `(()=>{const sheet=document.createElement('style');sheet.textContent=${JSON.stringify("#unsupported::after{" + css + "}")};document.head.append(sheet);const owner=document.createElement('div');owner.id='unsupported';document.body.append(owner);return owner.scrollWidth;})()`,
    );
    expect(failed.status).toBe(422);
    expect(await failed.text()).toContain(reason);
    const healthy = await request("globalThis.comparison");
    expect(healthy.status).toBe(200);
    expect(await healthy.json()).toMatchObject({
      value: { own: true, ancestor: true, mutation: true },
    });
  },
);
