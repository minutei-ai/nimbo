import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { TextDecoder as ReferenceTextDecoder } from "node:util";
import { Miniflare } from "miniflare";

const storageScript = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/storage.txt"),
).text();
const mediaScript = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/media.txt"),
).text();
const tokenScript = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/tokens.txt"),
).text();
const htmlElementScript = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/html-elements.txt"),
).text();
const customElementScript = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/custom-elements.txt"),
).text();
const encodingScript = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/encoding.txt"),
).text();
const anchorScript = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/anchors.txt"),
).text();
const styleScript = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/styles.txt"),
).text();
const styleVariableScript = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/style-variables.txt"),
).text();
const geometryScript = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/geometry.txt"),
).text();
const cascadeScript = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/cascade.txt"),
).text();
const variablesScript = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/variables.txt"),
).text();
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
    if (path.startsWith("/variables/")) {
      const variant = Number(path.split("/").at(-1));
      return new Response(`<script>globalThis.variant=${variant};${variablesScript}</script>`, {
        headers: { "content-type": "text/html" },
      });
    }
    if (path.startsWith("/cascade/")) {
      const variant = Number(path.split("/").at(-1));
      return new Response(`<script>globalThis.variant=${variant};${cascadeScript}</script>`, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (path.startsWith("/geometry/")) {
      const variant = Number(path.split("/").at(-1));
      return new Response(`<script>globalThis.variant=${variant};${geometryScript}</script>`, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (path === "/geometry-empty") {
      return new Response("<!doctype html><html><head></head><body></body></html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (path.startsWith("/style-variables/")) {
      const variant = Number(path.split("/").at(-1));
      return new Response(`<script>globalThis.variant=${variant};${styleVariableScript}</script>`, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (path.startsWith("/styles/")) {
      const variant = Number(path.split("/").at(-1));
      return new Response(`<script>globalThis.variant=${variant};${styleScript}</script>`, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (path.startsWith("/anchors/")) {
      const variant = Number(path.split("/").at(-1));
      return new Response(
        `<base href="https://example.com/root/"><a id="link" href="../doc?q=1#fragment">link</a><svg><a></a></svg><script>globalThis.variant=${variant};${anchorScript}</script>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    if (path.startsWith("/base-origin/")) {
      const mode = path.split("/").at(-1);
      const script =
        mode === "classic"
          ? '<script src="blocked.js"></script>'
          : '<script type="module">import "./blocked.js";</script>';
      return new Response(`<base href="https://external.example.com/">${script}`, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (path.startsWith("/base-url/")) {
      const variant = Number(path.split("/").at(-1));
      return new Response(
        `<base href="/base-assets/${variant}/"><script src="classic.js"></script><script type="module">import {value} from './module.js'; globalThis.baseModule=value;</script><script>globalThis.baseFetch=fetch('data').then(response=>response.text());</script>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    if (path.startsWith("/base-assets/")) {
      const variant = Number(path.split("/").at(-2));
      const file = path.split("/").at(-1);
      if (file === "classic.js")
        return new Response(`globalThis.baseClassic=${variant}`, {
          headers: { "content-type": "text/javascript" },
        });
      if (file === "module.js")
        return new Response(`export const value=${variant}`, {
          headers: { "content-type": "text/javascript" },
        });
      if (file === "data") return new Response(`base-${variant}`);
    }
    if (path.startsWith("/encoding/")) {
      const variant = Number(path.split("/").at(-1));
      return new Response(`<script>globalThis.variant=${variant};${encodingScript}</script>`, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (path === "/custom-elements-empty")
      return new Response("<title>Empty registry</title>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    if (path.startsWith("/custom-elements/")) {
      const variant = Number(path.split("/").at(-1));
      return new Response(
        `<x-root></x-root><x-parsed data-native="source"></x-parsed><script>globalThis.variant=${variant};${customElementScript}</script>`,
        {
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      );
    }
    if (path.startsWith("/html-elements/")) {
      const variant = Number(path.split("/").at(-1));
      return new Response(
        `<main></main><svg><linearGradient></linearGradient><foreignObject><div></div></foreignObject></svg><math><mi>x</mi></math><script>globalThis.variant=${variant};${htmlElementScript}</script>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    if (path.startsWith("/tokens/"))
      return new Response(`<title>Tokens</title><script>${tokenScript}</script>`, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    if (path.startsWith("/media/"))
      return new Response(`<title>Media</title><script>${mediaScript}</script>`, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    if (path.startsWith("/storage/")) {
      const variant = Number(path.slice(9));
      return new Response(
        `<title>Storage ${variant}</title><script>${storageScript}</script><script src="/storage-external.js"></script><script type="module">comparison.module = localStorage.persist === document.title && sessionStorage.persist === document.title;</script>`,
        {
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      );
    }
    if (path === "/storage-external.js")
      return new Response(
        "comparison.external = localStorage.persist === document.title && sessionStorage.persist === document.title;",
        {
          headers: { "content-type": "text/javascript" },
        },
      );
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

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native Web Storage and request isolation variant %i",
  async (variant) => {
    const url = new URL(`storage/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "globalThis.comparison" }),
    });
    expect(response.status).toBe(200);
    const expected = Object.fromEntries(
      [
        "empty",
        "identity",
        "brand",
        "areas",
        "coercion",
        "unicode",
        "emptyString",
        "reflection",
        "replacement",
        "keys",
        "reserved",
        "hiddenDelete",
        "symbolProperty",
        "defined",
        "removal",
        "guards",
        "extensible",
        "clear",
        "external",
        "module",
      ].map((key) => [key, true]),
    );
    expect(await response.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: expected });
    // The pinned comparator does not produce a completed value for this fixture.
    // Keep Nimbo's standards-based assertions above independent of that failure.
    if (comparisonBinary) expect(await comparePage(comparisonBinary, url)).toBeNull();
    expect(requests).toContain(`GET /storage/${variant}`);
    expect(requests).toContain("GET /storage-external.js");
  },
);

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

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native media queries and explicit preferences variant %i",
  async (variant) => {
    const url = new URL(`media/${variant}`, origin.url).href;
    const media = {
      width: 800 + variant,
      height: 600 + (variant % 2) * 300,
      colorScheme: variant % 2 === 0 ? "dark" : "light",
      reducedMotion: variant % 3 === 0,
    };
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, media, expression: "comparison" }),
    });
    expect(response.status).toBe(200);
    const expected = Object.fromEntries(
      [
        "identity",
        "serialized",
        "sizes",
        "ranges",
        "negative",
        "orientation",
        "ratio",
        "logical",
        "unknown",
        "types",
        "malformed",
        "escaped",
        "empty",
        "input",
        "events",
        "guards",
      ].map((key) => [key, true]),
    );
    expect(await response.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: {
        ...expected,
        width: media.width,
        height: media.height,
        dark: media.colorScheme === "dark",
        reduced: media.reducedMotion,
      },
    });
    // The pinned comparator does not produce a completed value for this fixture.
    if (comparisonBinary) expect(await comparePage(comparisonBinary, url)).toBeNull();
    expect(requests).toContain(`GET /media/${variant}`);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd: invalid media environments are rejected before navigation variant %i",
  async (variant) => {
    const invalid = [
      { width: 0 },
      { height: 0 },
      { width: 16385 },
      { height: 16385 },
      { width: 1.5 },
      { height: "600" },
      { colorScheme: "invalid" },
      { reducedMotion: 1 },
    ][variant % 8];
    const url = new URL(`media/invalid-${variant}`, origin.url).href;
    const before = requests.length;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, media: invalid, expression: "1" }),
    });
    expect(response.status).toBe(400);
    expect(requests.slice(before)).not.toContain(`GET /media/invalid-${variant}`);
  },
);

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

