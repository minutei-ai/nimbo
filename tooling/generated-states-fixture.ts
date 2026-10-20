export function generatedStatesFixture(path: string): Response | undefined {
  if (!path.startsWith("/generated-states/")) return undefined;
  if (path.endsWith("/charset"))
    return new Response(
      `<!doctype html>
<style>@charset "UTF-8";#first{width:17px}</style>
<style>.seed{}@charset "UTF-8";#late{height:19px}</style>
<style>@charset "UTF-8";@charset "UTF-8";#duplicate{width:21px}</style>
<style>@media(min-width:1px){.seed{}@charset "UTF-8";#group{height:23px}}</style>
<style>#discard{height:29px}@charset "UTF-8"{#discard{height:999px}}#following{width:31px}</style>
<div id="first"></div><div id="late"></div><div id="duplicate"></div><div id="group"></div><div id="discard"></div><div id="following"></div>`,
      { headers: { "content-type": "text/html" } },
    );
  if (path.endsWith("/unknown-rule"))
    return new Response("<style>@unknown-foo{div{height:9px}}</style><div></div>", {
      headers: { "content-type": "text/html" },
    });
  if (path.endsWith("/logical"))
    return new Response(
      `<!doctype html><style>
#logical::before{content:"";display:block;height:3px}
#logical::before:not(:focus){height:5px}
#logical::before:is(:hover,:not(:focus)){height:9px}
#logical::before:where(:not(:active)){height:11px}
#logical::before:not(:hover,:not(:focus)){height:999px}
#plain{width:17px}.mixed::before:focus,#plain{width:27px}
</style><div id="logical"></div><div id="plain"></div><script>globalThis.comparison={height:document.getElementById('logical').getBoundingClientRect().height,width:getComputedStyle(document.getElementById('plain')).width};</script>`,
      { headers: { "content-type": "text/html" } },
    );
  if (path.endsWith("/sub-pseudo"))
    return new Response(
      '<style>div::before::marker{content:"";display:block;height:7px}</style><div></div><script>globalThis.comparison=getComputedStyle(document.querySelector("div")).height</script>',
      { headers: { "content-type": "text/html" } },
    );
  const variant = Number(path.split("/").at(-1));
  if (!Number.isInteger(variant) || variant < 0 || variant >= 64)
    return new Response("Not found", { status: 404 });
  const size = (variant + 1) / 4;
  return new Response(
    `<!doctype html><style>
body{margin:0}.box{width:17px}.box::before{content:"";display:block;height:${size}px}
.focus::before:focus,.legacy:after:focus,.hover::before:hover,.active::before:active,.visible::before:focus-visible,.within::before:focus-within,.logical::before:is(:hover,:focus),.logical::before:not(:not(:active)){content:"";display:block;height:999px}
.origin:not(:focus)::before{height:${size + 1}px}
#specific.box::before{height:${size + 2}px}.specific::before{height:999px}
.ancestor .nested::before{height:${size + 3}px}.ancestor .nested::before:hover{height:999px}
.normal::before{width:999px}
.swapped::before{height:${size + 4}px}
.dynamic:has(input:checked)::before{height:${size + 5}px}
.invalid{width:17px;height:${size}px}
.invalid::before:first-child,.invalid{height:999px}
</style>
${["focus", "legacy", "hover", "active", "visible", "within", "logical", "origin", "specific", "normal", "changing"].map((name) => `<div class="box ${name}" id="${name}"></div>`).join("")}
<div class="ancestor"><div class="box nested" id="nested"></div></div>
<div class="box dynamic" id="dynamic"><input type="checkbox" style="display:none"></div>
<div class="invalid" id="invalid"></div>
<script>
const height=id=>document.getElementById(id).getBoundingClientRect().height;
const checks={focus:height('focus')===${size},legacy:height('legacy')===${size},hover:height('hover')===${size},active:height('active')===${size},visible:height('visible')===${size},within:height('within')===${size},logical:height('logical')===${size},origin:height('origin')===${size + 1},specific:height('specific')===${size + 2},ancestor:height('nested')===${size + 3},normal:getComputedStyle(document.getElementById('normal')).width==='17px',invalid:height('invalid')===${size}};
document.getElementById('changing').classList.add('swapped');
checks.changed=height('changing')===${size + 4};
checks.initial=height('dynamic')===${size};
document.querySelector('input').checked=true;
checks.checked=height('dynamic')===${size + 5};
document.querySelector('input').checked=false;
checks.unchecked=height('dynamic')===${size};
globalThis.comparison=checks;
</script>`,
    { headers: { "content-type": "text/html" } },
  );
}
