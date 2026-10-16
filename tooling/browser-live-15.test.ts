import { expect, test } from "bun:test";
import {
  comparePage,
  comparisonBinary,
  linkParts,
  origin,
  requests,
  worker,
} from "./browser-live-setup";

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native HTML identity and attribute reflection variant %i",
  async (variant) => {
    const url = new URL(`html-elements/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "comparison" }),
    });
    expect(response.status).toBe(200);
    const expected = Object.fromEntries(
      [
        "identity",
        "namespaces",
        "defaults",
        "strings",
        "live",
        "coercion",
        "direction",
        "inert",
        "hidden",
        "guarded",
        "detached",
        "customName",
      ].map((key) => [key, true]),
    );
    expect(await response.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: expected });
    expect(requests).toContain(`GET /html-elements/${variant}`);
    if (comparisonBinary) {
      expect(await comparePage(comparisonBinary, url)).toEqual({
        ...expected,
        identity: false,
        namespaces: false,
        inert: false,
        hidden: false,
        guarded: false,
      });
    }
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: independent WHATWG URL component vectors variant %i",
  async (variant) => {
    const inputs = [
      `http://EXAMPLE.com:80/a/../b-${variant}?x=1#old`,
      `https://[2001:db8::1]:443/a-${variant}`,
      `file:///fixture/path-${variant}`,
      `mailto:unit-${variant}@example.com`,
      `data:text/plain,fixture-${variant}`,
      `custom://EXAMPLE.com/a-${variant}`,
      `custom:opaque-${variant}`,
      `https://bücher.example.com/é-${variant}`,
      `blob:https://example.com/opaque-${variant}`,
    ];
    const mutations: [string, string][] = [
      ["username", "fixture user"],
      ["password", "fixture value"],
      ["host", "other.example.com:81"],
      ["hostname", "[2001:db8::2]"],
      ["port", "80junk"],
      ["protocol", "https::::"],
      ["pathname", `new path/${variant}`],
      ["search", "?q='é"],
      ["hash", "#é"],
    ];
    const expected = inputs.map((input) => {
      const target = new URL(input);
      const states = [linkParts.map((key) => target[key])];
      for (const [key, value] of mutations) {
        Reflect.set(target, key, value);
        states.push(linkParts.map((part) => target[part]));
      }
      return states;
    });
    const expression = `(() => {
      const inputs=${JSON.stringify(inputs)}; const mutations=${JSON.stringify(mutations)}; const parts=${JSON.stringify(linkParts)};
      return inputs.map(input => {
        const target=document.createElement('a'); target.href=input;
        const states=[parts.map(key=>target[key])];
        for(const [key,value] of mutations){target[key]=value;states.push(parts.map(part=>target[part]));}
        return states;
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
  "real HTTP → workerd → Wasm: nested stylesheet failure causes variant %i",
  async (variant) => {
    const url = new URL(`group-errors/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "comparison" }),
    });
    expect(response.status).toBe(200);
    const expected: Record<string, boolean> = { inactive: true };
    for (const name of ["atRule", "nesting", "forgiving", "selectors", "rules", "declarations"]) {
      for (const depth of [1, 2, 3]) {
        expected[`${name}${depth}`] = true;
        expected[`${name}Recovery${depth}`] = true;
      }
    }
    expect(await response.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: expected });
  },
);

test("real HTTP → workerd → Wasm: native dataset charges the DOM write budget", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression: "document.body.dataset.large='x'.repeat(4194305)" }),
  });
  expect(response.status).toBe(422);
  const message: unknown = expect.stringContaining("DOM write bytes");
  expect(await response.json()).toEqual({ error: message });
  const recovered = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression: "(document.body.dataset.state='ready',document.body.getAttribute('data-state'))",
    }),
  });
  expect(recovered.status).toBe(200);
  expect(await recovered.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: "ready" });
});

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: registered custom properties variant %i",
  async (variant) => {
    const url = new URL(`registrations/${variant}`, origin.url).href;
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
    expect(Object.keys(value)).toHaveLength(77);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each([
  [
    "new FontFace('Example',Array(33).fill('url(/font-assets/font/0)').join(','))",
    "font source limit",
  ],
  ["new FontFace('Example','url(\"'+ 'a'.repeat(4097) +'\")')", "font metadata limit"],
  [
    "new FontFace('Example', 'url(/font-assets/font/0) tech(color-COLRv1)').load()",
    "font source technology",
  ],
  [
    `(()=>{const style=document.createElement('style');style.textContent='@font-face{font-family:Example;src:url(/font-assets/font/0);font-feature-settings:"liga" 0}';document.head.append(style);return document.fonts.size;})()`,
    "font descriptor featureSettings",
  ],
  [
    "(()=>{const style=document.createElement('style');style.textContent='@font-face{font-family:Example;src:url(/font-assets/font/0)}'.repeat(1025);document.head.append(style);return document.fonts.size;})()",
    "font-face definitions",
  ],
] as const)("real HTTP → workerd → Wasm: CSS font boundary %s", async (expression, reason) => {
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
        "new FontFace('Example','url(/font-assets/font/0)').load().then(face=>face.status)",
    }),
  });
  expect(healthy.status).toBe(200);
  expect(await healthy.json()).toMatchObject({ value: "loaded" });
});