test("real HTTP → workerd → Wasm: registry quotas and fresh request recovery", async () => {
  const url = new URL("custom-elements-empty", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression: `(async () => {
      for (let i=0;i<1024;i++) customElements.define('x-limit-'+i,class extends HTMLElement{});
      let definitionLimit=false;
      try {customElements.define('x-overflow',class extends HTMLElement{})} catch(error) {definitionLimit=error.message==='custom element definition limit'}
      for (let i=0;i<1024;i++) customElements.whenDefined('x-pending-'+i);
      let promiseLimit=false;
      try {await customElements.whenDefined('x-pending-overflow')} catch(error) {promiseLimit=error.message==='when-defined promise limit'}
      return [definitionLimit,promiseLimit,customElements.get('x-overflow')===undefined];
    })()`,
    }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    url,
    engine: "rust-wasm-quickjs",
    value: [true, true, true],
  });
  const recovery = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression:
        "[customElements.get('x-limit-0')===undefined,typeof nimboDom,customElements instanceof CustomElementRegistry]",
    }),
  });
  expect(recovery.status).toBe(200);
  expect(await recovery.json()).toEqual({
    url,
    engine: "rust-wasm-quickjs",
    value: [true, "undefined", true],
  });
});

const encodingExpected = Object.fromEntries(
  [
    "unicode",
    "defaults",
    "into",
    "malformed",
    "streaming",
    "boms",
    "recovery",
    "queued",
    "views",
    "utf16",
    "legacy",
    "guards",
    "coercion",
    "identity",
  ].map((key) => [key, true]),
);
test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native encoding Unicode and codec variant %i",
  async (variant) => {
    const url = new URL(`encoding/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "comparison" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: encodingExpected,
    });
    expect(requests).toContain(`GET /encoding/${variant}`);
    if (comparisonBinary) {
      expect(await comparePage(comparisonBinary, url)).toEqual({
        ...Object.fromEntries(Object.keys(encodingExpected).map((key) => [key, false])),
        views: true,
        utf16: true,
        coercion: true,
      });
    }
  },
);

test("real HTTP → workerd → Wasm: encoding input and live decoder budgets recover across requests", async () => {
  const url = new URL("custom-elements-empty", origin.url).href;
  const expression = `(() => {
    const fails = fn => {try {fn();return false;} catch(error) {return error.message.includes('limit');}};
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const input = fails(() => encoder.encode('x'.repeat(65537))) && fails(() => decoder.decode(new Uint8Array(65537)));
    const boundary = encoder.encode('x'.repeat(65536)).length === 65536 && decoder.decode(new Uint8Array(65536)).length === 65536;
    const live = [decoder];
    while(live.length < 128) live.push(new TextDecoder());
    const capacity = fails(() => new TextDecoder());
    return {input,boundary,capacity,reusable:decoder.decode(new Uint8Array([65])) === 'A'};
  })()`;
  for (let iteration = 0; iteration < 3; iteration++) {
    // The Worker allows one active page; repeat failures and reuse sequentially.
    // oxlint-disable-next-line no-await-in-loop
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression }),
    });
    expect(response.status).toBe(200);
    // Read this response before starting the next page.
    // oxlint-disable-next-line no-await-in-loop
    expect(await response.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: { input: true, boundary: true, capacity: true, reusable: true },
    });
  }
});

function codecResults(label: string, fatal: boolean, chunks: number[][]): string[] {
  const decoder = new ReferenceTextDecoder(label, { fatal });
  const results: string[] = [];
  for (const [index, chunk] of [...chunks, []].entries()) {
    try {
      results.push(decoder.decode(new Uint8Array(chunk), { stream: index < chunks.length }));
    } catch (error) {
      results.push(error instanceof Error ? `error:${error.name}` : "error:unknown");
      // Bun discards the remaining queue after a fatal error. Its result is an
      // oracle only until that error; spec-based continuation is tested separately.
      break;
    }
  }
  return results;
}
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

const anchorExpected = Object.fromEntries(
  [
    "identity",
    "defaults",
    "parsed",
    "relative",
    "unicode",
    "components",
    "host",
    "invalidSetters",
    "emptyParts",
    "clearing",
    "opaque",
    "invalid",
    "attributes",
    "policies",
    "unknownPolicy",
    "text",
    "rel",
    "forwarded",
    "guards",
    "bases",
  ].map((key) => [key, true]),
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

const linkParts = [
  "href",
  "origin",
  "protocol",
  "username",
  "password",
  "host",
  "hostname",
  "port",
  "pathname",
  "search",
  "hash",
] as const;
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

test("real HTTP → workerd → Wasm: link parser limits and failed requests release page state", async () => {
  const url = new URL("custom-elements-empty", origin.url).href;
  const expression =
    "(() => {const a=document.createElement('a');a.href='https://example.com/'+'x'.repeat(65536);return a.href;})()";
  const failed = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(failed.status).toBe(422);
  const limitMessage: unknown = expect.stringMatching(
    /^JavaScript: Error: URL input limit(?:\n|$)/,
  );
  expect(await failed.json()).toEqual({ error: limitMessage });
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression:
        "[document.createElement('a').href,document.baseURI === document.URL,typeof nimboLink]",
    }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    url,
    engine: "rust-wasm-quickjs",
    value: ["", true, "undefined"],
  });
});

test.each(["classic", "module"])(
  "real HTTP → workerd → Wasm: cross-origin base cannot authorize %s requests",
  async (mode) => {
    const url = new URL(`base-origin/${mode}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "document.URL" }),
    });
    expect(response.status).toBe(422);
    const result: unknown = await response.json();
    expect(JSON.stringify(result)).toContain("origin policy");
    expect(requests).toContain(`GET /base-origin/${mode}`);
  },
);

