const assets = new Map([
  ["small.png", "image/png"],
  ["large.png", "image/png"],
  ["small.jpeg", "image/jpeg"],
  ["oriented.jpeg", "image/jpeg"],
  ["small.gif", "image/gif"],
  ["small.webp", "image/webp"],
]);

export async function imageResourcesFixture(path: string, request: Request) {
  if (!path.startsWith("/image-resources/")) return undefined;
  if (path === "/image-resources/data-comparison") {
    const html = await Bun.file(
      new URL("../crates/engine/tests/fixtures/image-resources/data.html", import.meta.url),
    ).text();
    const expression = await Bun.file(
      new URL("../crates/engine/tests/fixtures/image-data.txt", import.meta.url),
    ).text();
    return new Response(
      `${html}<script>globalThis.comparisonPromise=new Promise(resolve=>addEventListener('load',()=>resolve(${expression}),{once:true}));</script>`,
      { headers: { "content-type": "text/html" } },
    );
  }
  if (path === "/image-resources/data")
    return new Response(
      Bun.file(
        new URL("../crates/engine/tests/fixtures/image-resources/data.html", import.meta.url),
      ),
      { headers: { "content-type": "text/html" } },
    );
  if (path === "/image-resources/empty-source")
    return new Response(
      Bun.file(
        new URL(
          "../crates/engine/tests/fixtures/image-resources/empty-source.html",
          import.meta.url,
        ),
      ),
      { headers: { "content-type": "text/html" } },
    );
  if (path === "/image-resources/page") {
    const headers = new Headers({ "content-type": "text/html", "cache-control": "no-store" });
    for (const method of [
      "property",
      "namespace",
      "attribute",
      "inert",
      "auto-shadow",
      "auto-detached",
    ])
      headers.append("set-cookie", `image-${method}=; Max-Age=0; Path=/image-resources/`);
    return new Response("<!doctype html><img id=loaded src=/image-resources/small.png>", {
      headers,
    });
  }
  if (path === "/image-resources/empty")
    return new Response("<!doctype html><body></body>", {
      headers: { "content-type": "text/html" },
    });
  const name = path.slice("/image-resources/".length);
  if (["inert.png", "auto-shadow.png", "auto-detached.png"].includes(name))
    return new Response(
      Bun.file(
        new URL("../crates/engine/tests/fixtures/image-resources/small.png", import.meta.url),
      ),
      {
        headers: {
          "content-type": "image/png",
          "cache-control": "no-store",
          "set-cookie": `image-${name.slice(0, -4)}=ready; Path=/image-resources/; SameSite=Lax`,
        },
      },
    );
  if (name.startsWith("retry-") && name.endsWith(".png")) {
    const method = name.slice("retry-".length, -".png".length);
    const cookie = `image-${method}=ready`;
    const ready = (request.headers.get("cookie") ?? "")
      .split(";")
      .some((value) => value.trim() === cookie);
    const headers = {
      "content-type": "image/png",
      "cache-control": "no-store",
      "set-cookie": `${cookie}; Path=/image-resources/; SameSite=Lax`,
    };
    if (ready)
      return new Response(
        Bun.file(
          new URL("../crates/engine/tests/fixtures/image-resources/small.png", import.meta.url),
        ),
        { headers },
      );
    return new Response("invalid image", { headers });
  }
  if (name === "truncated.png") {
    const data = await Bun.file(
      new URL("../crates/engine/tests/fixtures/image-resources/small.png", import.meta.url),
    ).bytes();
    return new Response(data.subarray(0, 40), {
      headers: { "content-type": "image/png", "cache-control": "no-store" },
    });
  }
  if (name === "slow.png" || name === "slow-large.png") {
    await Bun.sleep(40);
    return new Response(
      Bun.file(
        new URL(
          "../crates/engine/tests/fixtures/image-resources/" +
            (name === "slow-large.png" ? "large.png" : "small.png"),
          import.meta.url,
        ),
      ),
      { headers: { "content-type": "image/png", "cache-control": "no-store" } },
    );
  }
  const type = assets.get(name);
  if (type)
    return new Response(
      Bun.file(new URL("../crates/engine/tests/fixtures/image-resources/" + name, import.meta.url)),
      { headers: { "content-type": type, "cache-control": "no-store" } },
    );
  return new Response("invalid image", {
    headers: { "content-type": "image/png", "cache-control": "no-store" },
  });
}
