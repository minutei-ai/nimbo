import { attributeNamespacesFixture } from "./attribute-namespaces-fixture";
import { windowNamedFixture } from "./window-named-fixture";
import { documentStylesheetsFixture } from "./document-stylesheets-fixture";
import { backgroundColorFixture } from "./background-color-fixture";
import { scriptModesFixture, scriptModesExpression } from "./script-modes-fixture";
import { animationFramesFixture } from "./animation-frames-fixture";
import { layoutSnapshotFixture } from "./layout-snapshot-fixture";
import { svgViewportFixture } from "./svg-viewport-fixture";
import { resolvedBoxValuesFixture } from "./resolved-box-values-fixture";
import { contextualBoxLengthsFixture } from "./contextual-box-lengths-fixture";
import { logicalSpacingFixture } from "./logical-spacing-fixture";
import { transitionsFixture } from "./transitions-fixture";
import { zIndexFixture } from "./z-index-fixture";
import { stickyGeometryFixture } from "./sticky-geometry-fixture";
import { cookiesFixture } from "./cookies-fixture";
import { urlsFixture } from "./urls-fixture";
import { responseEncodingCases, responseEncodingFixture } from "./response-encoding-fixture";
import { namespacedElementsFixture } from "./namespaced-elements-fixture";
import { positionedBoxesFixture } from "./positioned-boxes-fixture";
import { customBoxesFixture } from "./custom-boxes-fixture";
import { largeDomFixture, largeDomExpression, linkGuardExpression } from "./large-dom-fixture";
import { adoptedSheetsFixture } from "./adopted-sheets-fixture";
import { backgroundLayersFixture } from "./background-layers-fixture";
import { fontFamilyFixture } from "./font-family-fixture";
import { displayFixture } from "./display-fixture";
import { htmlBoxesFixture } from "./html-boxes-fixture";
import { constructedSheetsFixture } from "./constructed-sheets-fixture";
import { backgroundSizeFixture } from "./background-size-fixture";
import { backgroundRepeatFixture } from "./background-repeat-fixture";
import { backgroundPositionFixture } from "./background-position-fixture";
import { backgroundImagesFixture } from "./background-images-fixture";
import { lineHeightFixture } from "./line-height-fixture";
import { tabsFixture } from "./tabs-fixture";
import { textAdjustFixture } from "./text-adjust-fixture";
import { outlineFixture } from "./outline-fixture";
import { layoutBudgetFixture } from "./layout-budget-fixture";
import { logicalSizeFixture } from "./logical-size-fixture";
import { canvasFixture } from "./canvas-fixture";
import { borderFixture } from "./border-fixture";
import { cssBudgetFixture } from "./css-budget-fixture";
import { fontFixture } from "./font-fixture";
import { binaryFixture } from "./binary-fixture";
import { externalStylePage, externalStyleResponse } from "./external-styles-fixture";
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
const insertionScript = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/node-insertion.txt"),
).text();
const intersectionScript = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/intersections.txt"),
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
    const cookies = cookiesFixture(path, request);
    if (cookies) return cookies;
    const urls = urlsFixture(path);
    if (urls) return urls;
    const encoded = responseEncodingFixture(path);
    if (encoded) return encoded;
    const namespaced = namespacedElementsFixture(path);
    if (namespaced) return namespaced;
    const scriptModes = scriptModesFixture(path);
    if (scriptModes) return scriptModes;
    const animationFrames = animationFramesFixture(path);
    if (animationFrames) return animationFrames;
    const attributeNamespaces = attributeNamespacesFixture(path);
    if (attributeNamespaces) return attributeNamespaces;
    const windowNamed = windowNamedFixture(path);
    if (windowNamed) return windowNamed;
    const documentStylesheets = documentStylesheetsFixture(path);
    if (documentStylesheets) return documentStylesheets;
    const backgroundColor = backgroundColorFixture(path);
    if (backgroundColor) return backgroundColor;
    const layoutSnapshot = layoutSnapshotFixture(path);
    if (layoutSnapshot) return layoutSnapshot;
    const svg = svgViewportFixture(path);
    if (svg) return svg;
    const resolved = resolvedBoxValuesFixture(path);
    if (resolved) return resolved;
    const contextual = contextualBoxLengthsFixture(path);
    if (contextual) return contextual;
    const logicalSpacing = logicalSpacingFixture(path);
    if (logicalSpacing) return logicalSpacing;
    const transitions = transitionsFixture(path);
    if (transitions) return transitions;
    const zIndex = zIndexFixture(path);
    if (zIndex) return zIndex;
    const stickyGeometry = stickyGeometryFixture(path);
    if (stickyGeometry) return stickyGeometry;
    const positionedBoxes = positionedBoxesFixture(path);
    if (positionedBoxes) return positionedBoxes;
    const customBoxes = customBoxesFixture(path);
    if (customBoxes) return customBoxes;
    const largeDom = largeDomFixture(path);
    if (largeDom) return largeDom;
    const adoptedSheets = await adoptedSheetsFixture(path);
    if (adoptedSheets) return adoptedSheets;
    const constructedSheets = await constructedSheetsFixture(path);
    if (constructedSheets) return constructedSheets;
    const htmlBoxes = await htmlBoxesFixture(path);
    if (htmlBoxes) return htmlBoxes;
    const display = await displayFixture(path);
    if (display) return display;
    const fontFamily = await fontFamilyFixture(path);
    if (fontFamily) return fontFamily;
    requests.push(`${request.method} ${path}`);
    const backgroundLayers = await backgroundLayersFixture(path);
    if (backgroundLayers) return backgroundLayers;
    const backgroundSize = await backgroundSizeFixture(path);
    if (backgroundSize) return backgroundSize;
    const backgroundRepeat = await backgroundRepeatFixture(path);
    if (backgroundRepeat) return backgroundRepeat;
    const backgroundPosition = await backgroundPositionFixture(path);
    if (backgroundPosition) return backgroundPosition;
    const backgroundImages = await backgroundImagesFixture(path);
    if (backgroundImages) return backgroundImages;
    const layoutBudget = layoutBudgetFixture(path);
    if (layoutBudget) return layoutBudget;
    const lineHeight = await lineHeightFixture(path);
    if (lineHeight) return lineHeight;
    const tabs = await tabsFixture(path);
    if (tabs) return tabs;
    const adjustment = await textAdjustFixture(path);
    if (adjustment) return adjustment;
    const outline = await outlineFixture(path);
    if (outline) return outline;
    const logicalSize = await logicalSizeFixture(path);
    if (logicalSize) return logicalSize;
    const canvas = await canvasFixture(path);
    if (canvas) return canvas;
    const border = await borderFixture(path);
    if (border) return border;
    const cssBudget = await cssBudgetFixture(path);
    if (cssBudget) return cssBudget;
    const font = await fontFixture(path);
    if (font) return font;
    const binary = binaryFixture(path);
    if (binary) return binary;
    if (path.startsWith("/font-cases/")) {
      const variant = Number(path.split("/").at(-1));
      const source = await Bun.file(
        join(import.meta.dir, "../crates/engine/tests/fixtures/font-data.txt"),
      ).text();
      return new Response(`<script>globalThis.variant=${variant};${source}</script>`, {
        headers: { "content-type": "text/html" },
      });
    }
    if (path.startsWith("/binary-cases/")) {
      const variant = Number(path.split("/").at(-1));
      const source = await Bun.file(
        join(import.meta.dir, "../crates/engine/tests/fixtures/binary-fetch.txt"),
      ).text();
      return new Response(`<script>globalThis.variant=${variant};${source}</script>`, {
        headers: { "content-type": "text/html" },
      });
    }
    if (path.startsWith("/dataset/")) {
      const variant = Number(path.split("/").at(-1));
      const source = await Bun.file(
        join(import.meta.dir, "../crates/engine/tests/fixtures/dataset.txt"),
      ).text();
      return new Response(`<script>globalThis.variant=${variant};${source}</script>`, {
        headers: { "content-type": "text/html" },
      });
    }
    if (path.startsWith("/dom-budget/")) {
      const variant = Number(path.split("/").at(-1));
      return new Response(
        `<title>DOM budget</title><div id="example" data-index="${variant}"></div><script>globalThis.scriptExecuted=true;</script>`,
        { headers: { "content-type": "text/html" } },
      );
    }
    if (path.startsWith("/registrations/")) {
      const variant = Number(path.split("/").at(-1));
      const source = await Bun.file(
        join(import.meta.dir, "../crates/engine/tests/fixtures/registrations.txt"),
      ).text();
      return new Response(
        `<!doctype html><body><script>globalThis.variant=${variant};${source}</script>`,
        { headers: { "content-type": "text/html" } },
      );
    }
    if (path.startsWith("/font-queries/")) {
      const variant = Number(path.split("/").at(-1));
      const source = await Bun.file(
        join(import.meta.dir, "../crates/engine/tests/fixtures/font-queries.txt"),
      ).text();
      return new Response(
        `<!doctype html><body><script>globalThis.variant=${variant};${source}</script>`,
        { headers: { "content-type": "text/html" } },
      );
    }
    if (path.startsWith("/containers/")) {
      const variant = Number(path.split("/").at(-1));
      const source = await Bun.file(
        join(import.meta.dir, "../crates/engine/tests/fixtures/containers.txt"),
      ).text();
      return new Response(
        `<!doctype html><body><script>globalThis.variant=${variant};${source}</script>`,
        { headers: { "content-type": "text/html" } },
      );
    }
    if (path.startsWith("/cascade-index/")) {
      const variant = Number(path.split("/").at(-1));
      const source = await Bun.file(
        join(import.meta.dir, "../crates/engine/tests/fixtures/cascade-index.txt"),
      ).text();
      return new Response(
        `<!doctype html><body><script>globalThis.variant=${variant};${source}</script>`,
        { headers: { "content-type": "text/html" } },
      );
    }
    if (path.startsWith("/animations/")) {
      const variant = Number(path.split("/").at(-1));
      const source = await Bun.file(
        join(import.meta.dir, "../crates/engine/tests/fixtures/animations.txt"),
      ).text();
      return new Response(
        `<!doctype html><body><script>globalThis.variant=${variant};${source}</script>`,
        { headers: { "content-type": "text/html" } },
      );
    }
    if (path.startsWith("/selector-ast/")) {
      const variant = Number(path.split("/").at(-1));
      const source = await Bun.file(
        join(import.meta.dir, "../crates/engine/tests/fixtures/selector-ast.txt"),
      ).text();
      return new Response(
        `<!doctype html><body><script>globalThis.variant=${variant};${source}</script>`,
        { headers: { "content-type": "text/html" } },
      );
    }
    if (path.startsWith("/generated-boxes/")) {
      const variant = Number(path.split("/").at(-1));
      const source = await Bun.file(
        join(import.meta.dir, "../crates/engine/tests/fixtures/generated-boxes.txt"),
      ).text();
      return new Response(
        `<!doctype html><body><script>globalThis.variant=${variant};${source}</script>`,
        {
          headers: { "content-type": "text/html" },
        },
      );
    }
    if (path.startsWith("/document-host/")) {
      const variant = Number(path.split("/").at(-1));
      const source = await Bun.file(
        join(import.meta.dir, "../crates/engine/tests/fixtures/document-host.txt"),
      ).text();
      return new Response(
        `<!doctype html><body><script>globalThis.variant=${variant};${source}</script>`,
        {
          headers: { "content-type": "text/html" },
        },
      );
    }
    if (path.startsWith("/group-errors/")) {
      const source = await Bun.file(
        join(import.meta.dir, "../crates/engine/tests/fixtures/group-errors.txt"),
      ).text();
      return new Response(`<script>${source}</script>`, {
        headers: { "content-type": "text/html" },
      });
    }
    if (path.startsWith("/supports/")) {
      const variant = Number(path.split("/").at(-1));
      const source = await Bun.file(
        join(import.meta.dir, "../crates/engine/tests/fixtures/supports.txt"),
      ).text();
      return new Response(`<script>globalThis.variant=${variant};${source}</script>`, {
        headers: { "content-type": "text/html" },
      });
    }
    if (path.startsWith("/layers/")) {
      const variant = Number(path.split("/").at(-1));
      const source = await Bun.file(
        join(import.meta.dir, "../crates/engine/tests/fixtures/layers.txt"),
      ).text();
      return new Response(`<script>globalThis.variant=${variant};${source}</script>`, {
        headers: { "content-type": "text/html" },
      });
    }
    if (path.startsWith("/external-styles/")) {
      return externalStylePage(Number(path.split("/").at(-1)));
    }
    const stylesheet = externalStyleResponse(request);
    if (stylesheet) return stylesheet;
    if (path.startsWith("/node-insertion/")) {
      const variant = Number(path.split("/").at(-1));
      return new Response(
        `<!doctype html><script>globalThis.variant=${variant};${insertionScript}</script>`,
        { headers: { "content-type": "text/html" } },
      );
    }
    if (path.startsWith("/intersections/")) {
      const variant = Number(path.split("/").at(-1));
      return new Response(`<script>globalThis.variant=${variant};${intersectionScript}</script>`, {
        headers: { "content-type": "text/html" },
      });
    }
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
  ["text shaping", "el.innerHTML='A<span>B</span>';"],
  [
    "stylesheet at-rule",
    "const css=document.createElement('style');css.textContent='@scope {div {width: 50px;}}';document.body.appendChild(css);",
  ],
  [
    "stylesheet sets",
    "const css=document.createElement('link');css.setAttribute('rel','stylesheet');css.setAttribute('title','alternate');document.body.appendChild(css);",
  ],
  ["transform", "el.style.transform='translateX(10px)';"],
  ["environment substitution", "el.style.width='env(safe-area-inset-left, 10px)';"],
  ["absolute static position", "el.style.position='absolute';"],
  ["display formatting", "const child=document.createElement('span');el.appendChild(child);"],
  ["element formatting", "const child=document.createElement('img');el.appendChild(child);"],
  ["relative query length", "el.style.width='2ch';"],
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
  ["bytes", "'x'.repeat(262145)", "resource limit: stylesheet bytes"],
  [
    "selectors",
    "Array.from({length:65},(_,i)=>'.x'+i).join(',')+'{width:1px}'",
    "layout unsupported: stylesheet selectors",
  ],
  [
    "rules",
    "Array.from({length:4097},(_,i)=>'.x'+i+'{width:1px}').join('')",
    "resource limit: stylesheet rules",
  ],
  [
    "nesting",
    "':is('.repeat(34)+'.x'+')'.repeat(34)+'{width:1px}'",
    "resource limit: stylesheet nesting",
  ],
  ["nested rule", "'div { & div {width:1px;} }'", "layout unsupported: nested stylesheet rule"],
  ["scope", "'@scope (.test) {div {width:1px;}}'", "layout unsupported: stylesheet at-rule"],
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
    "for(let i=0;i<65;i++){const css=document.createElement('style');css.textContent=Array.from({length:64},(_,j)=>'.x'+i+'_'+j).join(',')+'{width:1px}';document.body.appendChild(css);}",
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
    const snapshot=el.getBoundingClientRect();const invalid=document.createElement('style');invalid.textContent='x'.repeat(262145);document.body.appendChild(invalid);
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
    "activatedSelfCycle",
    "activatedMutualCycle",
    "chainUnusedCycle",
    "validTokensInvalidGrammar",
    "unusedMutualCycle",
    "activatedAcyclicFallback",
    "computedEmptyFallback",
    "permutations",
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