const stylesExpected = Object.fromEntries(
  [
    "identity",
    "empty",
    "mutations",
    "external",
    "invalid",
    "overridePriority",
    "shorthand",
    "longhand",
    "mixedPriority",
    "removed",
    "custom",
    "emptyRemoval",
    "indexed",
    "coercion",
    "textCoercion",
    "internal",
    "forwarded",
    "guarded",
    "reactions",
    "removal",
  ].map((key) => [key, true]),
);
test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native inline declarations and live CSS styles variant %i",
  async (variant) => {
    const url = new URL(`styles/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "comparison" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: stylesExpected,
    });
    expect(requests).toContain(`GET /styles/${variant}`);
  },
);

test.each(["value", "attribute", "entries"])(
  "real HTTP → workerd → Wasm: CSS %s limits release page state",
  async (mode) => {
    const url = new URL("styles/0", origin.url).href;
    const expression =
      mode === "value"
        ? "document.createElement('div').style.setProperty('--large','x'.repeat(65537))"
        : mode === "attribute"
          ? "(()=>{const el=document.createElement('div');el.setAttribute('style','x'.repeat(65537));return el.style.length;})()"
          : "document.createElement('div').style.cssText=Array.from({length:1025},(_,i)=>'--n'+i+': x').join(';')";
    const failed = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression }),
    });
    expect(failed.status).toBe(422);
    const message: unknown = expect.stringMatching(
      /^JavaScript: Error: (?:DOM: )?CSS (?:input|declaration) limit(?:\n|$)/,
    );
    expect(await failed.json()).toEqual({ error: message });
    const recovered = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url,
        expression: "[document.createElement('div').style.length, typeof nimboStyle]",
      }),
    });
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: [0, "undefined"],
    });
  },
);

const styleVariablesExpected = Object.fromEntries(
  [
    "specified",
    "deferredGrammar",
    "validGrammar",
    "invalidGrammar",
    "embeddedPriority",
    "customCase",
    "customEdges",
    "customInterior",
    "nonAsciiWhitespace",
    "emptyCustom",
    "emptySpecified",
    "emptyRemoval",
    "wide",
    "invalidCustom",
    "pending",
    "partial",
    "retained",
    "removedPending",
    "externalSame",
    "externalReset",
    "important",
    "mixed",
    "environment",
    "longhandVariable",
    "failed",
    "reaction",
    "reset",
  ].map((key) => [key, true]),
);
test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native variable values and pending CSS shorthands variant %i",
  async (variant) => {
    const url = new URL(`style-variables/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "comparison" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: styleVariablesExpected,
    });
    expect(requests).toContain(`GET /style-variables/${variant}`);
  },
);

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

