import { expect, test } from "bun:test";
import { origin, requests, worker } from "./browser-live-setup";

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: live class lists and atomic token mutation variant %i",
  async (variant) => {
    const url = new URL(`tokens/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "comparison" }),
    });
    expect(response.status).toBe(200);
    const expected = Object.fromEntries(
      [
        "identity",
        "absent",
        "absentNoop",
        "parsed",
        "indices",
        "contains",
        "noNormalize",
        "add",
        "remove",
        "toggled",
        "replace",
        "external",
        "forwarded",
        "unicode",
        "live",
        "iteration",
        "atomic",
        "guarded",
        "removed",
        "detached",
      ].map((key) => [key, true]),
    );
    expect(await response.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: expected });
    expect(requests).toContain(`GET /tokens/${variant}`);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: document base drives actual classic scripts modules and fetch variant %i",
  async (variant) => {
    const url = new URL(`base-url/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url,
        expression:
          "(async()=>{document.querySelector('base').setAttribute('href','https://external.example.com/'); const denied=await fetch('blocked').then(()=>false,error=>error.message.includes('origin'));return {classic:baseClassic,module:baseModule,fetch:await baseFetch,denied};})()",
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: { classic: variant, module: variant, fetch: `base-${variant}`, denied: true },
    });
    for (const file of ["classic.js", "module.js", "data"])
      expect(requests).toContain(`GET /base-assets/${variant}/${file}`);
  },
);

test("real HTTP → workerd → Wasm: geometry charges the shared DOM operation budget", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const expression =
    "(() => {const root=document.createElement('div');document.body.appendChild(root);for(let i=0;i<30;i++){root.appendChild(document.createElement('div'));}for(let i=0;i<500;i++){root.style.width=(40+i)+'px';root.getBoundingClientRect();}return false;})()";
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(response.status).toBe(422);
  const message: unknown = expect.stringContaining("resource limit: DOM operations");
  expect(await response.json()).toEqual({ error: message });
  const recovered = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression: "document.body.getBoundingClientRect().width > 0" }),
  });
  expect(recovered.status).toBe(200);
  expect(await recovered.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: true });
});

test("real HTTP → workerd → Wasm: intersection callbacks report exceptions and use native geometry", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const expression = `new Promise(resolve=>{
    const el=document.createElement('div');el.style.cssText='width:20px;height:20px';document.body.appendChild(el);
    let errors=0;window.addEventListener('error',event=>{if(event.message.includes('observer failure'))errors++;});
    el.getBoundingClientRect=()=>{throw new Error('page override');};
    const first=new IntersectionObserver(()=>{first.disconnect();throw new Error('observer failure');});first.observe(el);
    const second=new IntersectionObserver(entries=>{second.disconnect();resolve(errors===1 && entries[0].boundingClientRect.width===20);});second.observe(el);
  })`;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: true });
});