const intersectionExpected = Object.fromEntries(
  [
    "sharedScene",
    "sharedSceneInvalidation",
    "initial",
    "geometry",
    "entryBrands",
    "time",
    "sorted",
    "rootIdentity",
    "half",
    "exactThreshold",
    "edge",
    "excluded",
    "snapshots",
    "positiveMargin",
    "percentages",
    "negativeMargin",
    "clipping",
    "ancestorExclusion",
    "hidden",
    "zeroArea",
    "detached",
    "detachedRootBounds",
    "unrelated",
    "documentRoot",
    "noRepeat",
    "unobserved",
    "reobserve",
    "disconnected",
    "emptyThreshold",
    "guards",
    "invalidMargins",
    "ranges",
    "finiteThreshold",
    "marginShorthand",
    "absoluteMargin",
    "constructedEntry",
    "records",
    "contexts",
  ].map((key) => [key, true]),
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

const intersectionRecovery =
  "new Promise(resolve=>{const el=document.createElement('div');el.style.cssText='width:20px;height:20px';document.body.appendChild(el);const observer=new IntersectionObserver(entries=>{observer.disconnect();resolve(entries.length===1 && entries[0].isIntersecting);});observer.observe(el);})";
test.each([
  ["delay", "new IntersectionObserver(()=>{},{delay:1})", "unsupported: delay"],
  [
    "visibility",
    "new IntersectionObserver(()=>{},{trackVisibility:true})",
    "unsupported: visibility tracking",
  ],
  [
    "scroll margin",
    "new IntersectionObserver(()=>{},{scrollMargin:'1px'})",
    "unsupported: scroll margins",
  ],
  [
    "threshold cap",
    "new IntersectionObserver(()=>{},{threshold:Array(1025).fill(.5)})",
    "intersection threshold limit",
  ],
  [
    "margin cap",
    "new IntersectionObserver(()=>{},{rootMargin:' '.repeat(1025)})",
    "intersection margin bytes",
  ],
  [
    "registration cap",
    "(()=>{const observer=new IntersectionObserver(()=>{});for(let i=0;i<1025;i++)observer.observe(document.createElement('div'));})()",
    "intersection registration limit",
  ],
  [
    "scrolling layout",
    "new Promise(()=>{const el=document.createElement('div');el.style.cssText='width:20px;height:20px;overflow:auto';document.body.appendChild(el);new IntersectionObserver(()=>{}).observe(el);})",
    "layout unsupported: scrolling overflow",
  ],
  [
    "viewport overflow",
    "new Promise(()=>{document.body.style.overflow='hidden';new IntersectionObserver(()=>{}).observe(document.body);})",
    "layout unsupported: viewport overflow propagation",
  ],
  [
    "mixed inline text layout",
    "new Promise(()=>{const el=document.createElement('div');el.innerHTML='A<span>B</span>';document.body.appendChild(el);new IntersectionObserver(()=>{}).observe(el);})",
    "layout unsupported: text shaping",
  ],
])(
  "real HTTP → workerd → Wasm: intersection rejects %s and recovers",
  async (_name, expression, detail) => {
    const url = new URL("geometry-empty", origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression }),
    });
    expect(response.status).toBe(422);
    const message: unknown = expect.stringContaining(detail);
    expect(await response.json()).toEqual({ error: message });
    const recovered = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: intersectionRecovery }),
    });
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: true });
  },
);

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

const insertionExpected = Object.fromEntries(
  [
    "before",
    "after",
    "reorderBefore",
    "reorderAfter",
    "selfBefore",
    "selfAfter",
    "selfReplace",
    "replace",
    "emptyReplace",
    "emptySibling",
    "fragment",
    "append",
    "prepend",
    "fragmentParent",
    "characters",
    "detached",
    "symbol",
    "conversionAtomic",
    "conversionReentry",
    "cycle",
    "guards",
    "exposure",
    "unscopables",
    "descriptor",
    "nativeOps",
    "doctype",
    "documentHierarchy",
    "parentDescriptors",
    "parentBrands",
    "reactions",
  ].map((key) => [key, true]),
);
test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native variadic node insertion variant %i",
  async (variant) => {
    const url = new URL(`node-insertion/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "comparison" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: insertionExpected,
    });
    expect(requests).toContain(`GET /node-insertion/${variant}`);
  },
);

test.each([
  [
    "write bytes",
    "document.body.append('x'.repeat(4*1024*1024+1))",
    "resource limit: DOM write bytes",
  ],
  [
    "operations",
    "(()=>{for(let i=0;i<10000;i++)document.body.append('');})()",
    "resource limit: DOM operations",
  ],
])(
  "real HTTP → workerd → Wasm: variadic insertion enforces %s and recovers",
  async (_name, expression, detail) => {
    const url = new URL("geometry-empty", origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression }),
    });
    expect(response.status).toBe(422);
    const message: unknown = expect.stringContaining(detail);
    expect(await response.json()).toEqual({ error: message });
    const recovered = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url,
        expression:
          "(()=>{const p=document.createElement('div');document.body.append(p);p.append('b');p.firstChild.before('a');p.firstChild.after('c');return p.textContent==='acb';})()",
      }),
    });
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: true });
  },
);

const externalStyleExpected = Object.fromEntries(
  [
    "initial",
    "loaded",
    "event",
    "order",
    "reordered",
    "restoredOrder",
    "inlineSheet",
    "inline",
    "important",
    "inlineImportant",
    "variables",
    "mediaOff",
    "mediaOn",
    "disabled",
    "enabled",
    "removed",
    "reinserted",
    "redirect",
    "httpError",
    "mimeError",
    "mimeParameters",
    "typeOff",
    "typeOn",
    "relOff",
    "relOn",
    "base",
    "snapshot",
    "asynchronous",
    "multiple",
  ].map((key) => [key, true]),
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

const sheetPromise = (path: string) =>
  `new Promise(resolve=>{const link=document.createElement('link');link.setAttribute('rel','stylesheet');link.setAttribute('href',${JSON.stringify(path)});link.addEventListener('load',()=>resolve(true),{once:true});document.head.appendChild(link);})`;
test.each([
  [
    "response bytes",
    sheetPromise("/sheets-css/oversized"),
    "resource limit: stylesheet total bytes",
  ],
  [
    "aggregate bytes",
    `Promise.all([${sheetPromise("/sheets-css/total-a")},${sheetPromise("/sheets-css/total-b")}])`,
    "resource limit: stylesheet total bytes",
  ],
  [
    "integrity",
    "new Promise(()=>{const link=document.createElement('link');link.setAttribute('rel','stylesheet');link.setAttribute('href','/sheets-css/main');link.setAttribute('integrity','sha256-invalid');document.head.appendChild(link);})",
    "stylesheet integrity is not implemented",
  ],
  ["origin", sheetPromise("https://example.com/stylesheet.css"), "origin"],
])(
  "real HTTP → workerd → Wasm: external stylesheets reject %s and recover",
  async (_name, expression, detail) => {
    const url = new URL("geometry-empty", origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression }),
    });
    expect(response.status).toBe(422);
    const message: unknown = expect.stringContaining(detail);
    expect(await response.json()).toEqual({ error: message });
    const recovered = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: sheetPromise("/sheets-css/main") }),
    });
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: true });
  },
);

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

test("real HTTP → workerd → Wasm: external imports remain explicit layout failures", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const expression = `${sheetPromise("/sheets-css/has-import")}.then(()=>{try{document.body.getBoundingClientRect();return false;}catch(error){return error.message.includes('layout unsupported: stylesheet at-rule');}})`;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: true });
});

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native cascade layers variant %i",
  async (variant) => {
    const url = new URL(`layers/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "comparison" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: Object.fromEntries(
        [
          "anonymous",
          "anonymousImportant",
          "caseSensitive",
          "crossSheet",
          "crossSheetOrder",
          "dotted",
          "dottedReopened",
          "escaped",
          "importance",
          "important",
          "inactiveOrder",
          "inlineImportant",
          "inlineNormal",
          "invalidBlock",
          "media",
          "nested",
          "nestedImportant",
          "normal",
          "parent",
          "parentGroup",
          "reopened",
          "reorder",
          "reserved",
          "shorthand",
          "snapshot",
          "sourceOrder",
          "specificity",
          "unlayered",
          "unlayeredImportant",
          "variables",
        ].map((key) => [key, true]),
      ),
    });
  },
);
test.each([
  [
    "statements",
    "'@layer '+Array.from({length:1025},(_,i)=>'a'+i).join(',')+';'",
    "stylesheet layers",
  ],
  ["blocks", "Array.from({length:1025},()=> '@layer{}').join('')", "stylesheet layers"],
  [
    "dotted depth",
    "'@layer '+Array.from({length:33},(_,i)=>'a'+i).join('.')+';'",
    "stylesheet layer depth",
  ],
])("real HTTP → workerd → Wasm: cascade layers bound %s", async (_name, source, detail) => {
  const url = new URL("geometry-empty", origin.url).href;
  const expression = `(()=>{const css=document.createElement('style');css.textContent=${source};document.head.appendChild(css);try{document.body.getBoundingClientRect();return false;}catch(error){return error.message.includes(${JSON.stringify(detail)});}finally{css.remove();}})()`;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: true });
});

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

