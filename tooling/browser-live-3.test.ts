import { expect, test } from "bun:test";
import {
  comparePage,
  comparisonBinary,
  geometryExpected,
  intersectionExpected,
  linkGuardExpression,
  origin,
  requests,
  worker,
} from "./browser-live-setup";

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: live and static DOM collections variant %i",
  async (variant) => {
    const url = new URL(`collections/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "globalThis.comparison" }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    const expected = {
      kinds: true,
      identity: true,
      index: true,
      names: true,
      reflection: true,
      readonly: true,
      iteration: true,
      callback: true,
      live: true,
      removed: true,
      renamed: true,
      reparent: true,
      cleared: true,
      fragmentLive: true,
      transferred: true,
      guarded: true,
    };
    expect(result).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: expected,
    });
    if (comparisonBinary) expect(await comparePage(url)).toEqual({ ...expected, readonly: false });
    expect(requests).toContain(`GET /collections/${variant}`);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native block and flex geometry variant %i",
  async (variant) => {
    const url = new URL(`geometry/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "comparison" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: geometryExpected,
    });
    expect(requests).toContain(`GET /geometry/${variant}`);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native intersection observation variant %i",
  async (variant) => {
    const url = new URL(`intersections/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "comparison" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: intersectionExpected,
    });
    expect(requests).toContain(`GET /intersections/${variant}`);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: document stylesheet host predicates variant %i",
  async (variant) => {
    const url = new URL(`document-host/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "comparison" }),
    });
    expect(response.status).toBe(200);
    const expected = Object.fromEntries(
      [
        "bare",
        "functional",
        "escaped",
        "upper",
        "list",
        "reverseList",
        "functionalList",
        "negation",
        "functionalNegation",
        "doubleNegation",
        "is",
        "isOnly",
        "where",
        "whereImportant",
        "isNegation",
        "notList",
        "notMatchingList",
        "descendant",
        "child",
        "sibling",
        "following",
        "has",
        "hasNegation",
        "specificity",
        "whereSpecificity",
        "media",
        "supports",
        "layer",
        "rootList",
        "attributeLiteral",
        "attributeFalse",
        "escapedClass",
        "recovery",
      ].map((key) => [key, true]),
    );
    expect(await response.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: expected });
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: binary font parsing variant %i",
  async (variant) => {
    const url = new URL(`font-cases/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "comparison" }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing comparison");
    expect(Object.keys(value)).toHaveLength(22);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: physical border geometry variant %i",
  async (variant) => {
    const url = new URL(`borders/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: `borderCase(${variant})` }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing checks");
    expect(Object.keys(value)).toHaveLength(54);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: configured layout node budget variant %i",
  async (variant) => {
    const url = new URL(`layout-budget/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url,
        maxLayoutNodes: 2048,
        expression: `layoutBudgetCase(${variant})`,
      }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing geometry");
    expect(Object.keys(value)).toHaveLength(8);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native resolved line height variant %i",
  async (variant) => {
    const url = new URL(`line-height/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: `lineHeightCase(${variant})` }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing line height values");
    expect(Object.keys(value)).toHaveLength(51);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native background sizing variant %i",
  async (variant) => {
    const url = new URL(`background-size/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: `backgroundSizeCase(${variant})` }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null)
      throw new Error("Missing background size values");
    expect(Object.keys(value)).toHaveLength(71);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test("real HTTP → workerd → Wasm: font family list operation budget and recovery", async () => {
  const url = new URL("font-family/0", origin.url).href;
  const request = (expression: string) =>
    worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression }),
    });
  const overflow = await request(
    "(()=>{document.body.style.fontFamily=Array(10001).fill('Arial').join(',');return getComputedStyle(document.body).fontFamily})()",
  );
  expect(overflow.status).toBe(422);
  expect(await overflow.text()).toContain("DOM operations");
  const recovered = await request("fontFamilyCase(0)");
  expect(recovered.status).toBe(200);
});

test.each(["create", "innerHTML"] as const)(
  "real HTTP → workerd → Wasm: link-free stylesheet guard observes %s",
  async (kind) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`link-guard/${kind}`, origin.url).href,
        expression: linkGuardExpression(kind),
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ value: "rgb(7, 8, 9)" });
  },
);

test.each([
  ["cookiesExpirationCase", { before: true, after: true, httpExpired: true }],
  ["cookiesCountCase", { limited: true, count: true, atomic: true, recovered: true }],
  ["cookiesBytesCase", { limited: true, bytes: true, atomic: true, recovered: true }],
] as const)(
  "real HTTP → workerd → Wasm: cookie expiry and budgets %s",
  async (functionName, expected) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL("cookies/0", origin.url).href,
        expression: `${functionName}()`,
      }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing result");
    expect(Reflect.get(result, "value")).toEqual(expected);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: background colors variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`background-color/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing result");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing checks");
    expect(Object.keys(value)).toHaveLength(24);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: authored button variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`authored-button/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      value: Object.fromEntries(
        ["base", "natural", "children", "edges", "inherit", "fontSize", "grid", "disabled"].map(
          (key) => [key, true],
        ),
      ),
    });
  },
);

test("real HTTP → workerd → Wasm: generated static position contributes scroll geometry", async () => {
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url: new URL("geometry-empty", origin.url).href,
      expression: `(()=>{const sheet=document.createElement('style');sheet.textContent='#staticGenerated::after{content:"";display:block;position:absolute;width:9px;height:7px}';document.head.append(sheet);const owner=document.createElement('div');owner.id='staticGenerated';owner.style.cssText='position:relative;width:5px;height:4px';document.body.append(owner);return {width:owner.scrollWidth,height:owner.scrollHeight}})()`,
    }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ value: { width: 9, height: 7 } });
});

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: paragraph wrap geometry variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`paragraph-wrap/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(body, "value");
    if (typeof value !== "object" || value === null)
      throw new Error("Missing paragraph wrap checks");
    expect(Object.keys(value)).toHaveLength(14);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);