test.each([
  ["attribute", "content:attr(data-label);display:block", "generated content"],
  ["image", "content:url(https://example.test/image.png);display:block", "generated content"],
  ["gradient", "content:linear-gradient(red,blue);display:block", "generated content"],
  ["counter", "content:counter(item);display:block", "generated content"],
  ["quotes", "content:open-quote;display:block", "generated content"],
  ["inline", 'content:""', "generated inline formatting"],
  ["inherited content", "content:inherit;display:block", "generated content"],
])("real HTTP → workerd → Wasm: generated content gap %s", async (_name, source, detail) => {
  const url = new URL("geometry-empty", origin.url).href;
  const expression = `(()=>{const owner=document.createElement('div');owner.id='owner';document.body.appendChild(owner);const sheet=document.createElement('style');sheet.textContent='#owner::before{'+${JSON.stringify(source)}+'}';document.head.appendChild(sheet);let failed=false;try{owner.getBoundingClientRect();}catch(error){failed=error.message.endsWith('layout unsupported: '+${JSON.stringify(detail)});}sheet.remove();owner.remove();return failed&&Number.isFinite(document.body.getBoundingClientRect().height);})()`;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: true });
});

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: indexed native cascade variant %i",
  async (variant) => {
    const url = new URL(`cascade-index/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "comparison" }),
    });
    expect(response.status).toBe(200);
    const expected: Record<string, boolean> = {
      large: true,
      largeRecovery: true,
      idBefore: true,
      idAfter: true,
      idRestore: true,
      classAfter: true,
      classRestore: true,
    };
    for (const name of [
      "id",
      "class",
      "tag",
      "htmlTagCase",
      "escapedId",
      "escapedClass",
      "unicodeClass",
      "attribute",
      "universal",
      "child",
      "adjacent",
      "following",
      "is",
      "where",
      "not",
      "has",
      "nthOf",
      "selectorList",
      "duplicateList",
      "sourceOrder",
      "specificity",
      "multipleClasses",
      "hostNegation",
      "root",
    ]) {
      expected[name] = true;
      expected[`${name}Recovery`] = true;
    }
    expect(await response.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: expected });
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native canvas upload variant %i",
  async (variant) => {
    const url = new URL(`canvas/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: `canvasUploadCase(${variant})` }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing pixels");
    expect(Object.keys(value)).toHaveLength(30);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: computed outlines variant %i",
  async (variant) => {
    const url = new URL(`outlines/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: `outlineCase(${variant})` }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing computed outlines");
    expect(Object.keys(value)).toHaveLength(60);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test("real HTTP → workerd → Wasm: background single stop, lazy color and conservative paint support", async () => {
  const url = new URL("background-images/0", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression:
        "(()=>{const e=document.body;e.style.cssText='font-size:18px;background-image:linear-gradient(red)';const s=getComputedStyle(e);const single=s.backgroundImage;e.style.backgroundImage='linear-gradient(color(display-p3 1 0 0),blue)';const font=s.fontSize;e.style.backgroundImage='url(https://example.test/image.png)';return {single,font,urlFont:s.fontSize,paint:CSS.supports('background-image','linear-gradient(red,blue)')}})()",
    }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    value: {
      single: "linear-gradient(rgb(255, 0, 0))",
      font: "18px",
      urlFont: "18px",
      paint: false,
    },
  });
});

test("real HTTP → workerd → Wasm: sizing preserves independent scalar reads and image layer counts", async () => {
  const url = new URL("background-size/0", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression:
        "(()=>{const e=document.body;e.style.cssText='font-size:18px;background-size:2ex';const s=getComputedStyle(e),font=s.fontSize;e.style.cssText='background-image:url(https://example.test/a),url(https://example.test/b);background-size:cover';return {font,size:s.backgroundSize,paint:CSS.supports('background-size','cover')}})()",
    }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    value: { font: "18px", size: "cover, cover", paint: false },
  });
});

test.each(["inline", "table-row", "ruby", "list-item"])(
  "real HTTP → workerd → Wasm: computed %s display retains explicit unsupported formatting",
  async (display) => {
    const url = new URL("display/0", origin.url).href;
    const request = (expression: string) =>
      worker.dispatchFetch("https://nimbo.test/scrape", {
        method: "POST",
        headers: { authorization: "Bearer test-secret" },
        body: JSON.stringify({ url, expression }),
      });
    const setup = `document.body.innerHTML='<div id="target"></div>';const e=document.body.firstElementChild;e.style.display=${JSON.stringify(display)};`;
    const scalar = await request(
      `(()=>{${setup}return {display:getComputedStyle(e).display,support:CSS.supports('display',e.style.display)}})()`,
    );
    expect(scalar.status).toBe(200);
    expect(await scalar.json()).toMatchObject({ value: { display, support: false } });
    const geometry = await request(`(()=>{${setup}return e.getBoundingClientRect().width})()`);
    expect(geometry.status).toBe(422);
    expect(await geometry.text()).toContain("display formatting");
  },
);

test("real HTTP → workerd → Wasm: connected iframe contexts fail explicitly and recover", async () => {
  const url = new URL("namespaced-elements/0", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression:
        "(()=>{const frame=document.createElement('iframe');document.body.append(frame);return frame.contentWindow})()",
    }),
  });
  expect(response.status).toBe(422);
  expect(await response.text()).toContain("Independent frame contexts are not implemented");
  const recovered = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression: "namespacedElementsCase(0)" }),
  });
  expect(recovered.status).toBe(200);
  const result: unknown = await recovered.json();
  if (typeof result !== "object" || result === null) throw new Error("Missing result");
  const checks: unknown = Reflect.get(result, "value");
  if (typeof checks !== "object" || checks === null) throw new Error("Missing checks");
  expect(Object.keys(checks)).toHaveLength(38);
  expect(Object.values(checks).every((value) => value === true)).toBe(true);
});

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: layout snapshot invalidation variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`layout-snapshot/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing result");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing checks");
    expect(Object.keys(value)).toHaveLength(30);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: anonymous text variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`anonymous-text/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      value: Object.fromEntries(
        [
          "pure",
          "height",
          "adjacent",
          "separated",
          "hidden",
          "whitespace",
          "order",
          "mutation",
          "grid",
        ].map((key) => [key, true]),
      ),
    });
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native adjacent element variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`adjacent-element/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(body, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing adjacent checks");
    expect(Object.keys(value)).toHaveLength(26);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);