test.each([
  ["text", 'content:"text";display:block', "text shaping"],
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

test("real HTTP → workerd → Wasm: generated boxes share the native layout tree budget", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const expression = `(()=>{const container=document.createElement('div');for(let i=0;i<500;i++)container.appendChild(document.createElement('div'));document.body.appendChild(container);const sheet=document.createElement('style');sheet.textContent='div::before,div::after{content:"";display:block;height:1px}';document.head.appendChild(sheet);let failed=false;try{container.getBoundingClientRect();}catch(error){failed=error.message.endsWith('resource limit: layout tree: nodes');}sheet.remove();container.remove();return failed&&Number.isFinite(document.body.getBoundingClientRect().height);})()`;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: true });
});

const supportsExpected = Object.fromEntries(
  [
    "and",
    "andFalse",
    "arguments",
    "case",
    "coercion",
    "comments",
    "custom",
    "customInvalid",
    "detached",
    "falseRule",
    "general",
    "generalNot",
    "generalQuery",
    "implicit",
    "importantRule",
    "importantValue",
    "invalid",
    "layers",
    "media",
    "missingTerm",
    "mixed",
    "namespace",
    "nestedNot",
    "not",
    "one",
    "or",
    "parentheses",
    "propertyWhitespace",
    "snapshot",
    "trueRule",
    "two",
    "unwrappedNot",
  ].map((key) => [key, true]),
);
test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native feature support variant %i",
  async (variant) => {
    const url = new URL(`supports/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "comparison" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: supportsExpected,
    });
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
test("real HTTP → workerd → Wasm: native feature support leaves unsupported capabilities explicit", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const expression =
    "['color:red','transform:translateX(1px)','width:var(--x)','selector(div)'].map(query=>CSS.supports(query))";
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    url,
    engine: "rust-wasm-quickjs",
    value: [false, false, false, false],
  });
});
test("real HTTP → workerd → Wasm: native feature support ignores overridden page query functions", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const expression =
    "(()=>{CSS.supports=()=>false;const target=document.createElement('div');document.body.appendChild(target);const sheet=document.createElement('style');sheet.textContent='@supports(width:1px){div{width:50px}}';document.head.appendChild(sheet);return target.getBoundingClientRect().width===50;})()";
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: true });
});

const datasetExpected = Object.fromEntries(
  [
    "brand",
    "coercion",
    "collisions",
    "constructor",
    "define",
    "delete",
    "descriptor",
    "detached",
    "doubleDash",
    "empty",
    "errors",
    "extensible",
    "getter",
    "has",
    "identity",
    "json",
    "keys",
    "live",
    "missingDelete",
    "numeric",
    "object",
    "parsed",
    "punctuation",
    "reactions",
    "receiver",
    "removed",
    "snapshot",
    "svg",
    "svgCase",
    "svgWrite",
    "symbol",
    "unicode",
    "upper",
    "write",
  ].map((key) => [key, true]),
);
test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native dataset variant %i",
  async (variant) => {
    const url = new URL(`dataset/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "comparison" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: datasetExpected,
    });
  },
);
test("real HTTP → workerd → Wasm: native dataset exposes unsupported exotic descriptors", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const expression =
    "(()=>{const e=document.createElement('div'),d=e.dataset;return !Reflect.defineProperty(d,'locked',{value:'x',configurable:false})&&!Reflect.defineProperty(d,'accessor',{get(){return 'x';}})&&!e.hasAttribute('data-locked')&&!e.hasAttribute('data-accessor');})()";
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: true });
});
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
  "real HTTP → workerd → Wasm: native selector AST variant %i",
  async (variant) => {
    const url = new URL(`selector-ast/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "comparison" }),
    });
    expect(response.status).toBe(200);
    const expected: Record<string, boolean> = {};
    for (const name of [
      "backdrop",
      "backdropList",
      "backdropOrigin",
      "placeholder",
      "selection",
      "marker",
      "fileButton",
      "hasChild",
      "hasAdjacent",
      "hasFollowing",
      "hasMissing",
      "hasNegation",
      "nthOf",
      "nthLastOf",
      "nthAbsent",
      "root",
      "notRoot",
      "isHas",
      "whereHas",
      "absentModal",
      "notModal",
      "absentFocus",
      "notFocus",
      "upperBackdrop",
      "escapedBackdrop",
    ]) {
      expected[name] = true;
      expected[`${name}Recovery`] = true;
    }
    expect(await response.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: expected });
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: paused native animation variant %i",
  async (variant) => {
    const url = new URL(`animations/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "comparison" }),
    });
    expect(response.status).toBe(200);
    const expected: Record<string, boolean> = {};
    for (const name of [
      "unused",
      "ease",
      "bezier",
      "frameEasing",
      "zeroLength",
      "variables",
      "unlayeredPriority",
      "vendor",
      "generated",
      "quarter",
      "half",
      "reverse",
      "before",
      "beforeNone",
      "after",
      "afterNone",
      "alternate",
      "alternateReverse",
      "finalAlternate",
      "fractionalCount",
      "infinite",
      "implicitFrom",
      "important",
      "frameImportant",
      "duplicateFrame",
      "duplicateDefinition",
      "mediaFalse",
      "mediaTrue",
      "layer",
      "quoted",
      "missing",
      "zeroDuration",
      "zeroCount",
    ]) {
      expected[name] = true;
      expected[`${name}Recovery`] = true;
    }
    expect(await response.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: expected });
  },
);

test.each([
  ["running", "from{width:10px}to{width:90px}", "demo 1s linear -.5s both", "running timeline"],
  ["steps", "from{width:10px}to{width:90px}", "demo 1s steps(2) -.25s paused both", "step easing"],
  [
    "mixed units",
    "from{width:10px}to{width:90%}",
    "demo 1s linear -.5s paused both",
    "mixed interpolation units",
  ],
  [
    "custom property",
    "from{--size:10px}to{--size:90px}",
    "demo 1s linear -.5s paused both",
    "custom property interpolation",
  ],
])(
  "real HTTP → workerd → Wasm: native animation gap %s",
  async (_name, frames, animation, detail) => {
    const url = new URL("geometry/0", origin.url).href;
    const expression = `(()=>{const target=document.createElement('div');target.className='animated';document.body.appendChild(target);const sheet=document.createElement('style');sheet.textContent=${JSON.stringify(`@keyframes demo{${frames}}.animated{height:0;width:11px;animation:${animation}}`)};document.head.appendChild(sheet);try{target.getBoundingClientRect();return 'missing failure';}catch(error){return error.message;}finally{sheet.remove();target.remove();}})()`;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression }),
    });
    expect(response.status).toBe(200);
    const expected: unknown = expect.stringContaining(`animation ${detail}`);
    expect(await response.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: expected,
    });
  },
);