test("real HTTP → workerd → Wasm: cssText recovers from an oversized external attribute", async () => {
  const url = new URL("styles/0", origin.url).href;
  const expression = `(() => {
    const el=document.createElement('div');const style=el.style;
    el.setAttribute('style','x'.repeat(65537));let limited=false;
    try {style.length;} catch(error){limited=error.message.includes('CSS input limit');}
    style.cssText='width: 8px';
    return {limited,identity:style===el.style,value:style.width,attribute:el.getAttribute('style'),length:style.length};
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
    value: { limited: true, identity: true, value: "8px", attribute: "width: 8px;", length: 1 },
  });
});

const geometryExpected = Object.fromEntries(
  [
    "initial",
    "live",
    "hidden",
    "relative",
    "detached",
    "wrapping",
    "gridAuto",
    "edges",
    "mutable",
    "dictionary",
    "readonly",
    "brand",
    "json",
    "numeric",
    "nan",
    "nativeJSON",
    "descriptor",
  ].map((key) => [key, true]),
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

test.each([
  ["text shaping", "el.textContent='real text';"],
  [
    "stylesheet at-rule",
    "const css=document.createElement('style');css.textContent='@supports (display: grid) {div {width: 50px;}}';document.body.appendChild(css);",
  ],
  [
    "external stylesheet",
    "const css=document.createElement('link');css.setAttribute('rel','stylesheet');document.body.appendChild(css);",
  ],
  ["transform", "el.style.transform='translateX(10px)';"],
  ["environment substitution", "el.style.width='env(safe-area-inset-left, 10px)';"],
  ["position", "el.style.position='absolute';"],
  ["element formatting", "const child=document.createElement('span');el.appendChild(child);"],
  ["width", "el.style.width='2em';"],
])(
  "real HTTP → workerd → Wasm: geometry rejects %s without fictional values",
  async (reason, setup) => {
    const url = new URL("geometry-empty", origin.url).href;
    const expression = `(() => {const el=document.createElement('div');document.body.appendChild(el);${setup}return el.getBoundingClientRect();})()`;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression }),
    });
    expect(response.status).toBe(422);
    const message: unknown = expect.stringContaining(`layout unsupported: ${reason}`);
    expect(await response.json()).toEqual({ error: message });
    const recovered = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url,
        expression: "document.createElement('div').getBoundingClientRect().toJSON()",
      }),
    });
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 },
    });
  },
);

test.each(["nodes", "depth"])(
  "real HTTP → workerd → Wasm: geometry %s budget is bounded and recoverable",
  async (mode) => {
    const url = new URL("geometry-empty", origin.url).href;
    const expression = `(() => {const root=document.createElement('div');document.body.appendChild(root);let parent=root;for(let i=0;i<${mode === "nodes" ? 1030 : 130};i++){const el=document.createElement('div');parent.appendChild(el);${mode === "depth" ? "parent=el;" : ""}}return root.getBoundingClientRect();})()`;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression }),
    });
    expect(response.status).toBe(422);
    const message: unknown = expect.stringContaining("resource limit: layout tree");
    expect(await response.json()).toEqual({ error: message });
    const recovered = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "document.body.getBoundingClientRect().width > 0" }),
    });
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: true });
  },
);

test("real HTTP → workerd → Wasm: geometry charges the shared DOM operation budget", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const expression =
    "(() => {const root=document.createElement('div');document.body.appendChild(root);for(let i=0;i<30;i++){root.appendChild(document.createElement('div'));}for(let i=0;i<500;i++){root.getBoundingClientRect();}return false;})()";
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

const cascadeExpected = Object.fromEntries(
  [
    "specificity",
    "inline",
    "important",
    "inlineImportant",
    "order",
    "sheets",
    "movedSheet",
    "matchingList",
    "isSpecificity",
    "whereSpecificity",
    "notSpecificity",
    "combinator",
    "attributes",
    "invalid",
    "declarationPriority",
    "shorthand",
    "mediaGroup",
    "mediaGroupOff",
    "mediaOff",
    "mediaOn",
    "typeOff",
    "typeOn",
    "removal",
    "noRule",
  ].map((key) => [key, true]),
);
test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native author stylesheet cascade variant %i",
  async (variant) => {
    const url = new URL(`cascade/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "comparison" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: cascadeExpected,
    });
    expect(requests).toContain(`GET /cascade/${variant}`);
  },
);

