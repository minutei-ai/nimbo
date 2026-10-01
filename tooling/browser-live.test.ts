import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { Miniflare } from "miniflare";

const requests: string[] = [];
const comparisonBinary = process.env.NIMBO_COMPARE_OBSCURA_BINARY;
async function comparePage(binary: string, url: string): Promise<unknown> {
  const child = Bun.spawn(
    [
      binary,
      "fetch",
      url,
      "--allow-private-network",
      "--wait-until",
      "networkidle0",
      "--wait",
      "0",
      "--quiet",
      "--eval",
      "JSON.stringify(globalThis.comparison)",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [output, error, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(error).toBe("");
  expect(exit).toBe(0);
  return JSON.parse(output);
}

const expressionFor = (variant: number) => `(async () => {
          const section = document.querySelector('[data-id="${variant}"]');
          const first = section.querySelector('.item:first-child');
          const before = first.textContent;
          const self = first.closest('i') === first;
          const ancestor = first.closest('main') === document.getElementById('root');
          const matches = first.matches('section > i.item[data-state="old"]');
          const missing = first.closest('.missing');
          const parent = first.parentElement === section;
          const children = section.firstElementChild === first && section.lastElementChild.textContent === 'second';
          const siblings = first.nextElementSibling.previousElementSibling === first && first.previousElementSibling === null;
          const connected = first.isConnected && document.isConnected && document.contains(first) && first.contains(first);
          const rootParent = document.documentElement.parentElement;
          first.removeAttribute('data-state');
          const removed = !first.hasAttribute('data-state');
          first.setAttribute('data-state', '${variant}');
          const changed = first.matches('[data-state="${variant}"]');
          first.remove();
          const detached = first.parentElement === null && !first.isConnected && !document.contains(first) && first.nextElementSibling === null;
          const after = section.querySelector('.item:first-child').textContent;
          section.appendChild(first);
          const restored = first.parentElement === section && first.isConnected && section.lastElementChild === first && first.previousElementSibling.textContent === 'second';
          const text = section.querySelector('.item:last-child').textContent;
          const leading = section.firstChild;
          const comment = leading.nextSibling;
          const parsedNodes = leading instanceof Text && leading.nodeType === 3 && leading.nodeName === '#text'
            && comment instanceof Comment && comment.nodeType === 8 && comment.data === 'before'
            && comment.previousSibling === leading && leading.parentNode === section;
          const hierarchy = document instanceof Document && document instanceof Node && !(document instanceof Element)
            && first instanceof Element && first instanceof Node && leading instanceof CharacterData;
          const documentNode = document.nodeType === 9 && document.nodeName === '#document'
            && document.textContent === null && document.nodeValue === null && document.parentNode === null;
          const created = document.createTextNode('created-${variant}-😀');
          const note = document.createComment('note-${variant}');
          const constructed = new Text('constructor') instanceof Text && new Comment('constructor') instanceof Comment;
          const fresh = created.parentNode === null && !created.isConnected && created.nodeValue === 'created-${variant}-😀'
            && created.length === 'created-${variant}-😀'.length && created.textContent === created.data;
          const appended = section.appendChild(created) === created && section.appendChild(note) === note
            && section.lastChild === note && note.previousSibling === created && created.nextSibling === note
            && created.parentElement === section && created.isConnected && document.contains(created);
          created.data = 'changed-${variant}-α';
          note.textContent = 'changed note';
          const mutated = created.nodeValue === 'changed-${variant}-α' && section.textContent.endsWith(created.data)
            && note.data === 'changed note' && !section.textContent.includes(note.data)
            && section.innerHTML.endsWith('changed-${variant}-α<!--changed note-->');
          first.nodeValue = 'ignored';
          const elementValue = first.nodeValue === null && first.textContent === before;
          created.remove();
          const textDetached = !created.isConnected && created.parentNode === null && created.nextSibling === null
            && note.previousSibling === first;
          let cycle = false;
          try { first.appendChild(section); } catch { cycle = true; }
          const cycleSafe = cycle && first.parentNode === section && section.parentNode === document.getElementById('root');
          const nodeChecks = {parsedNodes, hierarchy, documentNode, constructed, fresh, appended, mutated, elementValue, textDetached, cycleSafe};
          const result = await fetch('/echo', {method: 'POST', body: 'payload-${variant}-α'});
          return {title: document.title, before, self, ancestor, matches, missing,
            parent, children, siblings, connected, rootParent, removed, changed, detached, after, restored, text,
            nodeChecks, count: document.querySelectorAll('main .item').length, echo: await result.json()};
        })()`;

const treeExpressionFor = (variant: number) => `(() => {
  const doctype = document.firstChild;
  const documentType = doctype.nodeType === 10 && doctype.nodeName === 'html'
    && doctype.ownerDocument === document && doctype.nodeValue === null && doctype.textContent === null;
  const host = document.createElement('section');
  document.body.appendChild(host);
  const fragment = document.createDocumentFragment();
  const a = document.createElement('b'); a.textContent = 'a-${variant}';
  const text = new Text('α-${variant}');
  const marker = new Comment('marker');
  fragment.appendChild(a);
  globalThis.treeStage = 'append-text-to-fragment';
  fragment.appendChild(text); fragment.appendChild(marker);
  globalThis.treeStage = 'validate-fragment';
  const fragmentState = fragment instanceof DocumentFragment && fragment instanceof Node
    && fragment.nodeType === 11 && fragment.nodeName === '#document-fragment'
    && fragment.ownerDocument === document && a.ownerDocument === document
    && document.ownerDocument === null && a.parentNode === fragment && !a.isConnected
    && fragment.querySelector('b') === a && fragment.textContent === 'a-${variant}α-${variant}';
  const inserted = host.appendChild(fragment) === fragment && fragment.firstChild === null
    && fragment.lastChild === null && !fragment.isConnected && host.firstChild === a
    && a.nextSibling === text && text.nextSibling === marker && marker.previousSibling === text
    && host.lastChild === marker && a.isConnected && marker.parentNode === host;
  const noops = host.insertBefore(a, a) === a && host.insertBefore(new DocumentFragment(), a).firstChild === null
    && host.firstChild === a && a.nextSibling === text;
  const replacement = new DocumentFragment();
  const x = document.createElement('i'); x.textContent = 'x';
  const y = document.createElement('i'); y.textContent = 'y';
  replacement.appendChild(x); replacement.appendChild(y);
  const replaced = host.replaceChild(replacement, a) === a && !a.isConnected && a.parentNode === null
    && replacement.firstChild === null && host.firstChild === x && x.nextSibling === y && y.nextSibling === text;
  const moved = host.replaceChild(y, x) === x && x.parentNode === null && host.firstChild === y && y.nextSibling === text;
  const same = host.replaceChild(y, y) === y && host.firstChild === y && y.nextSibling === text;
  const removed = host.removeChild(marker) === marker && marker.parentNode === null
    && marker.previousSibling === null && host.lastChild === text;
  const errors = [];
  for (const action of [
    () => host.insertBefore(a, marker),
    () => host.replaceChild(a, marker),
    () => host.removeChild(marker),
    () => y.appendChild(host),
    () => text.appendChild(a),
    () => document.appendChild(new Text('invalid')),
    () => document.appendChild(document.createElement('other-root')),
    () => document.appendChild(doctype),
    () => host.appendChild(doctype),
    () => document.insertBefore(document.documentElement, doctype),
  ]) { try { action(); errors.push('no error'); } catch (error) { errors.push(error instanceof DOMException ? error.name : 'wrong exception'); } }
  const atomic = host.firstChild === y && y.nextSibling === text && a.parentNode === null
    && host.parentNode === document.body && document.firstChild === doctype && document.documentElement.tagName === 'HTML';
  const invalidFragment = new DocumentFragment();
  const rootA = document.createElement('a'); const rootB = document.createElement('b');
  invalidFragment.appendChild(rootA); invalidFragment.appendChild(rootB);
  let invalidDocument = false;
  try { document.replaceChild(invalidFragment, document.documentElement); }
  catch (error) { invalidDocument = error instanceof DOMException && error.name === 'HierarchyRequestError'; }
  const fragmentAtomic = invalidDocument && invalidFragment.firstChild === rootA
    && rootA.nextSibling === rootB && rootA.parentNode === invalidFragment && document.documentElement.tagName === 'HTML';
  fragment.textContent = 'new-${variant}'; const generated = fragment.firstChild;
  const fragmentText = generated instanceof Text && generated.data === 'new-${variant}';
  fragment.textContent = '';
  const emptyText = fragment.firstChild === null && generated.parentNode === null;
  host.textContent = '';
  const emptyElement = host.firstChild === null && y.parentNode === null && text.parentNode === null;
  const freshRoot = document.createElement('html');
  freshRoot.appendChild(document.createElement('body'));
  const oldRoot = document.documentElement;
  const documentReplace = document.replaceChild(freshRoot, oldRoot) === oldRoot
    && document.documentElement === freshRoot && !oldRoot.isConnected && freshRoot.isConnected;
  return {documentType, fragmentState, inserted, noops, replaced, moved, same, removed, errors, atomic,
    fragmentAtomic, fragmentText, emptyText, emptyElement, documentReplace};
})()`;

const collectionExpressionFor = (variant: number) => `(() => {
  const host = document.createElement('section'); document.body.appendChild(host);
  host.innerHTML = 'lead<!--marker--><i id="first-${variant}" name="shared">first</i><b id="second-${variant}" name="shared">second</b>';
  const all = host.childNodes; const elements = host.children; const snapshot = host.querySelectorAll('i,b');
  const first = host.querySelector('i'); const second = host.querySelector('b');
  const kinds = all instanceof NodeList && snapshot instanceof NodeList && elements instanceof HTMLCollection
    && !Array.isArray(all) && !Array.isArray(snapshot) && !Array.isArray(elements)
    && Object.prototype.toString.call(all) === '[object NodeList]' && Object.prototype.toString.call(elements) === '[object HTMLCollection]';
  const identity = all === host.childNodes && elements === host.children && snapshot !== host.querySelectorAll('i,b');
  const index = all.length === 4 && elements.length === 2 && host.childElementCount === 2
    && all[2] === first && all.item(2) === first && elements[0] === first && snapshot[1] === second
    && all[100] === undefined && all.item(100) === null && all.item(-1) === null
    && all.item(4294967296) === all[0] && all.item(1.8) === all[1] && elements.item(100) === null;
  const names = elements.namedItem('shared') === first && elements.shared === first
    && elements.namedItem('first-${variant}') === first && elements['first-${variant}'] === first
    && elements.namedItem('') === null && elements.namedItem('missing') === null;
  const reflection = Object.keys(all).join(',') === '0,1,2,3' && Object.keys(elements).join(',') === '0,1'
    && Object.hasOwn(elements, 'shared') && 'shared' in elements && '2' in all && !('100' in all)
    && Object.getOwnPropertyDescriptor(all, '2').value === first
    && Object.getOwnPropertyDescriptor(all, '2').writable === false
    && Object.getOwnPropertyDescriptor(elements, 'shared').enumerable === false;
  const readonly = !Reflect.set(all, '0', second) && !Reflect.defineProperty(all, '100', {value: second})
    && !Reflect.deleteProperty(all, '0') && Reflect.deleteProperty(all, '100') && !Reflect.preventExtensions(all)
    && !Reflect.set(elements, 'shared', second) && elements.shared === first && all[0].nodeType === 3;
  const entries = Array.from(snapshot.entries());
  const iteration = Array.from(snapshot).map(n => n.textContent).join(',') === 'first,second'
    && Array.from(snapshot.keys()).join(',') === '0,1' && entries[0][0] === 0 && entries[0][1] === first
    && Array.from(elements).length === 2 && snapshot[Symbol.iterator] === snapshot.values;
  const context = {}; const calls = [];
  snapshot.forEach(function(value, index, list) { calls.push(this === context && list === snapshot && list[index] === value); }, context);
  const callback = calls.length === 2 && calls.every(Boolean);
  const liveIterator = elements[Symbol.iterator](); const iteratorFirst = liveIterator.next().value;
  const added = document.createElement('u'); added.textContent = 'new-${variant}'; host.appendChild(added);
  const live = all.length === 5 && elements.length === 3 && all[4] === added && elements[2] === added
    && snapshot.length === 2 && snapshot[2] === undefined && iteratorFirst === first
    && liveIterator.next().value === second && liveIterator.next().value === added && liveIterator.next().done;
  first.remove();
  const removed = all.length === 4 && elements.length === 2 && elements[0] === second
    && elements.namedItem('shared') === second && elements['first-${variant}'] === undefined
    && snapshot[0] === first && !snapshot[0].isConnected;
  second.setAttribute('name', 'changed'); second.id = 'length';
  const renamed = elements.shared === undefined && elements.namedItem('changed') === second
    && elements.changed === second && elements.length === 2 && elements.namedItem('length') === second;
  const foreign = document.createElement('aside'); foreign.appendChild(added);
  const reparent = elements.length === 1 && all.length === 3 && foreign.children[0] === added;
  host.textContent = '';
  const cleared = all.length === 0 && elements.length === 0 && snapshot.length === 2
    && snapshot[1] === second && second.parentNode === null;
  const fragment = new DocumentFragment(); const fragmentNodes = fragment.childNodes; const fragmentElements = fragment.children;
  fragment.appendChild(first); fragment.appendChild(document.createElement('em'));
  const fragmentLive = fragmentNodes.length === 2 && fragmentElements.length === 2 && fragmentElements[0] === first;
  host.appendChild(fragment);
  const transferred = fragmentNodes.length === 0 && fragmentElements.length === 0 && all.length === 2 && elements[0] === first;
  const errors = [];
  for (const action of [() => new NodeList(), () => new HTMLCollection(), () => all.item(),
    () => elements.namedItem(), () => NodeList.prototype.item.call({}, 0),
    () => NodeList.prototype.entries.call({}), () => elements.namedItem(Symbol('invalid'))]) {
    try { action(); errors.push(false); } catch (error) { errors.push(error instanceof TypeError); }
  }
  const guarded = errors.length === 7 && errors.every(Boolean);
  return {kinds, identity, index, names, reflection, readonly, iteration, callback,
    live, removed, renamed, reparent, cleared, fragmentLive, transferred, guarded};
})()`;

const eventExpressionFor = (variant: number) => `(() => {
  const root = document.getElementById('event-root'); const child = document.getElementById('event-child');
  const chain = [window, document, document.documentElement, document.body, root, child];
  const roles = ['window','document','html','body','root','child']; const order = []; let context = true;
  const type = 'flow-${variant}'; const detail = {variant:${variant}};
  for (let index = 0; index < chain.length; index++) {
    for (const capture of [true, false]) chain[index].addEventListener(type, function(event) {
      order.push(roles[index]+':'+event.eventPhase);
      context = context && this === chain[index] && event.currentTarget === this && event.target === child
        && event.detail === detail && event.composedPath().length === chain.length
        && event.composedPath()[0] === child && event.composedPath().at(-1) === window;
    }, capture);
  }
  const event = new CustomEvent(type, {bubbles:true,cancelable:true,composed:true,detail});
  const returned = child.dispatchEvent(event);
  const phases = order.join(',') === 'window:1,document:1,html:1,body:1,root:1,child:2,child:2,root:3,body:3,html:3,document:3,window:3';
  const reset = returned && context && event.currentTarget === null && event.target === child && event.eventPhase === Event.NONE && event.NONE === 0 && Event.CAPTURING_PHASE === 1
    && Event.AT_TARGET === 2 && Event.BUBBLING_PHASE === 3 && Object.prototype.toString.call(event) === '[object CustomEvent]'
    && event.composedPath().length === 0 && !event.isTrusted && !Reflect.set(event, 'isTrusted', true)
    && event.bubbles && event.cancelable && event.composed && event.detail === detail;
  const nonBubble = [];
  for (const [index,target] of chain.entries()) for (const capture of [true,false])
    target.addEventListener('non-bubble', event => nonBubble.push(roles[index]+':'+event.eventPhase), capture);
  child.dispatchEvent(new Event('non-bubble'));
  const captures = nonBubble.join(',') === 'window:1,document:1,html:1,body:1,root:1,child:2,child:2';
  const generic = new EventTarget(); let count = 0; const duplicate = () => count++;
  generic.addEventListener('dup', duplicate); generic.addEventListener('dup', duplicate, {once:true});
  generic.addEventListener('dup', duplicate, true); generic.dispatchEvent(new Event('dup')); generic.dispatchEvent(new Event('dup'));
  generic.removeEventListener('dup', duplicate); generic.dispatchEvent(new Event('dup'));
  generic.removeEventListener('dup', duplicate, true); generic.dispatchEvent(new Event('dup'));
  const duplicates = count === 5;
  let onceCount = 0; generic.addEventListener('once', () => { onceCount++; generic.dispatchEvent(new Event('once')); }, {once:true});
  generic.dispatchEvent(new Event('once')); generic.dispatchEvent(new Event('once')); const once = onceCount === 1;
  const stopped = []; root.addEventListener('stop', e => {stopped.push('first'); e.stopPropagation();}, true);
  root.addEventListener('stop', () => stopped.push('second'), true); child.addEventListener('stop', () => stopped.push('child'));
  const stopEvent = new Event('stop', {bubbles:true}); child.dispatchEvent(stopEvent);
  const propagation = stopped.join(',') === 'first,second' && !stopEvent.cancelBubble;
  const immediateOrder = []; child.addEventListener('immediate', e => {immediateOrder.push('first'); e.stopImmediatePropagation();});
  child.addEventListener('immediate', () => immediateOrder.push('second')); root.addEventListener('immediate', () => immediateOrder.push('root'));
  child.dispatchEvent(new Event('immediate', {bubbles:true})); const immediate = immediateOrder.join(',') === 'first';
  generic.addEventListener('cancel', e => e.preventDefault()); const cancel = new Event('cancel', {cancelable:true});
  const cancellation = !generic.dispatchEvent(cancel) && cancel.defaultPrevented && !cancel.returnValue;
  const fixed = new Event('cancel'); const uncancelable = generic.dispatchEvent(fixed) && !fixed.defaultPrevented;
  let passiveIgnored = false; generic.addEventListener('passive', e => {e.preventDefault(); passiveIgnored = !e.defaultPrevented;}, {passive:true});
  const passiveEvent = new Event('passive', {cancelable:true}); const passive = generic.dispatchEvent(passiveEvent) && passiveIgnored;
  const wheel = e => e.preventDefault(); document.body.addEventListener('wheel', wheel);
  const defaultIgnored = child.dispatchEvent(new Event('wheel', {bubbles:true,cancelable:true}));
  document.body.removeEventListener('wheel', wheel); document.body.addEventListener('wheel', wheel, {passive:false,once:true});
  const defaultPolicy = defaultIgnored && !child.dispatchEvent(new Event('wheel', {bubbles:true,cancelable:true}));
  const mutation = []; const later = () => mutation.push('later'); const removed = () => mutation.push('removed');
  generic.addEventListener('mutation', () => {mutation.push('first'); generic.removeEventListener('mutation', removed); generic.addEventListener('mutation', later);});
  generic.addEventListener('mutation', removed); generic.dispatchEvent(new Event('mutation')); generic.dispatchEvent(new Event('mutation'));
  const mutated = mutation.join(',') === 'first,first,later';
  const handler = {handleEvent(e) {this.correct = e.currentTarget === generic;}};
  generic.addEventListener('object', handler); generic.dispatchEvent(new Event('object')); const object = handler.correct;
  let invalidState = false; const nested = new Event('nested');
  generic.addEventListener('nested', e => {try {generic.dispatchEvent(e);} catch(error) {invalidState = error instanceof DOMException && error.name === 'InvalidStateError';}});
  generic.dispatchEvent(nested); const reentry = invalidState && nested.currentTarget === null && nested.eventPhase === 0;
  const listenerError = new Error('listener-${variant}'); let reported = false; let continued = false;
  window.addEventListener('error', function(e) {reported = this === window && e instanceof ErrorEvent && e.error === listenerError
    && e.message === 'listener-${variant}' && e.target === window && e.isTrusted;}, {once:true});
  generic.addEventListener('error-source', () => {throw listenerError;}); generic.addEventListener('error-source', () => {continued = true;});
  generic.dispatchEvent(new Event('error-source')); const errors = reported && continued;
  const controller = new AbortController(); const reason = {variant:${variant}}; let aborted = 0; let abortEvent = false;
  const signal = controller.signal; signal.throwIfAborted(); signal.addEventListener('abort', e => {abortEvent = e.target === signal && e.isTrusted;});
  generic.addEventListener('abortable', () => aborted++, {signal}); generic.dispatchEvent(new Event('abortable'));
  controller.abort(reason); controller.abort('ignored'); generic.dispatchEvent(new Event('abortable'));
  let thrownReason = false; try {signal.throwIfAborted();} catch(error) {thrownReason = error === reason;}
  const abort = signal === controller.signal && signal.aborted && signal.reason === reason && aborted === 1 && abortEvent && thrownReason;
  const preaborted = AbortSignal.abort(); let preCount = 0;
  generic.addEventListener('preaborted', () => preCount++, {signal:preaborted}); generic.dispatchEvent(new Event('preaborted'));
  const preAbort = preCount === 0 && preaborted.aborted && preaborted.reason instanceof DOMException && preaborted.reason.name === 'AbortError';
  const pathOrder = []; child.addEventListener('path', () => {root.remove(); pathOrder.push('child');});
  root.addEventListener('path', () => pathOrder.push('root')); window.addEventListener('path', () => pathOrder.push('window'), {once:true});
  child.dispatchEvent(new Event('path', {bubbles:true})); const pathStable = pathOrder.join(',') === 'child,root,window' && !child.isConnected;
  document.body.appendChild(root);
  const guards = [];
  for (const action of [() => new Event(), () => new CustomEvent(), () => new ErrorEvent(), () => new AbortSignal(),
    () => generic.addEventListener(), () => generic.removeEventListener(),
    () => generic.addEventListener('invalid', () => {}, {signal:null}), () => EventTarget.prototype.dispatchEvent.call({}, new Event('invalid'))]) {
    try {action(); guards.push(false);} catch(error) {guards.push(error instanceof TypeError);}
  }
  const guarded = guards.length === 8 && guards.every(Boolean);
  const lifecycle = []; let lifecycleTrusted = true;
  document.addEventListener('DOMContentLoaded', function(e) {lifecycle.push('document:'+document.readyState+':'+e.eventPhase); lifecycleTrusted = lifecycleTrusted && e.isTrusted && e.target === document && e.currentTarget === this;}, {once:true});
  window.addEventListener('DOMContentLoaded', function(e) {lifecycle.push('window:'+document.readyState+':'+e.eventPhase); lifecycleTrusted = lifecycleTrusted && e.isTrusted && e.target === document && e.currentTarget === this;}, {once:true});
  window.addEventListener('load', function(e) {lifecycle.push('load:'+document.readyState+':'+e.eventPhase); lifecycleTrusted = lifecycleTrusted && e.isTrusted && e.target === document && e.currentTarget === this; globalThis.comparison.lifecycleTrusted = lifecycleTrusted;}, {once:true});
  return {phases, reset, captures, duplicates, once, propagation, immediate, cancellation, uncancelable,
    passive, defaultPolicy, mutated, object, reentry, errors, abort, preAbort, pathStable, guarded, lifecycle, lifecycleTrusted:false};
})()`;

const timerExpressionFor = (variant: number) => `(async () => {
  const order = []; const detail = {variant:${variant}}; let context = false; let canceled = true;
  let intervalCount = 0; let coerced = 0; let conversion = 0; let nested = 0; let errors = 0;
  queueMicrotask(() => order.push('micro'));
  Promise.resolve().then(() => order.push('promise'));
  const first = setTimeout(function(a,b) {
    context = this === window && a === detail && b === ${variant}; order.push('a');
    queueMicrotask(() => order.push('a-micro'));
    setTimeout(() => order.push('c'), 0);
  }, 0, detail, ${variant});
  const second = setTimeout(() => order.push('b'), 0);
  const canceledTimeout = setTimeout(() => canceled = false, 0); clearInterval(canceledTimeout);
  const interval = setInterval(() => {intervalCount++; if (intervalCount === 3) clearTimeout(interval);}, 2);
  const canceledInterval = setInterval(() => canceled = false, 0); clearTimeout(canceledInterval);
  setTimeout('globalThis.timerString = ${variant}', 1);
  setTimeout(() => coerced++, {valueOf() {conversion++; return 7;}});
  const nesting = new Promise(resolve => {
    const nest = () => {nested++; if (nested < 9) setTimeout(nest, 0); else resolve();}; setTimeout(nest, 0);
  });
  window.addEventListener('error', event => {if (event.isTrusted && event.message.startsWith('timer-error')) errors++;});
  setTimeout(() => {throw new Error('timer-error-task');}, 0);
  queueMicrotask(() => {throw new Error('timer-error-microtask');});
  const guards = [];
  for (const action of [() => setTimeout(), () => setInterval(), () => clearTimeout(), () => clearInterval(),
    () => queueMicrotask(), () => queueMicrotask('bad'), () => setTimeout(() => {}, 1n), () => setTimeout(() => {}, Symbol())]) {
    try {action(); guards.push(false);} catch(error) {guards.push(error instanceof TypeError);}
  }
  const network = new Promise(resolve => setTimeout(() => {
    fetch('/echo', {method:'POST',body:'timer-${variant}'}).then(response => response.json()).then(resolve);
  }, 10));
  const [fetched] = await Promise.all([network, nesting, new Promise(resolve => setTimeout(resolve, 35))]);
  return {order:order.join(','),context,canceled,interval:intervalCount === 3,coercion:coerced === 1 && conversion === 1,
    nested:nested === 9,errors:errors === 2,string:globalThis.timerString === ${variant},guarded:guards.length === 8 && guards.every(Boolean),
    ids:Number.isInteger(first) && first > 0 && second > first && interval !== first,
    fetched:fetched.method === 'POST' && fetched.body === 'timer-${variant}'};
})()`;

const origin = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    requests.push(`${request.method} ${path}`);
    if (path === "/echo")
      return Response.json({ method: request.method, body: await request.text() });
    if (path === "/module-bad-mime.js")
      return new Response("globalThis.invalidMimeExecuted = true;", {
        headers: { "content-type": "text/plain" },
      });
    if (path.startsWith("/module-failures/")) {
      const variant = Number(path.slice(17));
      if (!Number.isInteger(variant) || variant < 0 || variant >= 64)
        return new Response("Not found", { status: 404 });
      const scripts = [
        "<script type='module'>export const = 1;</script>",
        "<script type='module'>import value from 'unmapped';</script>",
        "<script type='module'>import 'http://localhost:9/blocked.js';</script>",
        "<script type='module'>import value from './data.json' with {type:'json'};</script>",
        "<script type='module' src='/module-bad-mime.js'></script>",
        "<script type='module' src='/module-missing.js'></script>",
        "<script type='module'>import {missing} from '/module-assets/0/shared.js';</script>",
        "<script type='module'>await Promise.reject(new Error('module rejected'));</script>",
      ];
      return new Response(`<title>Module failure ${variant}</title>${scripts[variant % 8]}`, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (path.startsWith("/modules/")) {
      const variant = Number(path.slice(9));
      if (!Number.isInteger(variant) || variant < 0 || variant >= 64)
        return new Response("Not found", { status: 404 });
      return new Response(
        `<title>Modules ${variant}</title><script>globalThis.moduleOrder = []; globalThis.moduleStates = []; globalThis.moduleDone = new Promise(resolve => globalThis.finishModule = resolve); document.addEventListener('DOMContentLoaded', () => moduleOrder.push('dcl'));</script><script type="module" src="/module-assets/${variant}/redirect.js"></script><script defer src="/module-assets/${variant}/defer.js"></script><script type="module">import {bump} from '/module-assets/${variant}/shared.js'; moduleOrder.push('inline'); moduleStates.push(document.readyState); bump(); globalThis.inlineMetaCorrect = import.meta.url.endsWith('/modules/${variant}');</script><script nomodule>globalThis.legacyRan = true;</script><script>moduleOrder.push('classic');</script>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    if (path.startsWith("/module-assets/")) {
      const match = /^\/module-assets\/(\d+)\/(.+)$/.exec(path);
      if (!match) return new Response("Not found", { status: 404 });
      const variant = Number(match[1]);
      const asset = match[2];
      if (asset === "redirect.js")
        return new Response(null, {
          status: 302,
          headers: { location: `/module-assets/${variant}/nested/entry.js` },
        });
      const sources: Record<string, string> = {
        "shared.js": `globalThis.sharedLoads = (globalThis.sharedLoads || 0) + 1; export let count = 0; export function bump() {count++;} export default {value:${variant}};`,
        "reexport.js": "export {default as again} from './shared.js';",
        "cycle-a.js":
          "import {getB} from './cycle-b.js'; export const a = 'a'; export function readA() {return a + getB();}",
        "cycle-b.js":
          "import {a} from './cycle-a.js'; export function getB() {return 'b';} export function readAAgain() {return a;}",
        "defer.js": "moduleOrder.push('defer'); moduleStates.push(document.readyState);",
        "nested/entry.js": `import value, {count,bump} from '../shared.js'; import {again} from '../reexport.js'; import {readA} from '../cycle-a.js';
          moduleOrder.push('entry'); moduleStates.push(document.readyState); bump(); await new Promise(resolve => setTimeout(resolve, 15));
          const namespace = await import('../shared.js'); moduleOrder.push('after'); moduleStates.push(document.readyState);
          globalThis.comparison = {order:moduleOrder.join(','),readyStates:moduleStates.join(','),live:count === 2,identity:namespace.default === value && again === value,
            once:sharedLoads === 1,namespace:Object.getPrototypeOf(namespace) === null,cycle:readA() === 'ab',
            redirectedMeta:import.meta.url.endsWith('/module-assets/${variant}/nested/entry.js'),inlineMeta:inlineMetaCorrect,
            value:value.value === ${variant},legacy:typeof legacyRan === 'undefined'}; finishModule(globalThis.comparison);`,
      };
      const source = sources[asset ?? ""];
      return source === undefined
        ? new Response("Not found", { status: 404 })
        : new Response(source, { headers: { "content-type": "text/javascript; charset=utf-8" } });
    }
    if (path.startsWith("/timers/")) {
      const variant = Number(path.slice(8));
      if (!Number.isInteger(variant) || variant < 0 || variant >= 64)
        return new Response("Not found", { status: 404 });
      return new Response(
        `<title>Timers ${variant}</title><script>globalThis.comparisonPromise = ${timerExpressionFor(variant)}.then(value => globalThis.comparison = value);</script>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    if (path.startsWith("/script/"))
      return new Response("document.title += ' loaded';", {
        headers: { "content-type": "text/javascript" },
      });
    if (path.startsWith("/events/")) {
      const variant = Number(path.slice(8));
      if (!Number.isInteger(variant) || variant < 0 || variant >= 64)
        return new Response("Not found", { status: 404 });
      return new Response(
        `<title>Events ${variant}</title><main id="event-root"><button id="event-child">Target ${variant}</button></main><script>try {globalThis.comparison = ${eventExpressionFor(variant)};} catch(error) {globalThis.comparison = {exception:error.name,message:error.message};}</script>`,
        {
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      );
    }
    if (path.startsWith("/collections/")) {
      const variant = Number(path.slice(13));
      if (!Number.isInteger(variant) || variant < 0 || variant >= 64)
        return new Response("Not found", { status: 404 });
      return new Response(
        `<title>Collections ${variant}</title><script>try { globalThis.comparison = ${collectionExpressionFor(variant)}; } catch (error) { globalThis.comparison = {exception: error.name, message: error.message}; }</script>`,
        {
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      );
    }
    if (path.startsWith("/tree/")) {
      const variant = Number(path.slice(6));
      if (!Number.isInteger(variant) || variant < 0 || variant >= 64)
        return new Response("Not found", { status: 404 });
      return new Response(
        `<!doctype html><title>Tree ${variant}</title><script>try { globalThis.comparison = ${treeExpressionFor(variant)}; } catch (error) { globalThis.comparison = {exception: error.name, message: error.message, stage: globalThis.treeStage}; }</script>`,
        {
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      );
    }
    const variant = Number(path.slice(1));
    if (!Number.isInteger(variant) || variant < 0 || variant >= 64)
      return new Response("Not found", { status: 404 });
    return new Response(
      `<title>Document ${variant}</title><main id="root"><section class="group" data-id="${variant}"> leading <!--before--><i class="item" data-state="old">α &amp; ${variant}</i> <!--between--><i class="item">second</i> <!--after--></section><i class="item">outside</i></main><script src="/script/${variant}"></script><script>${expressionFor(variant)}.then(value => globalThis.comparison = value);</script>`,
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
  },
});

const worker = new Miniflare({
  modules: [
    { type: "ESModule", path: join(import.meta.dir, "../dist/worker/index.js") },
    { type: "CompiledWasm", path: join(import.meta.dir, "../dist/worker/nimbo_engine_bg.wasm") },
  ],
  compatibilityDate: "2026-07-30",
  bindings: { API_TOKEN: "test-secret" },
});

beforeAll(async () => {
  await worker.ready;
});

afterAll(async () => {
  await worker.dispose();
  await origin.stop(true);
});

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: selectors, ancestry, mutations and POST variant %i",
  async (variant) => {
    const url = new URL(String(variant), origin.url).href;

    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "globalThis.comparison" }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    const expected = {
      title: `Document ${variant} loaded`,
      before: `α & ${variant}`,
      self: true,
      ancestor: true,
      matches: true,
      missing: null,
      parent: true,
      children: true,
      siblings: true,
      connected: true,
      rootParent: null,
      removed: true,
      changed: true,
      detached: true,
      after: "second",
      restored: true,
      text: `α & ${variant}`,
      nodeChecks: {
        parsedNodes: true,
        hierarchy: true,
        documentNode: true,
        constructed: true,
        fresh: true,
        appended: true,
        mutated: true,
        elementValue: true,
        textDetached: true,
        cycleSafe: true,
      },
      count: 3,
      echo: { method: "POST", body: `payload-${variant}-α` },
    };
    expect(result).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: expected,
    });
    if (comparisonBinary) {
      const baseline = await comparePage(comparisonBinary, url);
      // Pinned v0.2.3 has two observed DOM defects; Nimbo must still pass
      // the standards-based expectations above, rather than inherit them.
      expect(baseline).toEqual({
        ...expected,
        nodeChecks: { ...expected.nodeChecks, documentNode: false, mutated: false },
      });
    }
    expect(requests).toContain(`GET /${variant}`);
    expect(requests).toContain("POST /echo");
    expect(requests).toContain(`GET /script/${variant}`);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: fragment transfer and atomic tree mutation variant %i",
  async (variant) => {
    const url = new URL(`tree/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "globalThis.comparison" }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    expect(result).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: {
        documentType: true,
        fragmentState: true,
        inserted: true,
        noops: true,
        replaced: true,
        moved: true,
        same: true,
        removed: true,
        errors: [
          "NotFoundError",
          "NotFoundError",
          "NotFoundError",
          "HierarchyRequestError",
          "HierarchyRequestError",
          "HierarchyRequestError",
          "HierarchyRequestError",
          "HierarchyRequestError",
          "HierarchyRequestError",
          "HierarchyRequestError",
        ],
        atomic: true,
        fragmentAtomic: true,
        fragmentText: true,
        emptyText: true,
        emptyElement: true,
        documentReplace: true,
      },
    });
    if (comparisonBinary) {
      // The pinned comparator aborts at this valid insertion. Nimbo must
      // complete the entire standards-based fixture above.
      expect(await comparePage(comparisonBinary, url)).toEqual({
        exception: "HierarchyRequestError",
        message:
          "Failed to execute 'appendChild' on 'Node': The new child would create an invalid tree.",
        stage: "append-text-to-fragment",
      });
    }
    expect(requests).toContain(`GET /tree/${variant}`);
  },
);

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
    expect(result).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: {
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
      },
    });
    if (comparisonBinary) {
      // Record the pinned release's actual collection behavior separately;
      // Nimbo must pass every standards-based expectation above.
      expect(await comparePage(comparisonBinary, url)).toEqual({
        kinds: false,
        identity: false,
        index: true,
        names: true,
        reflection: false,
        readonly: false,
        iteration: false,
        callback: true,
        live: false,
        removed: false,
        renamed: false,
        reparent: false,
        cleared: false,
        fragmentLive: false,
        transferred: false,
        guarded: false,
      });
    }
    expect(requests).toContain(`GET /collections/${variant}`);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: DOM event dispatch and abortable listeners variant %i",
  async (variant) => {
    const url = new URL(`events/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "globalThis.comparison" }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    expect(result).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: {
        phases: true,
        reset: true,
        captures: true,
        duplicates: true,
        once: true,
        propagation: true,
        immediate: true,
        cancellation: true,
        uncancelable: true,
        passive: true,
        defaultPolicy: true,
        mutated: true,
        object: true,
        reentry: true,
        errors: true,
        abort: true,
        preAbort: true,
        pathStable: true,
        guarded: true,
        lifecycle: ["document:interactive:2", "window:interactive:3", "load:complete:2"],
        lifecycleTrusted: true,
      },
    });
    expect(requests).toContain(`GET /events/${variant}`);
    if (comparisonBinary) {
      const baseline = await comparePage(comparisonBinary, url);
      // The pinned baseline produced both values in repeated real runs.
      // Nimbo's phase order above remains a strict requirement.
      const phases: unknown =
        typeof baseline === "object" && baseline !== null
          ? Reflect.get(baseline, "phases")
          : undefined;
      expect(typeof phases).toBe("boolean");
      expect(baseline).toEqual({
        phases,
        reset: false,
        captures: true,
        duplicates: true,
        once: true,
        propagation: true,
        immediate: true,
        cancellation: true,
        uncancelable: true,
        passive: false,
        defaultPolicy: false,
        mutated: true,
        object: true,
        reentry: true,
        errors: false,
        abort: false,
        preAbort: true,
        pathStable: true,
        guarded: false,
        lifecycle: ["document:interactive:2", "window:interactive:2", "load:complete:2"],
        lifecycleTrusted: false,
      });
    }
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: real-clock timers and microtasks variant %i",
  async (variant) => {
    const url = new URL(`timers/${variant}`, origin.url).href;
    const started = performance.now();
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "globalThis.comparisonPromise" }),
    });
    expect(response.status).toBe(200);
    expect(performance.now() - started).toBeGreaterThanOrEqual(30);
    expect(await response.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: {
        order: "micro,promise,a,a-micro,b,c",
        context: true,
        canceled: true,
        interval: true,
        coercion: true,
        nested: true,
        errors: true,
        string: true,
        guarded: true,
        ids: true,
        fetched: true,
      },
    });
    expect(requests).toContain(`GET /timers/${variant}`);
    expect(requests).toContain("POST /echo");
    if (comparisonBinary) {
      expect(await comparePage(comparisonBinary, url)).toEqual({
        order: "micro,promise,a,a-micro,b,c",
        context: true,
        canceled: true,
        interval: false,
        coercion: true,
        nested: true,
        errors: false,
        string: true,
        guarded: false,
        ids: true,
        fetched: true,
      });
    }
  },
);