test("real HTTP → workerd → Wasm: native animation keyframe budget recovers", async () => {
  const url = new URL("geometry/0", origin.url).href;
  const expression = `(()=>{const target=document.createElement('div');target.style.cssText='height:0;width:11px';document.body.appendChild(target);const sheet=document.createElement('style');sheet.textContent='@keyframes demo{'+Array.from({length:1025},()=> '50%{width:30px}').join('')+'}';document.head.appendChild(sheet);let failure;try{target.getBoundingClientRect();}catch(error){failure=error.message;}sheet.remove();const width=target.getBoundingClientRect().width;target.remove();return {failure,width};})()`;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(response.status).toBe(200);
  const failure: unknown = expect.stringContaining("animation keyframes");
  expect(await response.json()).toEqual({
    url,
    engine: "rust-wasm-quickjs",
    value: { failure, width: 11 },
  });
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

test("real HTTP → workerd → Wasm: indexed native cascade accepts 4096 selectors", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const expression = `(()=>{const target=document.createElement('div');target.className='target';target.style.height='0';document.body.appendChild(target);const sheet=document.createElement('style');sheet.textContent=Array.from({length:4095},(_,i)=>'.missing_'+i+'{width:1px}').join('')+'.target{width:37px}';document.head.appendChild(sheet);return target.getBoundingClientRect().width;})()`;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: 37 });
});

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native container query variant %i",
  async (variant) => {
    const url = new URL(`containers/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url,
        expression: "Object.assign({ratioPrecision:containerRatioPrecision}, comparison)",
      }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    expect(result).toMatchObject({ url, engine: "rust-wasm-quickjs" });
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing comparison");
    expect(Object.keys(value)).toHaveLength(80);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

for (const [name, css, reason] of [
  [
    "intrinsic inline sizing",
    ".target{container-type:inline-size}",
    "container intrinsic size containment",
  ],
  [
    "intrinsic block sizing",
    ".target{container-type:size;width:100px}",
    "container intrinsic size containment",
  ],
  [
    "flex intrinsic items",
    ".parent{display:flex}.target{container-type:inline-size;width:100px}",
    "container intrinsic item containment",
  ],
  [
    "style conditions",
    "@container style(--value:test){.target{width:1px}}",
    "container style query",
  ],
  [
    "scroll-state conditions",
    "@container scroll-state(stuck:top){.target{width:1px}}",
    "container scroll-state query",
  ],
  [
    "glyph-relative conditions",
    "@container (width > 1ex){.target{width:1px}}",
    "container relative query length",
  ],
  ["name inheritance", ".target{container-name:inherit}", "container name inheritance"],
] as const) {
  test(`real HTTP → workerd → Wasm: container gap ${name} fails explicitly and recovers`, async () => {
    const url = new URL("geometry-empty", origin.url).href;
    const expression = `(()=>{const parent=document.createElement('div');parent.className='parent';const target=document.createElement('div');target.className='target';parent.appendChild(target);document.body.appendChild(parent);const sheet=document.createElement('style');sheet.textContent=${JSON.stringify(css)};document.head.appendChild(sheet);let failure='';try{target.getBoundingClientRect()}catch(error){failure=String(error)}sheet.remove();target.style.width='11px';return {failure,width:target.getBoundingClientRect().width};})()`;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression }),
    });
    expect(response.status).toBe(200);
    const failure: unknown = expect.stringContaining(reason);
    expect(await response.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: { failure, width: 11 },
    });
  });
}

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

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: contextual native font and query lengths variant %i",
  async (variant) => {
    const url = new URL(`font-queries/${variant}`, origin.url).href;
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
    expect(Object.keys(value)).toHaveLength(78);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: configured initial font size variant %i",
  async (variant) => {
    const initial = 16 + variant;
    const url = new URL("geometry-empty", origin.url).href;
    const script = await Bun.file(
      join(import.meta.dir, "../crates/engine/tests/fixtures/font-config.txt"),
    ).text();
    const expression = `(()=>{globalThis.variant=${variant};return ${script};})()`;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url,
        media: { width: initial * 10, height: initial * 8, defaultFontSize: initial },
        expression,
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: {
        initialRem: true,
        mediaRem: true,
        mediaEm: true,
        mediaRootIndependent: true,
        recovery: true,
      },
    });
  },
);
for (const defaultFontSize of [0, 513, 1.5, "16"]) {
  test(`real HTTP → workerd: invalid initial font size ${defaultFontSize} is rejected before navigation`, async () => {
    const url = new URL("geometry-empty", origin.url).href;
    const before = requests.length;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, media: { defaultFontSize }, expression: "1" }),
    });
    expect(response.status).toBe(400);
    expect(requests.length).toBe(before);
  });
}

for (const initial of [1, 512]) {
  test(`real HTTP → workerd → Wasm: configured font endpoint ${initial} remains usable`, async () => {
    const url = new URL("geometry-empty", origin.url).href;
    const script = await Bun.file(
      join(import.meta.dir, "../crates/engine/tests/fixtures/font-config.txt"),
    ).text();
    const expression = `(()=>{globalThis.variant=${initial - 16};return ${script};})()`;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url,
        media: { width: initial * 10, height: initial * 8, defaultFontSize: initial },
        expression,
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: {
        initialRem: true,
        mediaRem: true,
        mediaEm: true,
        mediaRootIndependent: true,
        recovery: true,
      },
    });
  });
}

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
  ["<length>", "0px", "--p:2em", "registered relative length"],
  ["<length>", "2vw", "", "registered contextual length"],
  ["<color>", "red", "--p:currentColor", "registered dependent color"],
  ["<color>", "currentColor", "", "registered dependent color"],
  ["<color>", "lab(50% 0 0)", "", "registered computed value type"],
  ["<url>", "url(example.test)", "", "registered computed value type"],
  ["<image>", "linear-gradient(red,blue)", "", "registered computed value type"],
  ["<transform-function>", "translateX(1px)", "", "registered computed value type"],
  ["<length-percentage>", "calc(10px + 5%)", "", "registered computed value type"],
] as const)(
  "real HTTP → workerd → Wasm: explicit registered value diagnostic %s/%s",
  async (syntax, initial, declarations, reason) => {
    const url = new URL("geometry-empty", origin.url).href;
    const css = `@property --p {syntax:"${syntax}";inherits:false;initial-value:${initial};}.target{width:var(--p);${declarations}}`;
    const expression = `(()=>{const sheet=document.createElement('style');sheet.textContent=${JSON.stringify(css)};document.head.appendChild(sheet);const target=document.createElement('div');target.className='target';document.body.appendChild(target);return target.getBoundingClientRect().width;})()`;
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
          "(()=>{const node=document.createElement('div');node.style.width='11px';document.body.appendChild(node);return node.getBoundingClientRect().width;})()",
      }),
    });
    expect(healthy.status).toBe(200);
    expect(await healthy.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: 11 });
  },
);

test("real HTTP → workerd → Wasm: registration resource limit and recovery", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const expression =
    "(()=>{const sheet=document.createElement('style');let css='';for(let i=0;i<1025;i++)css+='@property --p'+i+'{syntax:invalid;}';sheet.textContent=css;document.head.appendChild(sheet);return document.body.getBoundingClientRect().width;})()";
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(response.status).toBe(422);
  const error: unknown = expect.stringContaining("property registrations");
  expect(await response.json()).toMatchObject({ error });
  const healthy = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression: "document.body.children.length" }),
  });
  expect(healthy.status).toBe(200);
  expect(await healthy.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: 0 });
});

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: binary response body variant %i",
  async (variant) => {
    const url = new URL(`binary-cases/${variant}`, origin.url).href;
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
    expect(Object.keys(value)).toHaveLength(26);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test("real HTTP → workerd → Wasm: binary transport byte limit and recovery", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression:
        "fetch('/binary/large').then(response=>response.arrayBuffer()).then(buffer=>buffer.byteLength)",
    }),
  });
  expect(response.status).toBe(413);
  const error: unknown = expect.stringContaining("byte limit");
  expect(await response.json()).toMatchObject({ error });
  const healthy = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression:
        "fetch('/binary/data/0').then(response=>response.bytes()).then(bytes=>bytes.length)",
    }),
  });
  expect(healthy.status).toBe(200);
  expect(await healthy.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: 512 });
});

test.each([
  ["new Response('text')", "Response construction"],
  ["fetch('/binary/data/0').then(response=>response.body)", "response streams"],
  ["fetch('/binary/data/0').then(response=>response.headers)", "response headers"],
] as const)(
  "real HTTP → workerd → Wasm: explicit response diagnostic %s",
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
          "fetch('/binary/data/0').then(response=>response.bytes()).then(bytes=>bytes.length)",
      }),
    });
    expect(healthy.status).toBe(200);
    expect(await healthy.json()).toEqual({ url, engine: "rust-wasm-quickjs", value: 512 });
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

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: CSS font registry and URL loading variant %i",
  async (variant) => {
    const url = new URL(`font-loading/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: `fontCase(${variant})` }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing comparison");
    expect(Object.keys(value)).toHaveLength(27);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
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

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: font matching variant %i",
  async (variant) => {
    const url = new URL(`font-matching/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: `fontMatchCase(${variant})` }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing comparison");
    expect(Object.keys(value)).toHaveLength(55);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each([
  {
    name: "font shorthand length",
    expression: "document.fonts.check('12px '+ 'x'.repeat(4097))",
    reason: "font matching input",
  },
  {
    name: "font sample length",
    expression: "document.fonts.check('12px Example', 'A'.repeat(65537))",
    reason: "encoding input limit",
  },
  {
    name: "font matching face count",
    expression:
      "(()=>{for(let i=0;i<1025;i++)document.fonts.add(new FontFace('Example', 'url(/font-assets/font/0)'));return document.fonts.check('12px Example')})()",
    reason: "font matching input",
  },
  {
    name: "font matching payload",
    expression:
      "(()=>{for(let i=0;i<300;i++)document.fonts.add(new FontFace('x'.repeat(4096)+i, 'url(/font-assets/font/0)'));return document.fonts.check('12px Example')})()",
    reason: "font matching payload limit",
  },
])("real HTTP → workerd → Wasm: $name boundary and recovery", async ({ expression, reason }) => {
  const url = new URL("font-matching/129", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(response.status).toBe(422);
  expect(await response.text()).toContain(reason);
  const healthy = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression: "document.fonts.check('12px Example')" }),
  });
  expect(healthy.status).toBe(200);
  expect(await healthy.json()).toMatchObject({ value: true });
});

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: configured stylesheet budget variant %i",
  async (variant) => {
    const url = new URL(`css-budget/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url,
        maxStylesheetBytes: 700000,
        expression: `cssBudgetCase(${variant})`,
      }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing checks");
    expect(Object.keys(value)).toHaveLength(12);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each([0, -1, 1.5, 2097153, "700000", true, null, {}])(
  "real HTTP → workerd → Wasm: invalid stylesheet budget %j is rejected before navigation",
  async (maxStylesheetBytes) => {
    const url = new URL("css-budget/130", origin.url).href;
    const count = requests.length;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, maxStylesheetBytes, expression: "true" }),
    });
    expect(response.status).toBe(400);
    expect(requests.length).toBe(count);
  },
);

test.each([
  {
    name: "default downloaded bytes",
    path: "css-budget/130",
    expression: "true",
    maxStylesheetBytes: undefined,
    reason: "stylesheet total bytes",
  },
  {
    name: "configured downloaded bytes",
    path: "css-budget/131",
    expression: "true",
    maxStylesheetBytes: 290000,
    reason: "stylesheet total bytes",
  },
  {
    name: "configured single inline bytes",
    path: "geometry-empty",
    expression:
      "(()=>{const s=document.createElement('style');s.textContent='/*'+'é'.repeat(150000)+'*/';document.head.appendChild(s);return document.body.getBoundingClientRect()})()",
    maxStylesheetBytes: 290000,
    reason: "stylesheet bytes",
  },
  {
    name: "configured combined inline bytes",
    path: "geometry-empty",
    expression:
      "(()=>{for(let i=0;i<2;i++){const s=document.createElement('style');s.textContent='/*'+'x'.repeat(180000)+'*/';document.head.appendChild(s)}return document.body.getBoundingClientRect()})()",
    maxStylesheetBytes: 300000,
    reason: "stylesheet total bytes",
  },
])(
  "real HTTP → workerd → Wasm: $name limit and fresh recovery",
  async ({ path, expression, maxStylesheetBytes, reason }) => {
    const url = new URL(path, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression, maxStylesheetBytes }),
    });
    expect(response.status).toBe(422);
    expect(await response.text()).toContain(reason);
    const healthyUrl = new URL("css-budget/132", origin.url).href;
    const healthy = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: healthyUrl,
        expression: "document.getElementById('target').getBoundingClientRect().width",
        maxStylesheetBytes: 700000,
      }),
    });
    expect(healthy.status).toBe(200);
    expect(await healthy.json()).toMatchObject({ value: 432 });
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