test.each([
  ["bytes", "'x'.repeat(65537)", "resource limit: stylesheet bytes"],
  [
    "selectors",
    "Array.from({length:65},(_,i)=>'.x'+i).join(',')+'{width:1px}'",
    "layout unsupported: stylesheet selectors",
  ],
  [
    "rules",
    "Array.from({length:1025},(_,i)=>'.x'+i+'{width:1px}').join('')",
    "resource limit: stylesheet rules",
  ],
  [
    "nesting",
    "':is('.repeat(34)+'.x'+')'.repeat(34)+'{width:1px}'",
    "resource limit: stylesheet nesting",
  ],
  ["nested rule", "'div { & div {width:1px;} }'", "layout unsupported: nested stylesheet rule"],
  ["layer", "'@layer test {div {width:1px;}}'", "layout unsupported: stylesheet at-rule"],
  [
    "forgiving recovery",
    "':is(.x, :bogus#never) {width:1px;}'",
    "layout unsupported: forgiving selector recovery",
  ],
])(
  "real HTTP → workerd → Wasm: stylesheet %s fails explicitly and releases the request",
  async (_name, source, reason) => {
    const url = new URL("geometry-empty", origin.url).href;
    const expression = `(() => {const css=document.createElement('style');css.textContent=${source};document.body.appendChild(css);return document.body.getBoundingClientRect();})()`;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression }),
    });
    expect(response.status).toBe(422);
    const message: unknown = expect.stringContaining(reason);
    expect(await response.json()).toEqual({ error: message });
    const recovered = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "document.body.getBoundingClientRect().width > 0" }),
    });
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: true });
  },
);

