export function pictureFixture(path: string): Response | undefined {
  if (!path.startsWith("/pictures/")) return undefined;
  const name = path.split("/").at(-1) ?? "";
  if (["small.png", "large.png"].includes(name))
    return new Response(
      Bun.file(new URL(`../crates/engine/tests/fixtures/image-resources/${name}`, import.meta.url)),
      { headers: { "content-type": "image/png" } },
    );
  if (name === "bytes")
    return new Response(
      `<picture><source srcset="${"x".repeat(65537)}"><img src="/pictures/small.png"></picture>`,
      { headers: { "content-type": "text/html" } },
    );
  const documents: Record<string, string> = {
    threshold:
      '<picture><source media="(max-width:132px)" type="IMAGE/PNG; charset=utf-8" srcset="/pictures/large.png"><img id="image" src="/pictures/small.png"></picture><script>globalThis.comparison=new Promise(resolve=>addEventListener("load",()=>{const image=document.getElementById("image");resolve({url:new URL(image.currentSrc).pathname,width:image.naturalWidth});}));</script>',
    width:
      '<picture><source srcset="/pictures/large.png 64w"><img src="/pictures/small.png"></picture>',
  };
  const document = documents[name];
  if (document !== undefined)
    return new Response(document, { headers: { "content-type": "text/html" } });
  const variant = Number(name);
  if (!Number.isInteger(variant) || variant < 0 || variant >= 64)
    return new Response("Not found", { status: 404 });
  const small = `/pictures/${variant}/small.png`;
  const large = `/pictures/${variant}/large.png`;
  return new Response(
    `<!doctype html>
<picture><img id="plain" src="${small}"></picture>
<picture><source media="(max-width:132px)" srcset="${large}"><source media="(max-width:132px) and (min-width:132px)" srcset="${large}"><img id="fallback" src="${small}"></picture>
<picture><source media="(min-width:132px)" srcset="${large}"><img id="matched" src="${small}"></picture>
<picture><source srcset="${small}"><source srcset="${large}"><img id="first" src="${large}"></picture>
<picture><img id="after" src="${small}"><source srcset="${large}"></picture>
<picture><source type="image/x-unavailable" srcset="${large}"><img id="type" src="${small}"></picture>
<picture><source srcset="${large} 2x"><img id="density" src="${small}"></picture>
<picture><source srcset=""><source srcset="${large}"><img id="empty" src="${small}"></picture>
<picture><source type="" srcset="${large}"><img id="emptyType" src="${small}"></picture>
<picture><source id="changing" media="(max-width:1px)" srcset="${large}"><img id="dynamic" src="${small}"></picture>
<script>
const matches=(id,name,width)=>{const image=document.getElementById(id);return image.complete&&image.currentSrc.endsWith('/'+name)&&image.naturalWidth===width;};
globalThis.comparison=new Promise(resolve=>addEventListener('load',async()=>{
 const checks={plain:matches('plain','small.png',32),fallback:matches('fallback','small.png',32),matched:matches('matched','large.png',64),first:matches('first','small.png',32),after:matches('after','small.png',32),type:matches('type','small.png',32),density:matches('density','large.png',32),empty:matches('empty','large.png',64),emptyType:matches('emptyType','small.png',32),initial:matches('dynamic','small.png',32)};
 const source=document.getElementById('changing');
 const image=document.getElementById('dynamic');
 const update=(mutate)=>new Promise(done=>{image.onload=()=>done(true);image.onerror=()=>done(false);mutate();});
 checks.media=(await update(()=>source.setAttribute('media','all')))&&matches('dynamic','large.png',64);
 checks.unsupported=(await update(()=>source.setAttribute('type','image/x-unavailable')))&&matches('dynamic','small.png',32);
 checks.supported=(await update(()=>source.setAttribute('type','image/png')))&&matches('dynamic','large.png',64);
 checks.removed=(await update(()=>source.remove()))&&matches('dynamic','small.png',32);
 const inserted=document.createElement('source');
 inserted.setAttribute('srcset','${large}');
 checks.inserted=(await update(()=>image.before(inserted)))&&matches('dynamic','large.png',64);
 checks.moved=(await update(()=>image.after(inserted)))&&matches('dynamic','small.png',32);
 resolve(checks);
},{once:true}));
</script>`,
    { headers: { "content-type": "text/html" } },
  );
}