test.each([
  { css: "border:1ch solid", reason: "relative query length" },
  { css: "border-image-source:url('/image')", reason: "border-image-source" },
  { css: "border-inline-start-width:2px", reason: "border-inline-start-width" },
  { css: "border-top-left-radius:2px", reason: "border-top-left-radius", geometryOnly: true },
])(
  "real HTTP → workerd → Wasm: border geometry boundary $css and recovery",
  async ({ css, reason, geometryOnly }) => {
    const url = new URL("borders/128", origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url,
        expression: geometryOnly
          ? `(()=>{const e=document.createElement('div');document.body.append(e);const before=e.getBoundingClientRect();e.style.cssText=${JSON.stringify(css)};const after=e.getBoundingClientRect();return {stable:before.x===after.x&&before.y===after.y&&before.width===after.width&&before.height===after.height};})()`
          : `(()=>{const e=document.createElement('div');e.style.cssText=${JSON.stringify(css)};document.body.append(e);return e.getBoundingClientRect()})()`,
      }),
    });
    if (geometryOnly) {
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ value: { stable: true } });
    } else {
      expect(response.status).toBe(422);
      expect(await response.text()).toContain(reason);
    }
    const healthy = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "borderCase(0)" }),
    });
    expect(healthy.status).toBe(200);
    const result: unknown = await healthy.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing recovery");
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native software canvas pixels variant %i",
  async (variant) => {
    const url = new URL(`canvas/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: `canvasCase(${variant})` }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing pixels");
    expect(Object.keys(value)).toHaveLength(55);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each([
  {
    name: "dimensions",
    expression: "new OffscreenCanvas(4097,1)",
    reason: "canvas: dimensions limit",
  },
  { name: "pixels", expression: "new OffscreenCanvas(2048,2048)", reason: "canvas: pixels limit" },
  {
    name: "memory",
    expression: "Array.from({length:5},()=>new OffscreenCanvas(1024,1024))",
    reason: "canvas: memory limit",
  },
  {
    name: "owners",
    expression: "Array.from({length:65},()=>new OffscreenCanvas(0,0))",
    reason: "canvas: owners limit",
  },
  {
    name: "pixel work",
    expression:
      "(()=>{const x=new OffscreenCanvas(1024,1024).getContext('2d');for(let i=0;i<20;i++)x.fillRect(0,0,1024,1024)})()",
    reason: "canvas: pixel work limit",
  },
  {
    name: "state stack",
    expression:
      "(()=>{const x=new OffscreenCanvas(1,1).getContext('2d');for(let i=0;i<65;i++)x.save()})()",
    reason: "canvas: state stack limit",
  },
  {
    name: "color bytes",
    expression: "new OffscreenCanvas(1,1).getContext('2d').fillStyle='x'.repeat(4097)",
    reason: "canvas: color bytes limit",
  },
  {
    name: "color space",
    expression: "new OffscreenCanvas(1,1).getContext('2d',{colorSpace:'display-p3'})",
    reason: "unsupported: canvas color space",
  },
  {
    name: "text",
    expression: "new OffscreenCanvas(1,1).getContext('2d').measureText('A')",
    reason: "unsupported: font glyph fallback",
  },
  {
    name: "transform",
    expression: "new OffscreenCanvas(1,1).getContext('2d').translate(1,1)",
    reason: "unsupported: canvas translate",
  },
  {
    name: "stroke",
    expression: "new OffscreenCanvas(1,1).getContext('2d').strokeStyle='red'",
    reason: "unsupported: canvas strokeStyle",
  },
])(
  "real HTTP → workerd → Wasm: canvas $name boundary and recovery",
  async ({ expression, reason }) => {
    const url = new URL("canvas/128", origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression }),
    });
    expect(response.status).toBe(422);
    expect(await response.text()).toContain(reason);
    const healthy = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "canvasCase(0)" }),
    });
    expect(healthy.status).toBe(200);
    const result: unknown = await healthy.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing recovery");
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test("real HTTP → workerd → Wasm: rejected canvas resize preserves bitmap and state", async () => {
  const url = new URL("canvas/129", origin.url).href;
  const expression =
    "(()=>{const c=new OffscreenCanvas(1024,2),x=c.getContext('2d');x.fillStyle='red';x.fillRect(0,0,1,1);let limit=false;try{c.height=2048}catch(e){limit=String(e).includes('canvas: pixels limit')}const data=x.getImageData(0,0,1,1).data;return limit&&c.width===1024&&c.height===2&&x.fillStyle==='#ff0000'&&data[0]===255&&data[3]===255})()";
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ value: true });
});

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

test.each([
  {
    name: "pixel work",
    expression:
      "(()=>{const x=new OffscreenCanvas(1024,1024).getContext('2d'),d=new ImageData(1024,1024);for(let i=0;i<13;i++)x.reset();x.putImageData(d,0,0)})()",
    reason: "canvas: pixel work limit",
  },
  {
    name: "operation count",
    expression:
      "(()=>{const x=new OffscreenCanvas(1,1).getContext('2d'),d=new ImageData(1,1);for(let i=0;i<10000;i++)x.putImageData(d,0,0)})()",
    reason: "canvas: operation limit",
  },
])(
  "real HTTP → workerd → Wasm: canvas upload $name boundary and recovery",
  async ({ expression, reason }) => {
    const url = new URL("canvas/130", origin.url).href;
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
      body: JSON.stringify({ url, expression: "canvasUploadCase(0)" }),
    });
    expect(healthy.status).toBe(200);
    const result: unknown = await healthy.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing recovery");
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test("real HTTP → workerd → Wasm: maximum-size canvas upload writes actual edge pixels", async () => {
  const url = new URL("canvas/131", origin.url).href;
  const expression =
    "(()=>{const c=new OffscreenCanvas(1024,1024),x=c.getContext('2d'),d=new ImageData(1024,1024);d.data.fill(255);x.putImageData(d,0,0);const a=x.getImageData(0,0,1,1).data,b=x.getImageData(1023,1023,1,1).data;return a[0]===255&&a[3]===255&&b[0]===255&&b[3]===255})()";
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ value: true });
}, 15000);

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

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native canvas compositing variant %i",
  async (variant) => {
    const url = new URL(`canvas/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: `canvasCompositingCase(${variant})` }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing pixels");
    const checks: unknown = Reflect.get(value, "checks");
    if (typeof checks !== "object" || checks === null) throw new Error("Missing checks");
    expect(Object.keys(checks)).toHaveLength(222);
    expect(Object.values(checks).every((check) => check === true)).toBe(true);
  },
);

test.each(["copy", "source-in", "source-out", "destination-in", "destination-atop"])(
  "real HTTP → workerd → Wasm: canvas compositing %s charges the full bitmap and recovers",
  async (mode) => {
    const url = new URL("canvas/140", origin.url).href;
    const expression = `(()=>{const x=new OffscreenCanvas(1024,1024).getContext('2d');x.globalCompositeOperation='${mode}';for(let i=0;i<20;i++)x.fillRect(5000,5000,1,1)})()`;
    const failed = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression }),
    });
    expect(failed.status).toBe(422);
    expect(await failed.text()).toContain("canvas: pixel work limit");
    const healthy = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "canvasCompositingCase(0).checks" }),
    });
    expect(healthy.status).toBe(200);
    const result: unknown = await healthy.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing recovery");
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

test.each([0, -1, 1.5, 4097, "2048", true, null, {}])(
  "real HTTP → workerd → Wasm: invalid layout node budget %j is rejected before navigation",
  async (maxLayoutNodes) => {
    const url = new URL("layout-budget/0", origin.url).href,
      count = requests.length;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, maxLayoutNodes, expression: "true" }),
    });
    expect(response.status).toBe(400);
    expect(requests.length).toBe(count);
  },
);

test.each([
  {
    name: "default nodes",
    path: "layout-budget/0",
    maxLayoutNodes: undefined,
    expression: "layoutBudgetCase(0)",
    reason: "layout tree: nodes",
  },
  {
    name: "below exact node count",
    path: "layout-budget/0",
    maxLayoutNodes: 1106,
    expression: "layoutBudgetCase(0)",
    reason: "layout tree: nodes",
  },
  {
    name: "depth",
    path: "layout-budget/depth/0",
    maxLayoutNodes: 4096,
    expression: "document.querySelector('#root').getBoundingClientRect()",
    reason: "layout tree: depth",
  },
  {
    name: "independent DOM operations",
    path: "layout-budget/0",
    maxLayoutNodes: 4096,
    expression:
      "(()=>{const r=document.querySelector('#root');for(let i=0;i<100;i++){r.style.width=(100+i)+'px';r.getBoundingClientRect()}})()",
    reason: "DOM operations",
  },
])(
  "real HTTP → workerd → Wasm: layout budget $name boundary and recovery",
  async ({ path, maxLayoutNodes, expression, reason }) => {
    const url = new URL(path, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, maxLayoutNodes, expression }),
    });
    expect(response.status).toBe(422);
    expect(await response.text()).toContain(reason);
    const healthy = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL("layout-budget/0", origin.url).href,
        maxLayoutNodes: 1107,
        expression: "layoutBudgetCase(0)",
      }),
    });
    expect(healthy.status).toBe(200);
    const result: unknown = await healthy.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing recovery");
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test("real HTTP → workerd → Wasm: configured node budget counts generated boxes", async () => {
  const url = new URL("layout-budget/generated/0", origin.url).href;
  const expression = "document.querySelector('#root').getBoundingClientRect().width===8";
  const failed = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, maxLayoutNodes: 512, expression }),
  });
  expect(failed.status).toBe(422);
  expect(await failed.text()).toContain("layout tree: nodes");
  const healthy = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, maxLayoutNodes: 2048, expression }),
  });
  expect(healthy.status).toBe(200);
  expect(await healthy.json()).toMatchObject({ value: true });
});

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: logical dimensions and cascade variant %i",
  async (variant) => {
    const url = new URL(`logical-size/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: `logicalSizeCase(${variant})` }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing logical geometry");
    expect(Object.keys(value)).toHaveLength(45);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each([
  ["writing-mode:vertical-rl;inline-size:20px", "writing-mode"],
  ["direction:rtl;inline-size:20px", "direction"],
  ["inline-size:2ch", "relative query length"],
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
      count: 47,
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
        "color",
        "display",
        "font-family",
        "font-size",
        "height",
        "inline-size",
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
        "tab-size",
        "text-size-adjust",
        "text-transform",
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

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native background image layers variant %i",
  async (variant) => {
    const url = new URL(`background-images/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: `backgroundImagesCase(${variant})` }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null)
      throw new Error("Missing background image values");
    expect(Object.keys(value)).toHaveLength(48);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: text adjustment cascade variant %i",
  async (variant) => {
    const url = new URL(`text-adjust/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: `textAdjustCase(${variant})` }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing adjustment values");
    expect(Object.keys(value)).toHaveLength(44);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native computed tabs variant %i",
  async (variant) => {
    const url = new URL(`tabs/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: `tabsCase(${variant})` }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing computed tabs");
    expect(Object.keys(value)).toHaveLength(46);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each([
  [
    "(()=>{const e=document.createElement('div');e.style.tabSize='2ex';document.body.append(e);return getComputedStyle(e).tabSize})()",
    "relative query length",
  ],
  [
    "(()=>{document.body.textContent=String.fromCharCode(65,9,66);document.body.style.tabSize='4';document.body.style.whiteSpace='pre';return document.body.getBoundingClientRect()})()",
    "text white-space",
  ],
])(
  "real HTTP → workerd → Wasm: unsupported tab layout %s fails explicitly",
  async (expression, reason) => {
    const url = new URL("tabs/0", origin.url).href;
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
      body: JSON.stringify({ url, expression: "tabsCase(0)" }),
    });
    expect(healthy.status).toBe(200);
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

test.each([
  [
    "(()=>{const e=document.createElement('div');e.style.lineHeight='2ex';document.body.append(e);return getComputedStyle(e).lineHeight})()",
    "relative query length",
  ],
  [
    "(()=>{document.body.innerHTML='A<span>B</span>';document.body.style.lineHeight='1.5';return document.body.getBoundingClientRect()})()",
    "text shaping",
  ],
])(
  "real HTTP → workerd → Wasm: unsupported line metrics %s fail explicitly",
  async (expression, reason) => {
    const url = new URL("line-height/0", origin.url).href;
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
      body: JSON.stringify({ url, expression: "lineHeightCase(0)" }),
    });
    expect(healthy.status).toBe(200);
  },
);

test.each([
  ["url(example.test/image.png)", "URL provenance and loading"],
  ["radial-gradient(red,blue)", "radial, conic or legacy gradient"],
  ["linear-gradient(red 2ex,blue)", "relative query length"],
  ["linear-gradient(red calc(infinity * 1px),blue)", "non-finite position"],
  ["linear-gradient(red calc(20% + 2px),blue)", "mixed percentage calculation"],
  ["linear-gradient(color(display-p3 1 0 0),blue)", "computed color space or context color"],
])("real HTTP → workerd → Wasm: explicit background image gap %s", async (image, detail) => {
  const url = new URL("background-images/0", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression: `(()=>{document.body.style.backgroundImage=${JSON.stringify(image)};return getComputedStyle(document.body).backgroundImage})()`,
    }),
  });
  expect(response.status).toBe(422);
  expect(await response.text()).toContain(detail);
  const healthy = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression: "backgroundImagesCase(0)" }),
  });
  expect(healthy.status).toBe(200);
});

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