test.each([
  [
    "expanded declarations",
    "for(let i=0;i<2;i++){const css=document.createElement('style');css.textContent='*{'+Array.from({length:600},(_,j)=>'--x_'+i+'_'+j+':1;').join('')+'}';document.body.appendChild(css);}",
    "CSS declaration limit",
  ],
  [
    "total bytes",
    "for(let i=0;i<5;i++){const css=document.createElement('style');css.textContent='/*'+'x'.repeat(59996)+'*/';document.body.appendChild(css);}",
    "resource limit: stylesheet total bytes",
  ],
  [
    "total selectors",
    "for(let i=0;i<17;i++){const css=document.createElement('style');css.textContent=Array.from({length:64},(_,j)=>'.x'+i+'_'+j).join(',')+'{width:1px}';document.body.appendChild(css);}",
    "resource limit: stylesheet selectors",
  ],
])(
  "real HTTP → workerd → Wasm: stylesheet %s quota is shared across sheets",
  async (_name, setup, reason) => {
    const url = new URL("geometry-empty", origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url,
        expression: `(() => {${setup}return document.body.getBoundingClientRect();})()`,
      }),
    });
    expect(response.status).toBe(422);
    const message: unknown = expect.stringContaining(reason);
    expect(await response.json()).toEqual({ error: message });
    const recovered = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "document.body.getBoundingClientRect().width > 0" }),
    });
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: true });
  },
);