test("real HTTP → workerd → Wasm: computed style scope and lazy color serialization", async () => {
  const url = new URL("outlines/0", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression:
        "(()=>{document.body.style.cssText='font-size:18px;color:color(display-p3 1 0 0)';const s=getComputedStyle(document.body);return {font:s.fontSize,count:s.length,names:Array.from({length:s.length},(_,i)=>s.item(i))}})()",
    }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    value: {
      font: "18px",
      count: 58,
      names: [
        "background-attachment",
        "background-clip",
        "background-color",
        "background-image",
        "background-origin",
        "background-position",
        "background-repeat",
        "background-size",
        "block-size",
        "bottom",
        "color",
        "direction",
        "display",
        "font-family",
        "font-size",
        "font-style",
        "font-weight",
        "height",
        "inline-size",
        "inset-block-end",
        "inset-block-start",
        "inset-inline-end",
        "inset-inline-start",
        "left",
        "line-height",
        "margin-block-end",
        "margin-block-start",
        "margin-bottom",
        "margin-inline-end",
        "margin-inline-start",
        "margin-left",
        "margin-right",
        "margin-top",
        "order",
        "outline-color",
        "outline-offset",
        "outline-style",
        "outline-width",
        "padding-block-end",
        "padding-block-start",
        "padding-bottom",
        "padding-inline-end",
        "padding-inline-start",
        "padding-left",
        "padding-right",
        "padding-top",
        "position",
        "right",
        "tab-size",
        "text-size-adjust",
        "text-transform",
        "top",
        "transition-delay",
        "transition-duration",
        "transition-property",
        "transition-timing-function",
        "width",
        "z-index",
      ],
    },
  });
});

test.each([
  { css: "position:absolute;top:0;width:10px;height:5px", supported: true },
  { css: "position:fixed;left:0;width:10px;height:5px", supported: false },
])(
  "real HTTP → workerd → Wasm: positioned static boxes $css and recovery",
  async ({ css, supported }) => {
    const url = new URL("positioned-boxes/0", origin.url).href;
    const expression = `(()=>{document.body.innerHTML='';const e=document.createElement('div');e.style.cssText=${JSON.stringify(css)};document.body.append(e);return e.getBoundingClientRect().width})()`;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression }),
    });
    if (supported) {
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ value: 10 });
    } else {
      expect(response.status).toBe(422);
      expect(await response.text()).toContain("fixed static position across containing blocks");
    }
    const recovered = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "positionedBoxesCase(0)" }),
    });
    expect(recovered.status).toBe(200);
    const result: unknown = await recovered.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing result");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing checks");
    expect(Object.keys(value)).toHaveLength(25);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: Namespaced attributes variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`attribute-namespaces/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing result");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing checks");
    expect(Object.keys(value)).toHaveLength(101);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: atomic inline variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`atomic-inline/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      value: Object.fromEntries(
        [
          "text",
          "box",
          "intrinsic",
          "overflow",
          "contents",
          "margin",
          "ignored",
          "mutation",
          "button",
          "shrink",
        ].map((key) => [key, true]),
      ),
    });
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: canvas box geometry variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`canvas-box/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(body, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing canvas box checks");
    expect(Object.keys(value)).toHaveLength(15);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test("blocked stylesheets emit recoverable errors without leaving the authorized origin", async () => {
  const expression = await Bun.file(
    new URL("../crates/engine/tests/fixtures/stylesheet-origin-policy.txt", import.meta.url),
  ).text();
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url: new URL("geometry-empty", origin.url).href, expression }),
  });
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  expect(body).toMatchObject({
    value: {
      denied: true,
      failedSheet: true,
      recovered: true,
      deniedAgain: true,
      events: true,
      lifecycle: true,
    },
  });
  const recovered = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url: new URL("geometry-empty", origin.url).href,
      expression: "document.readyState",
    }),
  });
  expect(recovered.status).toBe(200);
  expect(await recovered.json()).toMatchObject({ value: "complete" });
});