test("real HTTP → workerd → Wasm: unsupported image geometry stays explicit", async () => {
  const url = new URL("background-images/0", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression:
        "(()=>{document.body.style.backgroundImage='url(https://example.test/image.png)';return document.body.getBoundingClientRect()})()",
    }),
  });
  expect(response.status).toBe(422);
  expect(await response.text()).toContain("URL provenance and loading");
});

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native background positioning variant %i",
  async (variant) => {
    const url = new URL(`background-position/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: `backgroundPositionCase(${variant})` }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null)
      throw new Error("Missing background positioning values");
    expect(Object.keys(value)).toHaveLength(64);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
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
  "real HTTP → workerd → Wasm: explicit positioning limit %s / %s / %s",
  async (position, detail, read) => {
    const url = new URL("background-position/0", origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url,
        expression: `(()=>{document.body.style.backgroundPositionX=${JSON.stringify(position)};return ${read}})()`,
      }),
    });
    expect(response.status).toBe(422);
    expect(await response.text()).toContain(detail);
    const healthy = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "backgroundPositionCase(0)" }),
    });
    expect(healthy.status).toBe(200);
  },
);

test("real HTTP → workerd → Wasm: positioning preserves independent scalars and image layer count", async () => {
  const url = new URL("background-position/0", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression:
        "(()=>{const e=document.body;e.style.cssText='font-size:18px;background-position:2ex 30%';const s=getComputedStyle(e);const font=s.fontSize,y=s.backgroundPositionY;e.style.cssText='background-image:url(https://example.test/a),url(https://example.test/b);background-position:10px 20%';return {font,y,x:s.backgroundPositionX,layersY:s.backgroundPositionY,paint:CSS.supports('background-position-x','10px')}})()",
    }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    value: { font: "18px", y: "30%", x: "10px, 10px", layersY: "20%, 20%", paint: false },
  });
});

test("real HTTP → workerd → Wasm: expanded positioning serialization is bounded", async () => {
  const url = new URL("background-position/0", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression:
        "(()=>{const e=document.body;e.style.backgroundImage=Array(2048).fill('none').join(',');e.style.backgroundPosition='min('+Array(512).fill('10%').join(',')+') top';return getComputedStyle(e).backgroundPositionX})()",
    }),
  });
  expect(response.status).toBe(422);
  expect(await response.text()).toContain("computed background position bytes");
});

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native background repeat variant %i",
  async (variant) => {
    const url = new URL(`background-repeat/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: `backgroundRepeatCase(${variant})` }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null)
      throw new Error("Missing background repeat values");
    expect(Object.keys(value)).toHaveLength(66);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test("real HTTP → workerd → Wasm: image errors preserve repeat scalars and conservative tiling support", async () => {
  const url = new URL("background-repeat/0", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression:
        "(()=>{document.body.style.cssText='background-image:url(https://example.test/a),url(https://example.test/b);background-repeat:space round';return {repeat:getComputedStyle(document.body).backgroundRepeat,tiling:CSS.supports('background-repeat','space round')}})()",
    }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    value: { repeat: "space round, space round", tiling: false },
  });
  const geometry = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression:
        "(()=>{document.body.style.cssText='background-image:url(https://example.test/a);background-repeat:space round';return document.body.getBoundingClientRect()})()",
    }),
  });
  expect(geometry.status).toBe(422);
  expect(await geometry.text()).toContain("URL provenance and loading");
});

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

test.each([
  ["2ex", "relative query length"],
  ["calc(infinity * 1px)", "non-finite value"],
  [`calc(${Array(40).fill("min(10%, 2px)").join(" + ")})`, "background position nesting"],
] as const)(
  "real HTTP → workerd → Wasm: unsupported sizing %s fails explicitly",
  async (size, detail) => {
    const url = new URL("background-size/0", origin.url).href;
    const failed = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url,
        expression: `(()=>{document.body.style.backgroundSize=${JSON.stringify(size)};return getComputedStyle(document.body).backgroundSize})()`,
      }),
    });
    expect(failed.status).toBe(422);
    expect(await failed.text()).toContain(detail);
    const healthy = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "backgroundSizeCase(0)" }),
    });
    expect(healthy.status).toBe(200);
  },
);

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

test("real HTTP → workerd → Wasm: expanded sizing expression copies consume work", async () => {
  const url = new URL("background-size/0", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression:
        "(()=>{const e=document.body;e.style.backgroundImage=Array(512).fill('none').join(',');e.style.backgroundSize='min('+Array(32).fill('10%,2px').join(',')+')';return getComputedStyle(e).backgroundSize})()",
    }),
  });
  expect(response.status).toBe(422);
  expect(await response.text()).toContain("DOM operations");
  const healthy = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression: "backgroundSizeCase(0)" }),
  });
  expect(healthy.status).toBe(200);
});

test("real HTTP → workerd → Wasm: unsupported sizing geometry stays explicit", async () => {
  const url = new URL("background-size/0", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression:
        "(()=>{document.body.style.backgroundSize='2ex';return document.body.getBoundingClientRect()})()",
    }),
  });
  expect(response.status).toBe(422);
  expect(await response.text()).toContain("relative query length");
});

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native background layer context variant %i",
  async (variant) => {
    const url = new URL(`background-layers/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: `backgroundLayersCase(${variant})` }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null)
      throw new Error("Missing background layer values");
    expect(Object.keys(value)).toHaveLength(143);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test("real HTTP → workerd → Wasm: image errors preserve layer context scalars and conservative paint support", async () => {
  const url = new URL("background-layers/0", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression:
        "(()=>{document.body.style.cssText='background-image:url(https://example.test/a),url(https://example.test/b);background-attachment:fixed,local;background-origin:content-box;background-clip:border-area';const s=getComputedStyle(document.body);return {attachment:s.backgroundAttachment,origin:s.backgroundOrigin,clip:s.backgroundClip,paint:['background-attachment','background-origin','background-clip'].map(name=>CSS.supports(name,s.getPropertyValue(name)))}})()",
    }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    value: {
      attachment: "fixed, local",
      origin: "content-box, content-box",
      clip: "border-area, border-area",
      paint: [false, false, false],
    },
  });
});

test.each([
  ["background-attachment", "local"],
  ["background-origin", "content-box"],
  ["background-clip", "text"],
] as const)(
  "real HTTP → workerd → Wasm: background context %s budget and recovery",
  async (name, value) => {
    const url = new URL("background-layers/0", origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url,
        expression: `(()=>{document.body.style.setProperty(${JSON.stringify(name)},Array(10001).fill(${JSON.stringify(value)}).join(','));return getComputedStyle(document.body).getPropertyValue(${JSON.stringify(name)})})()`,
      }),
    });
    expect(response.status).toBe(422);
    expect(await response.text()).toContain(
      name === "background-origin" ? "CSS input limit" : "DOM operations",
    );
    const healthy = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "backgroundLayersCase(0)" }),
    });
    expect(healthy.status).toBe(200);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native font family variant %i",
  async (variant) => {
    const url = new URL(`font-family/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: `fontFamilyCase(${variant})` }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing font family values");
    expect(Object.keys(value)).toHaveLength(75);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test("real HTTP → workerd → Wasm: font family scalar and default native text geometry", async () => {
  const url = new URL("font-family/0", origin.url).href;
  const request = (expression: string) =>
    worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression }),
    });
  const scalar = await request(
    "(()=>{document.body.innerHTML='<div style=\"font-family:serif\">Actual text</div>';const e=document.body.firstElementChild;return {family:getComputedStyle(e).fontFamily,support:CSS.supports('font-family','serif')}})()",
  );
  expect(scalar.status).toBe(200);
  expect(await scalar.json()).toMatchObject({ value: { family: "serif", support: false } });
  const geometry = await request(
    "(()=>{document.body.innerHTML='<div style=\"font-family:serif\">Actual text</div>';return document.body.firstElementChild.getBoundingClientRect().height})()",
  );
  expect(geometry.status).toBe(200);
  expect(await geometry.json()).toMatchObject({ value: 18 });
});

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

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native computed display and blockification variant %i",
  async (variant) => {
    const url = new URL(`display/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: `displayCase(${variant})` }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing display values");
    expect(Object.keys(value)).toHaveLength(105);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each(["inline", "inline-block", "flow-root", "table-row", "ruby", "list-item"])(
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

test.each(Array.from({ length: 256 }, (_, index) => [Math.floor(index / 4), index % 4]))(
  "real HTTP → workerd → Wasm: native HTML box categories variant %i group %i",
  async (variant, group) => {
    const url = new URL(`html-boxes/${variant}`, origin.url).href;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: `htmlBoxesCase(${variant},${group})` }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing HTML box values");
    expect(Object.keys(value)).toHaveLength(group === 3 ? 24 : 51);
    expect(Reflect.get(value, "externalMutation")).toBe(true);
    for (const check of Object.values(value)) {
      expect(check).toBe(true);
    }
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

test.each([
  ["CSSOM sheets", "for(let i=0;i<257;i++)new CSSStyleSheet();"],
  ["CSSOM state", "const s=new CSSStyleSheet();for(let i=0;i<4097;i++)s.insertRule('div{}',i);"],
  ["CSSOM input", "new CSSStyleSheet().insertRule('div{'+ ' '.repeat(65537)+'}');"],
])(
  "real HTTP → workerd → Wasm: constructed stylesheet %s limit and recovery",
  async (reason, setup) => {
    const url = new URL("constructed-sheets/0", origin.url).href;
    const request = (expression: string) =>
      worker.dispatchFetch("https://nimbo.test/scrape", {
        method: "POST",
        headers: { authorization: "Bearer test-secret" },
        body: JSON.stringify({ url, expression }),
      });
    const failed = await request(`(()=>{${setup}return true})()`);
    expect(failed.status).toBe(422);
    expect(await failed.text()).toContain(reason);
    const recovered = await request("new CSSStyleSheet().cssRules.length");
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ value: 0 });
  },
);

test("real HTTP → workerd → Wasm: constructed stylesheet unsupported scope stays explicit", async () => {
  const url = new URL("constructed-sheets/0", origin.url).href;
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression:
        "(()=>{const s=new CSSStyleSheet();const failures=[];for(const fn of [()=>s.insertRule('@media all {div{width:1px}}'),()=>new CSSStyleSheet({disabled:true}),()=>s.insertRule('div{& span {width:1px}}')]){try{fn();failures.push('missing')}catch(e){failures.push(e.name)}}return {failures,length:s.cssRules.length}})()",
    }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    value: { failures: ["NotSupportedError", "NotSupportedError", "NotSupportedError"], length: 0 },
  });
});

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: adopted stylesheet variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`adopted-sheets/${variant}`, origin.url).href,
        expression: `adoptedSheetsCase(${variant})`,
      }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing adoption checks");
    expect(Object.keys(value)).toHaveLength(36);
    for (const check of Object.values(value)) expect(check).toBe(true);
  },
);

test.each([
  ["CSSOM adopted sheets", "document.adoptedStyleSheets=Array(257).fill(s);"],
  [
    "stylesheet total bytes",
    "s.insertRule('#target {color:red;--payload:'+ 'x'.repeat(60000)+'}');document.adoptedStyleSheets=Array(5).fill(s);getComputedStyle(document.getElementById('target')).color;",
  ],
])(
  "real HTTP → workerd → Wasm: adopted stylesheet %s limit and recovery",
  async (reason, setup) => {
    const url = new URL("adopted-sheets/0", origin.url).href;
    const request = (expression: string) =>
      worker.dispatchFetch("https://nimbo.test/scrape", {
        method: "POST",
        headers: { authorization: "Bearer test-secret" },
        body: JSON.stringify({ url, expression }),
      });
    const failed = await request(`(()=>{const s=new CSSStyleSheet();${setup}return true})()`);
    expect(failed.status).toBe(422);
    expect(await failed.text()).toContain(reason);
    const recovered = await request("document.adoptedStyleSheets.length");
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ value: 0 });
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: 5000-row DOM and JavaScript variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`large-dom/${variant}`, origin.url).href,
        expression: largeDomExpression(variant),
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      value: {
        value: "row",
        changed: `updated-${variant}`,
        count: 5000,
        keys: 5000,
        retained: true,
        remaining: 4999,
        last: "row",
      },
    });
  },
);

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

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: custom boxes and contents variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`custom-boxes/${variant}`, origin.url).href,
        expression: `customBoxesCase(${variant})`,
      }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing result");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing checks");
    expect(Object.keys(value)).toHaveLength(26);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each([
  { count: 600, nested: false, maxLayoutNodes: 512, reason: "layout tree: nodes" },
  { count: 130, nested: true, maxLayoutNodes: 2048, reason: "layout tree: depth" },
])(
  "real HTTP → workerd → Wasm: contents preserves $reason and recovery",
  async ({ count, nested, maxLayoutNodes, reason }) => {
    const url = new URL("custom-boxes/0", origin.url).href;
    const expression = `(()=>{document.body.innerHTML='';let parent=document.body;for(let i=0;i<${count};i++){const e=document.createElement('x-flat');e.style.display='contents';parent.append(e);${nested ? "parent=e;" : ""}}return document.body.getBoundingClientRect().width})()`;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression, maxLayoutNodes }),
    });
    expect(response.status).toBe(422);
    expect(await response.text()).toContain(reason);
    const recovered = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url,
        expression:
          "(()=>{document.body.innerHTML='<div style=\"width:11px;height:7px\"></div>';return document.body.firstElementChild.getBoundingClientRect().width})()",
      }),
    });
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ value: 11 });
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: positioned boxes variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`positioned-boxes/${variant}`, origin.url).href,
        expression: `positionedBoxesCase(${variant})`,
      }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing result");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing checks");
    expect(Object.keys(value)).toHaveLength(25);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each([
  { css: "position:absolute;top:0;width:10px;height:5px", reason: "absolute static position" },
  { css: "position:fixed;left:0;width:10px;height:5px", reason: "absolute static position" },
])(
  "real HTTP → workerd → Wasm: positioned boxes reject $css and recover",
  async ({ css, reason }) => {
    const url = new URL("positioned-boxes/0", origin.url).href;
    const expression = `(()=>{document.body.innerHTML='';const e=document.createElement('div');e.style.cssText=${JSON.stringify(css)};document.body.append(e);return e.getBoundingClientRect().width})()`;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression }),
    });
    expect(response.status).toBe(422);
    expect(await response.text()).toContain(reason);
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
  "real HTTP → workerd → Wasm: namespaced element variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`namespaced-elements/${variant}`, origin.url).href,
        expression: `namespacedElementsCase(${variant})`,
      }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing result");
    const checks: unknown = Reflect.get(result, "value");
    if (typeof checks !== "object" || checks === null) throw new Error("Missing checks");
    expect(Object.keys(checks)).toHaveLength(38);
    expect(Object.values(checks).every((value) => value === true)).toBe(true);
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

test.each(
  responseEncodingCases.flatMap((fixture, index) =>
    Array.from({ length: 8 }, (_, variant) => ({ fixture, index, variant })),
  ),
)(
  "real HTTP → workerd → Wasm: response encoding $fixture.name variant $variant",
  async ({ fixture, index, variant }) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`response-encoding/${index}/${variant}`, origin.url).href,
        expression: "({dom:document.getElementById('out').textContent,script:encodingResult})",
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      value: { dom: fixture.expected, script: fixture.expected },
    });
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

test("real HTTP → workerd → Wasm: URL limits preserve query state and recover", async () => {
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url: new URL("urls/0", origin.url).href,
      expression: "urlsLimitsCase()",
    }),
  });
  expect(response.status).toBe(200);
  const result: unknown = await response.json();
  if (typeof result !== "object" || result === null) throw new Error("Missing result");
  expect(Reflect.get(result, "value")).toEqual({
    boundedURL: true,
    boundedQuery: true,
    statePreserved: true,
    recovered: true,
  });
});

test.each(Array.from({ length: 64 }, (_, index) => index))(
  "real HTTP → workerd → Wasm: document and transport cookie variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`cookies/${variant}`, origin.url).href,
        expression: `cookiesCase(${variant})`,
      }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing result");
    expect(Reflect.get(result, "value")).toEqual({
      server: true,
      accumulate: true,
      httpOnly: true,
      domain: true,
      pathHidden: true,
      pathOrder: true,
      expiration: true,
      attributes: true,
      binding: true,
      httpShared: true,
      defaultPath: true,
      explicitPath: true,
      serverUpdate: true,
      variant: true,
    });
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
  "real HTTP → workerd → Wasm: sticky geometry variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`sticky-geometry/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing result");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing checks");
    expect(Object.keys(value)).toHaveLength(28);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each(["scrollTop", "clientHeight", "offsetParent"])(
  "real HTTP → workerd → Wasm: viewport geometry remains explicit for %s",
  async (property) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL("sticky-geometry/0", origin.url).href,
        expression: `document.documentElement.${property}`,
      }),
    });
    expect(response.status).toBe(422);
    expect(await response.text()).toContain("viewport geometry");
    const recovered = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL("sticky-geometry/0", origin.url).href,
        expression: "Object.values(globalThis.comparison).every(Boolean)",
      }),
    });
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ value: true });
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: z-index computed state variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`z-index/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing result");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing checks");
    expect(Object.keys(value)).toHaveLength(39);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);
test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: real-clock CSS transitions variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`transitions/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing result");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing checks");
    expect(Object.keys(value)).toHaveLength(25);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test("real HTTP → workerd → Wasm: unsupported transition interpolation fails and releases the page", async () => {
  const url = new URL("outlines/0", origin.url).href;
  const failed = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url,
      expression:
        "(()=>{const b=document.body;b.style.cssText='color:red;transition:color 1s';getComputedStyle(b).color;b.style.color='blue';return getComputedStyle(b).color})()",
    }),
  });
  expect(failed.status).toBe(422);
  expect(await failed.text()).toContain("transition interpolation: color");
  const healthy = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression: "document.body.style.transitionDuration" }),
  });
  expect(healthy.status).toBe(200);
});

