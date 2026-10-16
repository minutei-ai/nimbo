import { expect, test } from "bun:test";
import {
  origin,
  requestAuthoredButton,
  requestTextLayout,
  requests,
  sheetPromise,
  worker,
} from "./browser-live-setup";

test("real HTTP → workerd → Wasm: atomic storage quota, reuse and recovery", async () => {
  const url = new URL("storage/0", origin.url).href;
  const expression = `(() => {
    localStorage.clear(); sessionStorage.clear();
    const full = 'x'.repeat(32767); localStorage.setItem('q', full);
    const errors = [];
    for (const action of [() => localStorage.setItem('q', full + 'x'), () => localStorage.setItem('new', 'v')]) {
      try {action(); errors.push(false);} catch(error) {errors.push(error instanceof DOMException && error.name === 'QuotaExceededError');}
    }
    const atomic = localStorage.q === full && localStorage.length === 1 && localStorage.new === undefined;
    sessionStorage.setItem('q', full); localStorage.removeItem('q'); localStorage.setItem('q', full);
    localStorage.clear(); localStorage.setItem('after', 'works');
    return {errors,atomic,independent:sessionStorage.q === full,reuse:localStorage.after === 'works'};
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
    value: { errors: [true, true], atomic: true, independent: true, reuse: true },
  });
  const failure = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression:
        "(() => {localStorage.clear(); localStorage.setItem('q', 'x'.repeat(32767)); localStorage.setItem('new', 'v');})()",
    }),
  });
  expect(failure.status).toBe(422);
  const result: unknown = await failure.json();
  const error: unknown =
    typeof result === "object" && result !== null ? Reflect.get(result, "error") : undefined;
  expect(error).toMatch(/QuotaExceededError/);
  const recovered = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      scripts: "skip",
      expression: "[localStorage.length,sessionStorage.length,typeof nimboStorage]",
    }),
  });
  expect(recovered.status).toBe(200);
  expect(await recovered.json()).toEqual({
    url,
    engine: "rust-wasm-quickjs",
    value: [0, 0, "undefined"],
  });
});

test("real HTTP → workerd → Wasm: native CSS state quota is atomic and reusable", async () => {
  const url = new URL("styles/0", origin.url).href;
  const expression = `(() => {
    const owners=[];const value='x'.repeat(65000);let failure='';let failed=null;
    for(let i=0;i<70;i++) {
      const el=document.createElement('div');
      try {el.style.setProperty('--blob',value);owners.push(el);}
      catch(error){failure=error.message;failed=el;break;}
    }
    const atomic=failed!==null && failed.getAttribute('style')===null && failed.style.length===0;
    owners[0].removeAttribute('style');failed.style.width='8px';
    return {limited:failure==='resource limit: CSS state',atomic,reused:failed.style.width==='8px',count:owners.length>0 && owners.length<70};
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
    value: { limited: true, atomic: true, reused: true, count: true },
  });
  const recovered = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression: "document.createElement('div').style.length" }),
  });
  expect(recovered.status).toBe(200);
  expect(await recovered.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: 0 });
});

