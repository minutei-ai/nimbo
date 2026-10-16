// Shared origin, engine Worker and fixtures for the split browser-live tests.
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
import { afterAll, beforeAll, expect } from "bun:test";
import { join } from "node:path";
import { TextDecoder as ReferenceTextDecoder } from "node:util";
import { Miniflare } from "miniflare";

export const storageScript = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/storage.txt"),
).text();

export const mediaScript = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/media.txt"),
).text();

export const tokenScript = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/tokens.txt"),
).text();

export const htmlElementScript = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/html-elements.txt"),
).text();

export const customElementScript = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/custom-elements.txt"),
).text();

export const encodingScript = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/encoding.txt"),
).text();

export const anchorScript = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/anchors.txt"),
).text();

export const styleScript = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/styles.txt"),
).text();

export const styleVariableScript = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/style-variables.txt"),
).text();

export const geometryScript = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/geometry.txt"),
).text();

export const cascadeScript = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/cascade.txt"),
).text();

export const variablesScript = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/variables.txt"),
).text();

export const insertionScript = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/node-insertion.txt"),
).text();

export const intersectionScript = await Bun.file(
  join(import.meta.dir, "../crates/engine/tests/fixtures/intersections.txt"),
).text();

export const requests: string[] = [];

export const comparisonBinary = process.env.NIMBO_COMPARE_OBSCURA_BINARY;

export async function comparePage(binary: string, url: string): Promise<unknown> {
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

export const expressionFor = (variant: number) => `(async () => {
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

export const treeExpressionFor = (variant: number) => `(() => {
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

export const collectionExpressionFor = (variant: number) => `(() => {
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
    () => NodeList.prototype.entries.call(null), () => elements.namedItem(Symbol('invalid'))]) {
    try { action(); errors.push(false); } catch (error) { errors.push(error instanceof TypeError); }
  }
  const guarded = errors.length === 7 && errors.every(Boolean) && NodeList.prototype.entries.call({}).next().done;
  return {kinds, identity, index, names, reflection, readonly, iteration, callback,
    live, removed, renamed, reparent, cleared, fragmentLive, transferred, guarded};
})()`;

export const eventExpressionFor = (variant: number) => `(() => {
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

export const timerExpressionFor = (variant: number) => `(async () => {
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

export const origin = Bun.serve({
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
    const binary = binaryFixture(path, request);
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
      return new Response(
        `<base href="https://external.example.com/"><script>globalThis.denied=0;document.addEventListener('error',()=>denied++,true)</script>${script}`,
        {
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      );
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
          moduleOrder.push('entry'); moduleStates.push(document.readyState); bump(); await Promise.all([new Promise(resolve => setTimeout(resolve, 15)), new Promise(resolve => addEventListener('load', resolve, {once:true}))]);
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

export const worker = new Miniflare({
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

export const encodingExpected = Object.fromEntries(
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

export function codecResults(label: string, fatal: boolean, chunks: number[][]): string[] {
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

export const anchorExpected = Object.fromEntries(
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

export const linkParts = [
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

export const stylesExpected = Object.fromEntries(
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

export const styleVariablesExpected = Object.fromEntries(
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

export const geometryExpected = Object.fromEntries(
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

export const cascadeExpected = Object.fromEntries(
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

export const variablesExpected = Object.fromEntries(
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

export const intersectionExpected = Object.fromEntries(
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

export const intersectionRecovery =
  "new Promise(resolve=>{const el=document.createElement('div');el.style.cssText='width:20px;height:20px';document.body.appendChild(el);const observer=new IntersectionObserver(entries=>{observer.disconnect();resolve(entries.length===1 && entries[0].isIntersecting);});observer.observe(el);})";

export const insertionExpected = Object.fromEntries(
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

export const externalStyleExpected = Object.fromEntries(
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

export const sheetPromise = (path: string) =>
  `new Promise(resolve=>{const link=document.createElement('link');link.setAttribute('rel','stylesheet');link.setAttribute('href',${JSON.stringify(path)});link.addEventListener('load',()=>resolve(true),{once:true});document.head.appendChild(link);})`;

export const supportsExpected = Object.fromEntries(
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

export const datasetExpected = Object.fromEntries(
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

export const textLayoutBoundaries = [
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
  [
    "mixed inline text flow",
    "document.querySelector('div').innerHTML='A<span style=white-space:pre>B</span>'",
    "mixed inline text flow",
  ],
  [
    "generated box",
    "const s=document.createElement('style');s.textContent='div::before{content:\"\";display:block;width:10px;height:10px}';document.head.append(s)",
    "generated content in text formatting context",
  ],
  [
    "text source",
    "document.querySelector('div').textContent='A'.repeat(65537)",
    "layout text source",
  ],
] as const;

export const requestTextLayout = (expression: string) =>
  worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url: new URL("text-layout/0", origin.url).href, expression }),
  });

export const requestAuthoredButton = (expression: string) =>
  worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url: new URL("authored-button/0", origin.url).href, expression }),
  });

export const requestAtomicInline = (expression: string) =>
  worker.dispatchFetch("https://nimbo.test/scrape", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
    body: JSON.stringify({ url: new URL("atomic-inline/0", origin.url).href, expression }),
  });

export {
  attributeNamespacesFixture,
  windowNamedFixture,
  documentStylesheetsFixture,
  backgroundColorFixture,
  scriptModesFixture,
  scriptModesExpression,
  animationFramesFixture,
  layoutSnapshotFixture,
  svgViewportFixture,
  resolvedBoxValuesFixture,
  contextualBoxLengthsFixture,
  logicalSpacingFixture,
  transitionsFixture,
  zIndexFixture,
  stickyGeometryFixture,
  cookiesFixture,
  urlsFixture,
  responseEncodingCases,
  responseEncodingFixture,
  namespacedElementsFixture,
  positionedBoxesFixture,
  customBoxesFixture,
  largeDomFixture,
  largeDomExpression,
  linkGuardExpression,
  adoptedSheetsFixture,
  backgroundLayersFixture,
  fontFamilyFixture,
  displayFixture,
  htmlBoxesFixture,
  constructedSheetsFixture,
  backgroundSizeFixture,
  backgroundRepeatFixture,
  backgroundPositionFixture,
  backgroundImagesFixture,
  lineHeightFixture,
  tabsFixture,
  textAdjustFixture,
  outlineFixture,
  layoutBudgetFixture,
  logicalSizeFixture,
  canvasFixture,
  borderFixture,
  cssBudgetFixture,
  fontFixture,
  binaryFixture,
  externalStylePage,
  externalStyleResponse,
  join,
  ReferenceTextDecoder,
  Miniflare,
};