test.each([
  ...Array.from({ length: 64 }, (_, variant) => ({ route: "logical-spacing", count: 45, variant })),
  ...Array.from({ length: 64 }, (_, variant) => ({
    route: "logical-spacing-transitions",
    count: 11,
    variant,
  })),
])("real HTTP → workerd → Wasm: logical spacing contract %j", async ({ route, count, variant }) => {
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({
      url: new URL(`${route}/${variant}`, origin.url).href,
      expression: "globalThis.comparison",
    }),
  });
  expect(response.status).toBe(200);
  const result: unknown = await response.json();
  if (typeof result !== "object" || result === null) throw new Error("Missing result");
  const value: unknown = Reflect.get(result, "value");
  if (typeof value !== "object" || value === null) throw new Error("Missing checks");
  expect(Object.keys(value)).toHaveLength(count);
  expect(Object.values(value).every((check) => check === true)).toBe(true);
});

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
  "real HTTP → workerd → Wasm: contextual box lengths configured media variant %i",
  async (variant) => {
    const media = {
      width: 321 + variant * 8,
      height: 217 + variant * 7,
      defaultFontSize: 10 + (variant % 16),
    };
    const expression = `(()=>{document.documentElement.style.fontSize='initial';document.body.style.fontSize='inherit';const box=document.createElement('div');box.style.cssText='width:2rem;height:10vh';document.body.append(box);const rect=box.getBoundingClientRect();return Math.abs(rect.width-${media.defaultFontSize * 2})<.01&&Math.abs(rect.height-${media.height / 10})<.01&&innerWidth===${media.width}&&innerHeight===${media.height}&&getComputedStyle(document.documentElement).fontSize==='${media.defaultFontSize}px'})()`;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL("contextual-box-lengths/0", origin.url).href,
        expression,
        media,
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ value: true });
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

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: SVG viewport variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`svg-viewport/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing result");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing checks");
    expect(Object.keys(value)).toHaveLength(39);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: classic script modes variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`script-modes/${variant}`, origin.url).href,
        expression: scriptModesExpression,
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

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: animation frame callbacks variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`animation-frames/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing result");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing checks");
    expect(Object.keys(value)).toHaveLength(32);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

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
  "real HTTP → workerd → Wasm: document stylesheet list variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`document-stylesheets/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing result");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing checks");
    expect(Object.keys(value)).toHaveLength(25);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: Window named properties variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`window-named/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) throw new Error("Missing result");
    const value: unknown = Reflect.get(result, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing checks");
    expect(Object.keys(value)).toHaveLength(34);
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
  "real HTTP → workerd → Wasm: DOM operation budget variant %i",
  async (variant) => {
    const url = new URL(`dom-budget/${variant}`, origin.url).href;
    const expression = `(() => { const target=document.getElementById('example'); let valid=true; for(let i=0;i<12000+${variant};i++)valid=valid && target.getAttribute('data-index')===String(${variant}); return {valid,scriptExecuted}; })()`;
    const send = (maxDomOperations?: number) =>
      worker.dispatchFetch("https://nimbo.test/scrape", {
        method: "POST",
        headers: { authorization: "Bearer test-secret" },
        body: JSON.stringify({ url, expression, maxDomOperations }),
      });
    const configured = await send(20_000);
    expect(configured.status).toBe(200);
    expect(await configured.json()).toEqual({
      url,
      engine: "rust-wasm-quickjs",
      value: { valid: true, scriptExecuted: true },
    });
    const reject = async (budget?: number) => {
      const rejected = await send(budget);
      expect(rejected.status).toBe(422);
      expect(await rejected.text()).toContain("DOM operations");
    };
    // The shared isolate admits one scrape at a time.
    await reject();
    await reject(100);
  },
);

test.each([0, -1, 1.5, 1_000_001, "20000", true, null, {}])(
  "real HTTP → workerd → Wasm: invalid DOM operation budget %j fails before navigation",
  async (maxDomOperations) => {
    const url = new URL("dom-budget/0", origin.url).href,
      count = requests.length;
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: "true", maxDomOperations }),
    });
    expect(response.status).toBe(400);
    expect(requests.length).toBe(count);
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: native font shaping variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`font-shaping/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      value: Object.fromEntries(
        [
          "a",
          "b",
          "pair",
          "kerning",
          "space",
          "euro",
          "accent",
          "decomposed",
          "empty",
          "repeat",
          "white",
          "newLine",
          "sameFont",
          "invalidIgnored",
          "metricsBrand",
          "metricsReadonly",
          "requiredArgument",
          "restoreFont",
          "binaryFont",
          "binaryLoaded",
          "fontOwnsBytes",
          "hiddenNativeBridge",
          "privateFontState",
          "resetFont",
          "resizeFont",
          "ignoredLineHeight",
          "metricsReceiver",
        ].map((name) => [name, true]),
      ),
    });
  },
);

test.each([
  ["context.measureText('C').width", "font glyph fallback"],
  ["context.measureText('שלום').width", "text script itemization or bidi"],
  ["context.measureText('A'.repeat(1025)).width", "font shaping limit"],
  [
    "context.measureText('A'.repeat(1024)); for(let i=0;i<64;i++)context.measureText('A'.repeat(1024));",
    "font shaping limit",
  ],
  ["context.font='bold 16px NimboShape'", "canvas font synthesis or variants"],
  ["context.font='1em NimboShape'", "canvas contextual font size"],
  ["context.font='4097px NimboShape'", "font size"],
  ["context.measureText('A').actualBoundingBoxLeft", "text bounding box metrics"],
  ["document.fonts.clear(); context.measureText('A').width", "font glyph fallback"],
] as const)("real HTTP → workerd → Wasm: font shaping boundary %s", async (expression, reason) => {
  const url = new URL("font-shaping/0", origin.url).href;
  const run = (source: string) =>
    worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ url, expression: source }),
    });
  const response = await run(
    `(async()=>{await globalThis.comparison; const canvas = new OffscreenCanvas(8,8); const context=canvas.getContext('2d'); context.font='16px NimboShape'; ${expression}; return true;})()`,
  );
  expect(response.status).toBe(422);
  const error: unknown = expect.stringContaining(reason);
  expect(await response.json()).toMatchObject({ error });
  const healthy = await run("globalThis.comparison");
  expect(healthy.status).toBe(200);
  expect(await healthy.json()).toMatchObject({
    value: { pair: true, kerning: true, accent: true, decomposed: true },
  });
});

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

const textLayoutBoundaries = [
  [
    "anonymous preformatted text",
    "document.querySelector('div').style.display='flex';document.querySelector('div').style.whiteSpace='pre'",
    "text white-space",
  ],
  [
    "anonymous contents text",
    "document.querySelector('div').style.display='contents';document.body.style.display='flex'",
    "anonymous text through display:contents",
  ],
  ["font descriptor", "[...document.fonts][0].sizeAdjust='125%'", "font descriptor sizeAdjust"],
  ["pre whitespace", "document.querySelector('div').style.whiteSpace='pre'", "text white-space"],
  [
    "font stretch",
    "document.querySelector('div').style.fontStretch='condensed'",
    "text font synthesis or spacing",
  ],
  ["mixed inline", "document.querySelector('div').innerHTML='A<span>B</span>'", "text shaping"],
  [
    "generated box",
    "const s=document.createElement('style');s.textContent='div::before{content:\"\";display:block;width:10px;height:10px}';document.head.append(s)",
    "generated content in text formatting context",
  ],
  [
    "shape input",
    "document.querySelector('div').textContent='A'.repeat(1025)",
    "layout text shaping",
  ],
] as const;