test("real HTTP → workerd → Wasm: timer deadline releases page capacity", async () => {
  const started = performance.now();
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url: new URL("tree/0", origin.url).href,
      expression: "new Promise(resolve => setTimeout(resolve, 60000))",
    }),
  });
  expect(response.status).toBe(504);
  expect(performance.now() - started).toBeGreaterThanOrEqual(9000);
  expect(await response.json()).toEqual({ error: "scrape deadline or invalid input" });
  const recovered = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url: new URL("timers/63", origin.url).href,
      expression: "globalThis.comparisonPromise.then(value => value.fetched)",
    }),
  });
  expect(recovered.status).toBe(200);
  expect(await recovered.json()).toEqual({
    url: new URL("timers/63", origin.url).href,
    engine: "rust-wasm-quickjs",
    value: true,
  });
}, 20000);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native module graphs and live bindings variant %i",
  async (variant) => {
    const url = new URL(`modules/${variant}`, origin.url).href;
    const before = requests.length;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "globalThis.moduleDone" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: {
        order: "classic,entry,defer,inline,dcl,after",
        readyStates: "interactive,interactive,interactive,complete",
        live: true,
        identity: true,
        once: true,
        namespace: true,
        cycle: true,
        redirectedMeta: true,
        inlineMeta: true,
        value: true,
        legacy: true,
      },
    });
    const observed = requests.slice(before);
    for (const asset of [
      "shared.js",
      "reexport.js",
      "cycle-a.js",
      "cycle-b.js",
      "nested/entry.js",
      "defer.js",
    ])
      expect(
        observed.filter((request) => request === `GET /module-assets/${variant}/${asset}`).length,
      ).toBe(1);
    expect(observed).toContain(`GET /module-assets/${variant}/redirect.js`);
    if (comparisonBinary) expect(await comparePage(comparisonBinary, url)).toBeNull();
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: module graph failures remain explicit variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`module-failures/${variant}`, origin.url).href,
        expression: "'must not succeed'",
      }),
    });
    expect(response.status).toBe(422);
    const result: unknown = await response.json();
    const error: unknown =
      typeof result === "object" && result !== null ? Reflect.get(result, "error") : undefined;
    expect(typeof error).toBe("string");
    const expected = [
      /variable name expected/,
      /bare module specifier/,
      /origin policy/,
      /import attributes/,
      /module requires JavaScript MIME/,
      /404/,
      /export/,
      /module rejected/,
    ][variant % 8];
    if (!expected) throw new Error("missing failure expectation");
    expect(error).toMatch(expected);
  },
);