test("real HTTP → workerd → Wasm: a 128 KiB external stylesheet computes real geometry", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const expression = `(()=>{const target=document.createElement('div');target.setAttribute('id','target');document.body.appendChild(target);return ${sheetPromise("/sheets-css/large")}.then(()=>target.getBoundingClientRect().width===65);})()`;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: true });
});

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native generated before and after boxes variant %i",
  async (variant) => {
    const url = new URL(`generated-boxes/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "comparison" }),
    });
    expect(response.status).toBe(200);
    const expected: Record<string, boolean> = {};
    for (const name of [
      "before",
      "after",
      "both",
      "legacy",
      "escaped",
      "upper",
      "none",
      "normal",
      "initial",
      "unset",
      "missing",
      "hidden",
      "strings",
      "specificity",
      "important",
      "order",
      "mixed",
      "variables",
      "localVariables",
      "variableContent",
      "invalidVariable",
      "layer",
      "media",
      "supports",
      "host",
      "flex",
      "flexInline",
      "flexInlineBlock",
      "padding",
      "relative",
      "descendant",
      "childSelector",
      "grid",
      "alternative",
      "invalidContent",
    ]) {
      expected[name] = true;
      expected[`${name}Dom`] = true;
      expected[`${name}Recovery`] = true;
    }
    expect(await response.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: expected });
  },
);

test("real HTTP → workerd → Wasm: unused CSS fonts make no font requests", async () => {
  const url = new URL("font-loading/128", origin.url).href;
  const start = requests.length;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression:
        "({size:document.fonts.size,statuses:[...document.fonts].map(face=>face.status),width:document.getElementById('geometry').getBoundingClientRect().width})",
    }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    value: { size: 2, statuses: ["unloaded", "unloaded"], width: 158 },
  });
  const actual = requests.slice(start);
  expect(actual).toContain("GET /font-assets/redirect/128");
  expect(actual).toContain("GET /font-assets/styles/entry-128.css");
  expect(actual.some((path) => path.startsWith("GET /font-assets/font/"))).toBe(false);
});

test("real HTTP → workerd → Wasm: rejected detached upload preserves the existing bitmap", async () => {
  const url = new URL("canvas/132", origin.url).href;
  const expression =
    "(()=>{const x=new OffscreenCanvas(1,1).getContext('2d');x.fillStyle='blue';x.fillRect(0,0,1,1);const d=new ImageData(1,1);d.data.buffer.transfer();let invalid=false;try{x.putImageData(d,0,0)}catch(e){invalid=e.name==='InvalidStateError'}const a=x.getImageData(0,0,1,1).data;return invalid&&a[0]===0&&a[2]===255&&a[3]===255&&x.fillStyle==='#0000ff'})()";
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ value: true });
});

test.each([
  ["writing-mode:vertical-rl;inline-size:20px", "writing-mode"],
  ["writing-mode:sideways-lr;inline-size:20px", "writing-mode"],
  ["inline-size:2ic", "relative query length"],
  ["inline-size:inherit", "width"],
])(
  "real HTTP → workerd → Wasm: unsupported logical geometry %s fails explicitly",
  async (css, reason) => {
    const url = new URL("logical-size/0", origin.url).href;
    const expression = `(()=>{const box=document.createElement('div');box.style.cssText=${JSON.stringify(css)};document.body.append(box);return box.getBoundingClientRect()})()`;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression }),
    });
    expect(response.status).toBe(422);
    expect(await response.text()).toContain(`layout unsupported: ${reason}`);
    const healthy = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "logicalSizeCase(0)" }),
    });
    expect(healthy.status).toBe(200);
  },
);

test.each(
  (
    [
      ["2ex", "relative query length"],
      ["calc(infinity * 1px)", "non-finite value"],
      [`calc(${Array(40).fill("min(10%, 2px)").join(" + ")})`, "background position nesting"],
    ] as const
  ).flatMap(([position, detail]) =>
    [
      "getComputedStyle(document.body).backgroundPositionX",
      "document.body.getBoundingClientRect()",
    ].map((read) => [position, detail, read] as const),
  ),
)(
  "real HTTP → workerd → Wasm: background position scalar and geometry %s / %s / %s",
  async (position, detail, read) => {
    const url = new URL("background-position/0", origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url,
        expression: `(()=>{document.body.style.cssText='width:40px;height:10px';document.body.style.backgroundPositionX=${JSON.stringify(position)};return ${read}})()`,
      }),
    });
    if (read === "document.body.getBoundingClientRect()") {
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ value: { width: 40, height: 10 } });
    } else {
      expect(response.status).toBe(422);
      expect(await response.text()).toContain(detail);
    }
    const healthy = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "backgroundPositionCase(0)" }),
    });
    expect(healthy.status).toBe(200);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native constructed stylesheets variant %i",
  async (variant) => {
    const url = new URL(`constructed-sheets/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: `constructedSheetsCase(${variant})` }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing CSSOM checks");
    expect(Object.keys(value)).toHaveLength(46);
    for (const [name, check] of Object.entries(value))
      expect(check).toBe(name !== "nonconfigIndexDefine");
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: URL objects and live query variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`urls/${variant}`, origin.url).href,
        expression: `urlsCase(${variant})`,
      }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing result");
    const checks: unknown = Reflect.get(result, "value");
    if (typeof checks !== "object" || checks === null) throw new Error("Missing checks");
    expect(Object.keys(checks)).toHaveLength(42);
    expect(Object.values(checks).every((value) => value === true)).toBe(true);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: resolved box values variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`resolved-box-values/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing result");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing checks");
    expect(Object.keys(value)).toHaveLength(37);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test("native text layout uses real normal metrics and invalidates cleared fonts", async () => {
  const r = await requestTextLayout(
    `(async()=>{await globalThis.comparison;const e=document.querySelector('div');e.textContent='AB';e.style.lineHeight='normal';const loaded=e.getBoundingClientRect().height;document.fonts.clear();const fallback=e.getBoundingClientRect().height;return {loaded,fallback,width:getComputedStyle(e).width};})()`,
  );
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({ value: { loaded: 16, fallback: 18, width: "100px" } });
});

test("native font settings reject negative feature indices without changing real geometry", async () => {
  const response = await requestAuthoredButton(
    "(()=>{const e=document.createElement('div');e.style.cssText='width:max-content;font-feature-settings:normal';e.textContent='AB';document.body.append(e);const before=e.getBoundingClientRect().width;e.style.fontFeatureSettings='\"kern\" -1';return {setting:e.style.fontFeatureSettings,stable:e.getBoundingClientRect().width===before};})()",
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ value: { setting: "normal", stable: true } });
});

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: rounded box variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`rounded-box/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      value: Object.fromEntries(
        ["root", "child", "scroll", "mutation", "intersection", "rootBounds"].map((key) => [
          key,
          true,
        ]),
      ),
    });
  },
);

test("real HTTP → workerd → Wasm: shadow geometry keeps paint support explicit", async () => {
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url: new URL("box-shadow-geometry/0", origin.url).href,
      expression: "CSS.supports('box-shadow','4px 8px 12px black')",
    }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ value: false });
});