const requestTextLayout = (expression: string) =>
  worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url: new URL("text-layout/0", origin.url).href, expression }),
  });

test.each(textLayoutBoundaries)(
  "native text layout rejects unsupported %s and recovers on a fresh page",
  async (_name, mutation, message) => {
    const rejected = await requestTextLayout(
      `(async()=>{await globalThis.comparison;try{${mutation};document.querySelector('div').getBoundingClientRect();return 'unexpected success';}catch(error){return String(error);}})()`,
    );
    expect(rejected.status).toBe(200);
    const result: unknown = await rejected.json();
    expect(
      typeof result === "object" && result !== null ? Reflect.get(result, "value") : undefined,
    ).toContain(message);
    const recovered = await requestTextLayout("globalThis.comparison");
    expect(recovered.status).toBe(200);
    const body: unknown = await recovered.json();
    expect(body).toMatchObject({
      value: { wide: true, ligature: true, wrap: true, canonical: true },
    });
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: public font profile variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`font-profile/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      value: Object.fromEntries(
        [
          "regular",
          "bold",
          "italic",
          "boldItalic",
          "light",
          "medium",
          "semibold",
          "positive",
          "negative",
          "combining",
          "ligatureSpacing",
          "characterSpacing",
          "fontRemoval",
          "fontSize",
        ].map((key) => [key, true]),
      ),
    });
  },
);
test("native text layout uses real normal metrics and invalidates cleared fonts", async () => {
  const r = await requestTextLayout(
    `(async()=>{await globalThis.comparison;const e=document.querySelector('div');e.textContent='AB';e.style.lineHeight='normal';const loaded=e.getBoundingClientRect().height;document.fonts.clear();const fallback=e.getBoundingClientRect().height;return {loaded,fallback,width:getComputedStyle(e).width};})()`,
  );
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({ value: { loaded: 16, fallback: 18, width: "100px" } });
});

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: order layout variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`order-layout/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      value: Object.fromEntries(
        [
          "flex",
          "stable",
          "computed",
          "mutation",
          "reverse",
          "block",
          "grid",
          "generated",
          "contents",
        ].map((key) => [key, true]),
      ),
    });
  },
);

test("real HTTP → workerd → Wasm: default font text reaches intersection callbacks", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const expression =
    "new Promise(resolve=>{const el=document.createElement('div');el.textContent='real text';document.body.appendChild(el);const observer=new IntersectionObserver(entries=>{observer.disconnect();resolve({height:el.getBoundingClientRect().height,intersecting:entries[0].isIntersecting,ratio:entries[0].intersectionRatio});});observer.observe(el);})";
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    value: { height: 18, intersecting: true, ratio: 1 },
  });
});
test("real HTTP → workerd → Wasm: default fonts collapse tabs and line breaks", async () => {
  const url = new URL("geometry-empty", origin.url).href;
  const expression =
    "(()=>{const e=document.createElement('div');e.style.cssText='font:16px/1.5 serif;width:max-content';e.textContent='A\\tB';document.body.append(e);const a=e.getBoundingClientRect();e.textContent='A\\nB';const b=e.getBoundingClientRect();e.textContent='A B';const c=e.getBoundingClientRect();return {height:a.height,tab:a.width===c.width,newline:b.width===c.width};})()";
  const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url, expression }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ value: { height: 24, tab: true, newline: true } });
});

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
const requestAuthoredButton = (expression: string) =>
  worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url: new URL("authored-button/0", origin.url).href, expression }),
  });

test.each([
  [
    "button defaults",
    "for(const s of document.querySelectorAll('style'))s.remove();const b=document.createElement('button');b.style.display='flex';document.body.append(b);return b.getBoundingClientRect()",
    "button UA default",
  ],
  [
    "partial font variant",
    "const e=document.createElement('div');e.style.fontVariantCaps='small-caps';e.textContent='AB';document.body.append(e);return e.getBoundingClientRect()",
    "text font features or variations",
  ],
  [
    "font feature setting",
    "const e=document.createElement('div');e.style.fontFeatureSettings='\"kern\" 0';e.textContent='AB';document.body.append(e);return e.getBoundingClientRect()",
    "text font features or variations",
  ],
  [
    "font variation setting",
    "const e=document.createElement('div');e.style.fontVariationSettings='\"wght\" 600';e.textContent='AB';document.body.append(e);return e.getBoundingClientRect()",
    "text font features or variations",
  ],
])("native authored controls reject unsupported %s and recover", async (_name, setup, message) => {
  const failed = await requestAuthoredButton("(()=>{" + setup + "})()");
  expect(failed.status).toBe(422);
  expect(await failed.text()).toContain(message);
  const healthy = await requestAuthoredButton("globalThis.comparison");
  expect(healthy.status).toBe(200);
  expect(await healthy.json()).toMatchObject({
    value: { base: true, natural: true, inherit: true, disabled: true },
  });
});

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: font settings variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`font-settings/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      value: Object.fromEntries(
        [
          "normal",
          "tag",
          "on",
          "off",
          "one",
          "zero",
          "list",
          "invalid",
          "variationNormal",
          "weight",
          "slant",
          "inherit",
        ].map((key) => [key, true]),
      ),
    });
  },
);

test("native font settings reject negative feature indices without changing real geometry", async () => {
  const response = await requestAuthoredButton(
    "(()=>{const e=document.createElement('div');e.style.cssText='width:max-content;font-feature-settings:normal';e.textContent='AB';document.body.append(e);const before=e.getBoundingClientRect().width;e.style.fontFeatureSettings='\"kern\" -1';return {setting:e.style.fontFeatureSettings,stable:e.getBoundingClientRect().width===before};})()",
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ value: { setting: "normal", stable: true } });
});

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: text baseline variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`text-baseline/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      value: Object.fromEntries(
        [
          "flex",
          "grid",
          "anonymous",
          "synthesis",
          "edges",
          "nested",
          "wrap",
          "normal",
          "fractional",
          "mutation",
        ].map((key) => [key, true]),
      ),
    });
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
const requestAtomicInline = (expression: string) =>
  worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url: new URL("atomic-inline/0", origin.url).href, expression }),
  });
test.each([
  [
    "mixed inline boxes",
    "const p=document.createElement('section');for(let i=0;i<2;i++){const e=document.createElement('div');e.style.cssText='display:inline-flex;width:20px;height:20px';p.append(e);}document.body.append(p);return p.getBoundingClientRect()",
    "mixed atomic inline formatting",
  ],
  [
    "vertical alignment",
    "const p=document.createElement('section'),e=document.createElement('div');e.style.cssText='display:inline-flex;vertical-align:top;width:20px;height:20px';p.append(e);document.body.append(p);return p.getBoundingClientRect()",
    "atomic inline vertical alignment",
  ],
  [
    "unimplemented control appearance",
    "const p=document.createElement('section'),e=document.createElement('button');e.style.cssText='display:inline-flex;appearance:textfield;width:20px;height:20px';p.append(e);document.body.append(p);return p.getBoundingClientRect()",
    "appearance",
  ],
  [
    "inline grid",
    "const p=document.createElement('section'),e=document.createElement('div');e.style.cssText='display:inline-grid;width:20px;height:20px';p.append(e);document.body.append(p);return p.getBoundingClientRect()",
    "display formatting",
  ],
])(
  "native atomic inline flow rejects unsupported %s and recovers",
  async (_name, setup, message) => {
    const failed = await requestAtomicInline("(()=>{" + setup + "})()");
    expect(failed.status).toBe(422);
    expect(await failed.text()).toContain(message);
    const healthy = await requestAtomicInline("globalThis.comparison");
    expect(healthy.status).toBe(200);
    expect(await healthy.json()).toMatchObject({
      value: { text: true, box: true, button: true, shrink: true },
    });
  },
);

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

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: clip geometry variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`clip-geometry/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      value: Object.fromEntries(
        [
          "hiddenTarget",
          "rootClip",
          "empty",
          "emptySeparated",
          "degenerate",
          "inset",
          "box",
          "mutation",
          "none",
          "polygon",
          "calc",
          "em",
          "viewport",
          "escaped",
          "nonContainingRoot",
        ].map((key) => [key, true]),
      ),
    });
  },
);

test.each(["circle(25%)", 'url("#shape")', "inset(10%) content-box", "inset(10% round 4px)"])(
  "real HTTP → workerd → Wasm: unsupported clip shape %s and recovery",
  async (css) => {
    const url = new URL("clip-geometry/0", origin.url).href;
    const request = (expression: string) =>
      worker.dispatchFetch("https://nimbo.test/scrape", {
        method: "POST",
        headers: { authorization: "Bearer test-secret" },
        body: JSON.stringify({ url, expression }),
      });
    const failed = await request(
      `(()=>{const e=document.createElement('div');e.style.clipPath=${JSON.stringify(css)};document.body.append(e);return e.getBoundingClientRect();})()`,
    );
    expect(failed.status).toBe(422);
    expect(await failed.text()).toContain("clip-path");
    const healthy = await request("globalThis.comparison");
    expect(healthy.status).toBe(200);
    expect(await healthy.json()).toMatchObject({
      value: { inset: true, polygon: true, calc: true },
    });
  },
);

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: positioned generated variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`positioned-generated/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      value: Object.fromEntries(
        [
          "own",
          "flow",
          "rootOverflow",
          "percentage",
          "negative",
          "flex",
          "ancestor",
          "mutation",
          "stretch",
          "grid",
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
  [
    "static-position",
    'content:"";display:block;position:absolute;width:9px;height:7px',
    "absolute static position",
  ],
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

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: Unicode text-transform variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`text-transform/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      value: Object.fromEntries(
        [
          "upperLatin",
          "lowerLatin",
          "turkishUpper",
          "turkishLower",
          "languageInheritance",
          "emptyLanguage",
          "inherit",
          "unset",
          "initial",
          "none",
          "mutation",
          "wrap",
          "spacing",
        ].map((key) => [key, true]),
      ),
    });
  },
);

test.each(["capitalize", "full-width", "full-size-kana"])(
  "real HTTP → workerd → Wasm: unsupported text-transform %s and recovery",
  async (mode) => {
    const url = new URL("text-transform/0", origin.url).href;
    const request = (expression: string) =>
      worker.dispatchFetch("https://nimbo.test/scrape", {
        method: "POST",
        headers: { authorization: "Bearer test-secret" },
        body: JSON.stringify({ url, expression }),
      });
    const failed = await request(
      `(()=>{const e=document.createElement('div');e.style.textTransform=${JSON.stringify(mode)};e.textContent='sample';document.body.append(e);return e.getBoundingClientRect();})()`,
    );
    expect(failed.status).toBe(422);
    expect(await failed.text()).toContain("text-transform");
    const healthy = await request("globalThis.comparison");
    expect(healthy.status).toBe(200);
    expect(await healthy.json()).toMatchObject({
      value: { upperLatin: true, languageInheritance: true },
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

test.each(Array.from({ length: 64 }, (_, variant) => variant))(
  "real HTTP → workerd → Wasm: box shadow geometry variant %i",
  async (variant) => {
    const response = await worker.dispatchFetch("https://nimbo.test/scrape", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        url: new URL(`box-shadow-geometry/${variant}`, origin.url).href,
        expression: "globalThis.comparison",
      }),
    });
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) throw new Error("Missing response");
    const value: unknown = Reflect.get(body, "value");
    if (typeof value !== "object" || value === null) throw new Error("Missing shadow checks");
    expect(Object.keys(value)).toHaveLength(16);
    expect(Object.values(value).every((check) => check === true)).toBe(true);
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