test("real HTTP → workerd → Wasm: failed stylesheet parsing preserves inline state and permits page reuse", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const expression = `(() => {
    document.body.style.margin='0';const el=document.createElement('div');el.id='target';el.style.cssText='width:10px;height:5px';document.body.appendChild(el);
    const css=document.createElement('style');css.textContent='#target {width:50px !important;}';document.body.appendChild(css);
    const snapshot=el.getBoundingClientRect();const invalid=document.createElement('style');invalid.textContent='x'.repeat(65537);document.body.appendChild(invalid);
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

const variablesExpected = Object.fromEntries(
  [
    "local",
    "specified",
    "inherited",
    "parentMutation",
    "parentRemoval",
    "computedInheritance",
    "inheritKeyword",
    "unsetKeyword",
    "initialKeyword",
    "nestedFallback",
    "chain",
    "caseSensitive",
    "functionCase",
    "escapedName",
    "unusedFallback",
    "selfCycle",
    "mutualCycle",
    "fallbackCycle",
    "overlappingCycle",
    "downstreamFallback",
    "invalidOverrides",
    "invalidGrammar",
    "tokenBoundary",
    "emptyValue",
    "emptyFallback",
    "pendingShorthand",
    "shorthandOrder",
    "invalidShorthand",
    "customPriority",
    "inlineVariable",
    "inlineSpecified",
    "live",
    "inlineAfterRemoval",
    "noVariable",
  ].map((key) => [key, true]),
);
test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native custom property resolution variant %i",
  async (variant) => {
    const url = new URL(`variables/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "comparison" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: variablesExpected,
    });
    expect(requests).toContain(`GET /variables/${variant}`);
  },
);

test.each([
  [
    "chain",
    "const css=document.createElement('style');css.textContent='#target {'+Array.from({length:140},(_,i)=>'--p'+String(i).padStart(3,'0')+':'+(i===139?'1px':'var(--p'+String(i+1).padStart(3,'0')+')')+';').join('')+'width:var(--p000)}';document.body.appendChild(css);el.id='target';",
    "CSS variable chain",
  ],
  [
    "inherited entries",
    "for(let depth=0;depth<2;depth++){const child=document.createElement('div');el.appendChild(child);el=child;el.style.cssText=Array.from({length:600},(_,i)=>'--p'+depth+'-'+i+':1px;').join('');}",
    "CSS computed variables",
  ],
  [
    "inherited bytes",
    "for(let depth=0;depth<5;depth++){const child=document.createElement('div');el.appendChild(child);el=child;el.style.setProperty('--p'+depth,'x'.repeat(60000));}",
    "CSS computed variable bytes",
  ],
])(
  "real HTTP → workerd → Wasm: native variable %s limit fails and later requests recover",
  async (_name, setup, reason) => {
    const url = new URL("geometry-empty", origin.url).href;
    const expression = `(() => {let el=document.createElement('div');document.body.appendChild(el);${setup}return el.getBoundingClientRect();})()`;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression }),
    });
    expect(response.status).toBe(422);
    const error: unknown = expect.stringContaining(`resource limit: ${reason}`);
    expect(await response.json()).toEqual({ error });
    const recovered = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url,
        expression:
          "(() => {const el=document.createElement('div');el.style.cssText='--w:41px;width:var(--w);';document.body.appendChild(el);return el.getBoundingClientRect().width===41;})()",
      }),
    });
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: true });
  },
);

test("real HTTP → workerd → Wasm: exponential variable substitution becomes invalid and uses fallback", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const expression =
    "(() => {const el=document.createElement('div');el.style.cssText='--p0:1px;'+Array.from({length:24},(_,i)=>'--p'+(i+1)+':var(--p'+i+') var(--p'+i+');').join('')+'width:var(--p24,42px);';document.body.appendChild(el);return el.getBoundingClientRect().width===42;})()";
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: true });
});
