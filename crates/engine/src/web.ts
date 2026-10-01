(() => {
  "use strict";
  const nativeDom = nimboDom;
  const nativeRequest = nimboRequest;
  const href = nimboUrl;
  const now = nimboNow;
  const timerLimit = nimboTimerLimit;
  const timerTaskLimit = nimboTimerTaskLimit;
  Reflect.deleteProperty(globalThis, "nimboDom");
  Reflect.deleteProperty(globalThis, "nimboRequest");
  Reflect.deleteProperty(globalThis, "nimboUrl");
  Reflect.deleteProperty(globalThis, "nimboNow");
  Reflect.deleteProperty(globalThis, "nimboTimerLimit");
  Reflect.deleteProperty(globalThis, "nimboTimerTaskLimit");

  const ids = new WeakMap<object, number>();
  const nodes = new Map<number, Node>();
  // Result shapes are serialized by Rust for each native operation.
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters
  const call = <T>(operation: string, id: number, arg = "", value = ""): T => {
    // The bridge owns this JSON contract; it is not page-supplied JSON.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return JSON.parse(nativeDom(operation, id, arg, value)) as T;
  };

  type Target = EventTarget | typeof globalThis;
  type Listener = ((this: Target, event: Event) => void) | { handleEvent(event: Event): void };
  type EventInit = { bubbles?: unknown; cancelable?: unknown; composed?: unknown };
  type EventState = {
    type: string;
    bubbles: boolean;
    cancelable: boolean;
    composed: boolean;
    target: Target | null;
    current: Target | null;
    phase: number;
    path: Target[];
    dispatching: boolean;
    stopped: boolean;
    immediate: boolean;
    canceled: boolean;
    passive: boolean;
    trusted: boolean;
  };
  type ListenerRecord = {
    callback: Listener;
    capture: boolean;
    once: boolean;
    passive: boolean;
    removed: boolean;
    signal: object | null;
    abort: (() => void) | null;
  };
  const events = new WeakMap<Event, EventState>();
  const listeners = new WeakMap<object, Map<string, ListenerRecord[]>>();
  const targets = new WeakSet<object>();
  const aborts = new WeakMap<
    object,
    { aborted: boolean; reason: unknown; algorithms: Set<() => void> }
  >();
  const controllers = new WeakMap<AbortController, AbortSignal>();
  const details = new WeakMap<CustomEvent, unknown>();
  const errorDetails = new WeakMap<ErrorEvent, { error: unknown; message: string }>();
  function domString(value: unknown): string {
    if (typeof value === "symbol") throw new TypeError("value must be convertible to DOMString");
    return String(value);
  }
  function eventState(event: Event): EventState {
    const state = events.get(event);
    if (!state) throw new TypeError("Illegal invocation");
    return state;
  }
  class Event {
    constructor(type: unknown, init: EventInit | null = {}) {
      if (arguments.length === 0) throw new TypeError("Event requires a type");
      if (init !== null && typeof init !== "object" && typeof init !== "function")
        throw new TypeError("invalid event dictionary");
      const state: EventState = {
        type: domString(type),
        bubbles: Boolean(init?.bubbles),
        cancelable: Boolean(init?.cancelable),
        composed: Boolean(init?.composed),
        target: null,
        current: null,
        phase: 0,
        path: [],
        dispatching: false,
        stopped: false,
        immediate: false,
        canceled: false,
        passive: false,
        trusted: false,
      };
      events.set(this, state);
      Object.defineProperty(this, "isTrusted", { get: () => state.trusted, enumerable: true });
    }
    get type() {
      return eventState(this).type;
    }
    get bubbles() {
      return eventState(this).bubbles;
    }
    get cancelable() {
      return eventState(this).cancelable;
    }
    get composed() {
      return eventState(this).composed;
    }
    get target() {
      return eventState(this).target;
    }
    get currentTarget() {
      return eventState(this).current;
    }
    get eventPhase() {
      return eventState(this).phase;
    }
    get defaultPrevented() {
      return eventState(this).canceled;
    }
    get cancelBubble() {
      return eventState(this).stopped;
    }
    set cancelBubble(value: boolean) {
      if (value) this.stopPropagation();
    }
    get returnValue() {
      return !eventState(this).canceled;
    }
    set returnValue(value: boolean) {
      if (!value) this.preventDefault();
    }
    preventDefault() {
      const state = eventState(this);
      if (state.cancelable && !state.passive) state.canceled = true;
    }
    stopPropagation() {
      eventState(this).stopped = true;
    }
    stopImmediatePropagation() {
      const state = eventState(this);
      state.stopped = true;
      state.immediate = true;
    }
    composedPath(): Target[] {
      return [...eventState(this).path];
    }
  }
  class CustomEvent extends Event {
    constructor(type: unknown, init: (EventInit & { detail?: unknown }) | null = {}) {
      if (arguments.length === 0) throw new TypeError("CustomEvent requires a type");
      super(type, init);
      details.set(this, init?.detail ?? null);
    }
    get detail(): unknown {
      if (!details.has(this)) throw new TypeError("Illegal invocation");
      return details.get(this);
    }
  }
  class ErrorEvent extends Event {
    constructor(
      type: unknown,
      init: (EventInit & { error?: unknown; message?: unknown }) | null = {},
    ) {
      if (arguments.length === 0) throw new TypeError("ErrorEvent requires a type");
      super(type, init);
      errorDetails.set(this, {
        error: init?.error ?? null,
        message: domString(init?.message === undefined ? "" : init.message),
      });
    }
    get error(): unknown {
      const detail = errorDetails.get(this);
      if (!detail) throw new TypeError("Illegal invocation");
      return detail.error;
    }
    get message(): string {
      const detail = errorDetails.get(this);
      if (!detail) throw new TypeError("Illegal invocation");
      return detail.message;
    }
  }
  for (const [name, value] of [
    ["NONE", 0],
    ["CAPTURING_PHASE", 1],
    ["AT_TARGET", 2],
    ["BUBBLING_PHASE", 3],
  ] as const) {
    for (const object of [Event, Event.prototype])
      Object.defineProperty(object, name, { value, enumerable: true });
  }
  function checkTarget(target: Target) {
    if (!targets.has(target)) throw new TypeError("Illegal invocation");
  }
  function removeRecord(records: ListenerRecord[], record: ListenerRecord) {
    record.removed = true;
    const index = records.indexOf(record);
    if (index !== -1) records.splice(index, 1);
    if (record.signal && record.abort) aborts.get(record.signal)?.algorithms.delete(record.abort);
  }
  function eventPath(target: Target, type: string): Target[] {
    const path = [target];
    let id = ids.get(target);
    if (id !== undefined) {
      let parent = call<number | null>("relativeNode", id, "parent");
      while (parent !== null) {
        path.push(node(parent));
        id = parent;
        parent = call<number | null>("relativeNode", parent, "parent");
      }
      if (type !== "load" && call<number>("get", id, "nodeType") === 9) path.push(globalThis);
    }
    return path;
  }
  let reporting = false;
  function reportListenerError(error: unknown) {
    if (reporting) return;
    reporting = true;
    try {
      let message = "uncaught event listener exception";
      try {
        message = error instanceof Error ? error.message : String(error);
      } catch {
        /* Error conversion may itself throw. */
      }
      const event = new ErrorEvent("error", {
        cancelable: true,
        error,
        message,
      });
      dispatch(globalThis, event, true);
    } finally {
      reporting = false;
    }
  }
  function invoke(target: Target, event: Event, capture: boolean, phase: number) {
    const state = eventState(event);
    if (state.stopped) return;
    state.current = target;
    state.phase = phase;
    const records = listeners.get(target)?.get(state.type) ?? [];
    for (const record of records.slice()) {
      if (record.removed || record.capture !== capture) continue;
      if (record.once) removeRecord(records, record);
      state.passive = record.passive;
      try {
        if (typeof record.callback === "function") record.callback.call(target, event);
        else record.callback.handleEvent(event);
      } catch (error) {
        reportListenerError(error);
      } finally {
        state.passive = false;
      }
      if (state.immediate) break;
    }
  }
  function dictionary(options: unknown): object | null {
    return options !== null && (typeof options === "object" || typeof options === "function")
      ? options
      : null;
  }
  function captureOption(options: unknown): boolean {
    const init = dictionary(options);
    return init ? Boolean(Reflect.get(init, "capture")) : Boolean(options);
  }
  function defaultPassive(type: string, target: Target): boolean {
    if (!["touchstart", "touchmove", "wheel", "mousewheel"].includes(type)) return false;
    if (target === globalThis || target === document) return true;
    const id = ids.get(target);
    return (
      id !== undefined &&
      (id === call<number | null>("queryOne", 0, "body") ||
        id === call<number | null>("queryOne", 0, "html"))
    );
  }
  function dispatch(target: Target, event: Event, trusted = false, legacy = false): boolean {
    checkTarget(target);
    const state = eventState(event);
    if (state.dispatching)
      throw new DOMException("event is already being dispatched", "InvalidStateError");
    state.dispatching = true;
    state.trusted = trusted;
    state.target = legacy ? document : target;
    try {
      state.path = eventPath(target, state.type);
      for (let index = state.path.length - 1; index > 0; index--) {
        const current = state.path[index];
        if (current) invoke(current, event, true, 1);
      }
      invoke(target, event, true, 2);
      invoke(target, event, false, 2);
      if (state.bubbles)
        for (const current of state.path.slice(1)) invoke(current, event, false, 3);
      return !state.canceled;
    } finally {
      state.dispatching = false;
      state.current = null;
      state.phase = 0;
      state.path = [];
      state.stopped = false;
      state.immediate = false;
      state.passive = false;
    }
  }
  class EventTarget {
    constructor() {
      targets.add(this);
    }
    addEventListener(
      this: Target,
      type: unknown,
      callback: Listener | null,
      options: unknown = {},
    ) {
      checkTarget(this);
      if (arguments.length < 2) throw new TypeError("addEventListener requires type and callback");
      const name = domString(type);
      const capture = captureOption(options);
      const init = dictionary(options);
      const once = init ? Boolean(Reflect.get(init, "once")) : false;
      const passive: unknown = init ? Reflect.get(init, "passive") : undefined;
      const rawSignal: unknown = init ? Reflect.get(init, "signal") : undefined;
      let signal: object | null = null;
      if (rawSignal !== undefined) {
        const value = dictionary(rawSignal);
        if (!value || !aborts.has(value)) throw new TypeError("invalid AbortSignal");
        signal = value;
      }
      if (callback === null || callback === undefined || (signal && aborts.get(signal)?.aborted))
        return;
      if (typeof callback !== "function" && typeof callback !== "object")
        throw new TypeError("invalid event listener");
      const list = listeners.get(this) ?? new Map<string, ListenerRecord[]>();
      const records = list.get(name) ?? [];
      if (records.some((record) => record.callback === callback && record.capture === capture))
        return;
      const record: ListenerRecord = {
        callback,
        capture,
        once,
        passive: passive === undefined ? defaultPassive(name, this) : Boolean(passive),
        removed: false,
        signal,
        abort: null,
      };
      if (signal) {
        record.abort = () => removeRecord(records, record);
        aborts.get(signal)?.algorithms.add(record.abort);
      }
      records.push(record);
      list.set(name, records);
      listeners.set(this, list);
    }
    removeEventListener(
      this: Target,
      type: unknown,
      callback: Listener | null,
      options: unknown = {},
    ) {
      checkTarget(this);
      if (arguments.length < 2)
        throw new TypeError("removeEventListener requires type and callback");
      const records = listeners.get(this)?.get(domString(type));
      const capture = captureOption(options);
      const record = records?.find(
        (candidate) => candidate.callback === callback && candidate.capture === capture,
      );
      if (records && record) removeRecord(records, record);
    }
    dispatchEvent(this: Target, event: Event): boolean {
      return dispatch(this, event);
    }
  }
  const abortKey = Symbol("abort signal");
  class AbortSignal extends EventTarget {
    constructor(key: symbol) {
      super();
      if (key !== abortKey) throw new TypeError("Illegal constructor");
      aborts.set(this, { aborted: false, reason: undefined, algorithms: new Set() });
    }
    get aborted(): boolean {
      const state = aborts.get(this);
      if (!state) throw new TypeError("Illegal invocation");
      return state.aborted;
    }
    get reason(): unknown {
      const state = aborts.get(this);
      if (!state) throw new TypeError("Illegal invocation");
      return state.reason;
    }
    throwIfAborted() {
      const state = aborts.get(this);
      if (!state) throw new TypeError("Illegal invocation");
      if (state.aborted) throw state.reason;
    }
    static abort(reason?: unknown): AbortSignal {
      const controller = new AbortController();
      controller.abort(reason);
      return controller.signal;
    }
  }
  class AbortController {
    constructor() {
      controllers.set(this, new AbortSignal(abortKey));
    }
    get signal(): AbortSignal {
      const signal = controllers.get(this);
      if (!signal) throw new TypeError("Illegal invocation");
      return signal;
    }
    abort(reason: unknown = new DOMException("operation aborted", "AbortError")) {
      const signal = controllers.get(this);
      const state = signal ? aborts.get(signal) : undefined;
      if (!state || !signal) throw new TypeError("Illegal invocation");
      if (state.aborted) return;
      state.aborted = true;
      state.reason = reason;
      for (const algorithm of Array.from(state.algorithms)) algorithm();
      state.algorithms.clear();
      dispatch(signal, new Event("abort"), true);
    }
  }
  for (const [prototype, tag] of [
    [Event.prototype, "Event"],
    [CustomEvent.prototype, "CustomEvent"],
    [ErrorEvent.prototype, "ErrorEvent"],
    [EventTarget.prototype, "EventTarget"],
    [AbortSignal.prototype, "AbortSignal"],
    [AbortController.prototype, "AbortController"],
  ] as const)
    Object.defineProperty(prototype, Symbol.toStringTag, { value: tag, configurable: true });
  function idOf(candidate: object): number {
    const id = ids.get(candidate);
    if (id === undefined) throw new TypeError("invalid Node");
    return id;
  }
  const internal = Symbol("native node");
  type Collection = NodeList | HTMLCollection;
  type CollectionState = { resolve: () => Node[] };
  const collections = new WeakMap<Collection, CollectionState>();
  const childLists = new WeakMap<Node, NodeList>();
  const elementLists = new WeakMap<ParentNode, HTMLCollection>();
  function collectionState(list: Collection): CollectionState {
    const state = collections.get(list);
    if (!state) throw new TypeError("Illegal invocation");
    return state;
  }
  function namedNodes(items: Node[]): Map<string, Element> {
    const names = new Map<string, Element>();
    for (const item of items) {
      if (!(item instanceof Element)) continue;
      const id = item.getAttribute("id");
      const name =
        item.namespaceURI === "http://www.w3.org/1999/xhtml" ? item.getAttribute("name") : null;
      for (const key of [id, name]) {
        if (key && !names.has(key)) names.set(key, item);
      }
    }
    return names;
  }
  function propertyIndex(key: string | symbol): number | null {
    if (typeof key !== "string") return null;
    const index = Number(key);
    return Number.isInteger(index) && index >= 0 && index < 4294967295 && String(index) === key
      ? index
      : null;
  }
  function makeCollection<T extends Collection>(
    target: T,
    resolve: () => Node[],
    named = false,
  ): T {
    const state = { resolve };
    const visibleName = (key: string | symbol): Element | undefined =>
      named && typeof key === "string" && !Reflect.has(target, key)
        ? namedNodes(resolve()).get(key)
        : undefined;
    const proxy = new Proxy(target, {
      get(object, key, receiver): unknown {
        const index = propertyIndex(key);
        if (index !== null) return resolve()[index];
        return visibleName(key) ?? Reflect.get(object, key, receiver);
      },
      has(object, key) {
        const index = propertyIndex(key);
        return index !== null
          ? index < resolve().length
          : Reflect.has(object, key) || visibleName(key) !== undefined;
      },
      ownKeys(object) {
        const items = resolve();
        const keys: (string | symbol)[] = items.map((_, index) => String(index));
        if (named) {
          for (const key of namedNodes(items).keys()) if (!Reflect.has(object, key)) keys.push(key);
        }
        return Array.from(new Set([...keys, ...Reflect.ownKeys(object)]));
      },
      getOwnPropertyDescriptor(object, key) {
        const index = propertyIndex(key);
        if (index !== null) {
          const value = resolve()[index];
          return value === undefined
            ? undefined
            : { value, writable: false, enumerable: true, configurable: true };
        }
        const value = visibleName(key);
        return value === undefined
          ? Reflect.getOwnPropertyDescriptor(object, key)
          : { value, writable: false, enumerable: false, configurable: true };
      },
      defineProperty(object, key, descriptor) {
        if (propertyIndex(key) !== null) return false;
        if (
          named &&
          typeof key === "string" &&
          !Object.hasOwn(object, key) &&
          namedNodes(resolve()).has(key)
        )
          return false;
        return Reflect.defineProperty(object, key, descriptor);
      },
      deleteProperty(object, key) {
        const index = propertyIndex(key);
        if (index !== null) return index >= resolve().length;
        return visibleName(key) === undefined && Reflect.deleteProperty(object, key);
      },
      preventExtensions() {
        return false;
      },
    });
    collections.set(target, state);
    collections.set(proxy, state);
    return proxy;
  }
  class NodeList {
    constructor(key: symbol) {
      if (key !== internal) throw new TypeError("Illegal constructor");
    }
    get length(): number {
      return collectionState(this).resolve().length;
    }
    item(index: number): Node | null {
      if (arguments.length === 0) throw new TypeError("item requires an index");
      return collectionState(this).resolve()[index >>> 0] ?? null;
    }
    forEach(
      callback: (this: unknown, value: Node, index: number, list: NodeList) => void,
      thisArg?: unknown,
    ) {
      const state = collectionState(this);
      if (typeof callback !== "function") throw new TypeError("callback must be a function");
      const length = state.resolve().length;
      for (let index = 0; index < length; index++) {
        const value = state.resolve()[index];
        if (value !== undefined) callback.call(thisArg, value, index, this);
      }
    }
    entries(): Generator<[number, Node]> {
      return collectionEntries(collectionState(this));
    }
    keys(): Generator<number> {
      const state = collectionState(this);
      return (function* () {
        for (const [index] of collectionEntries(state)) yield index;
      })();
    }
    values(): Generator<Node> {
      return collectionValues(collectionState(this));
    }
    [Symbol.iterator](): Generator<Node> {
      return this.values();
    }
  }
  function* collectionEntries(state: CollectionState): Generator<[number, Node]> {
    for (let index = 0; ; index++) {
      const value = state.resolve()[index];
      if (value === undefined) return;
      yield [index, value];
    }
  }
  function* collectionValues(state: CollectionState): Generator<Node> {
    for (const [, value] of collectionEntries(state)) yield value;
  }
  class HTMLCollection {
    constructor(key: symbol) {
      if (key !== internal) throw new TypeError("Illegal constructor");
    }
    get length(): number {
      return collectionState(this).resolve().length;
    }
    item(index: number): Element | null {
      if (arguments.length === 0) throw new TypeError("item requires an index");
      const value = collectionState(this).resolve()[index >>> 0];
      return value instanceof Element ? value : null;
    }
    namedItem(name: unknown): Element | null {
      if (arguments.length === 0) throw new TypeError("namedItem requires a name");
      if (typeof name === "symbol") throw new TypeError("name must be convertible to a DOMString");
      return namedNodes(collectionState(this).resolve()).get(String(name)) ?? null;
    }
    [Symbol.iterator](): Generator<Node> {
      return collectionValues(collectionState(this));
    }
  }
  Object.defineProperty(NodeList.prototype, Symbol.iterator, {
    // Web IDL requires the same unbound prototype method for both names.
    // oxlint-disable-next-line typescript/unbound-method
    value: NodeList.prototype.values,
    writable: true,
    configurable: true,
  });
  for (const [prototype, tag] of [
    [NodeList.prototype, "NodeList"],
    [HTMLCollection.prototype, "HTMLCollection"],
  ] as const) {
    Object.defineProperty(prototype, Symbol.toStringTag, { value: tag, configurable: true });
  }
  class Node extends EventTarget {
    constructor(key: symbol, id: number) {
      super();
      if (key !== internal) throw new TypeError("Illegal constructor");
      ids.set(this, id);
      nodes.set(id, this);
    }
    private relativeNode(relation: string): Node | null {
      const id = call<number | null>("relativeNode", idOf(this), relation);
      return id === null ? null : node(id);
    }
    get childNodes(): NodeList {
      let list = childLists.get(this);
      if (!list) {
        list = makeCollection(new NodeList(internal), () =>
          call<number[]>("children", idOf(this), "nodes").map(node),
        );
        childLists.set(this, list);
      }
      return list;
    }
    get parentNode(): Node | null {
      return this.relativeNode("parent");
    }
    get firstChild(): Node | null {
      return this.relativeNode("first");
    }
    get lastChild(): Node | null {
      return this.relativeNode("last");
    }
    get nextSibling(): Node | null {
      return this.relativeNode("next");
    }
    get previousSibling(): Node | null {
      return this.relativeNode("previous");
    }
    get nodeType(): number {
      return call("get", idOf(this), "nodeType");
    }
    get nodeName(): string {
      return call("get", idOf(this), "nodeName");
    }
    get ownerDocument(): Document | null {
      return this.nodeType === 9 ? null : document;
    }
    get nodeValue(): string | null {
      return call("get", idOf(this), "nodeValue");
    }
    set nodeValue(value: string | number | null) {
      call("set", idOf(this), "nodeValue", String(value ?? ""));
    }
    get parentElement(): Element | null {
      const id = call<number | null>("parentElement", idOf(this));
      return id === null ? null : element(id);
    }
    get isConnected(): boolean {
      return call("get", idOf(this), "isConnected");
    }
    contains(other: Node | null): boolean {
      return other !== null && call("contains", idOf(this), String(idOf(other)));
    }
    get textContent(): string | null {
      return call("get", idOf(this), "textContent");
    }
    set textContent(value: string | number | null) {
      call("set", idOf(this), "textContent", String(value ?? ""));
    }
    appendChild<T extends Node>(child: T): T {
      call("append", idOf(this), "", String(idOf(child)));
      return child;
    }
    insertBefore<T extends Node>(child: T, reference: Node | null): T {
      call(
        "insert",
        idOf(this),
        reference === null ? "" : String(idOf(reference)),
        String(idOf(child)),
      );
      return child;
    }
    replaceChild<T extends Node>(child: Node, replaced: T): T {
      call("replace", idOf(this), String(idOf(replaced)), String(idOf(child)));
      return replaced;
    }
    removeChild<T extends Node>(child: T): T {
      call("removeChild", idOf(this), "", String(idOf(child)));
      return child;
    }
    remove() {
      call("remove", idOf(this));
    }
  }
  class ParentNode extends Node {
    get children(): HTMLCollection {
      let list = elementLists.get(this);
      if (!list) {
        list = makeCollection(
          new HTMLCollection(internal),
          () => call<number[]>("children", idOf(this), "elements").map(element),
          true,
        );
        elementLists.set(this, list);
      }
      return list;
    }
    get childElementCount(): number {
      return this.children.length;
    }
    querySelectorAll(selector: string): NodeList {
      const snapshot = call<number[]>("query", idOf(this), selector).map(element);
      return makeCollection(new NodeList(internal), () => snapshot);
    }
    querySelector(selector: string): Element | null {
      const id = call<number | null>("queryOne", idOf(this), selector);
      return id === null ? null : element(id);
    }
  }
  class Element extends ParentNode {
    matches(selector: string): boolean {
      return call("matches", idOf(this), selector);
    }
    closest(selector: string): Element | null {
      const id = call<number | null>("closest", idOf(this), selector);
      return id === null ? null : element(id);
    }
    private relativeElement(relation: string): Element | null {
      const id = call<number | null>("relativeElement", idOf(this), relation);
      return id === null ? null : element(id);
    }
    get firstElementChild(): Element | null {
      return this.relativeElement("first");
    }
    get lastElementChild(): Element | null {
      return this.relativeElement("last");
    }
    get nextElementSibling(): Element | null {
      return this.relativeElement("next");
    }
    get previousElementSibling(): Element | null {
      return this.relativeElement("previous");
    }
    get innerHTML(): string {
      return call("get", idOf(this), "innerHTML");
    }
    set innerHTML(value: string | number | null) {
      call("set", idOf(this), "innerHTML", String(value));
    }
    get outerHTML(): string {
      return call("get", idOf(this), "outerHTML");
    }
    get namespaceURI(): string {
      return call("get", idOf(this), "namespaceURI");
    }
    get tagName(): string {
      return call("get", idOf(this), "tagName");
    }
    get id(): string {
      return this.getAttribute("id") ?? "";
    }
    set id(value: string | number | null) {
      this.setAttribute("id", value);
    }
    get className(): string {
      return this.getAttribute("class") ?? "";
    }
    set className(value: string | number | null) {
      this.setAttribute("class", value);
    }
    getAttribute(name: string): string | null {
      return call("attr", idOf(this), name);
    }
    setAttribute(name: string, value: string | number | null) {
      call("setAttr", idOf(this), name, String(value));
    }
    hasAttribute(name: string): boolean {
      return this.getAttribute(name) !== null;
    }
    removeAttribute(name: string) {
      call("removeAttr", idOf(this), name);
    }
  }
  class CharacterData extends Node {
    get data(): string {
      return this.nodeValue ?? "";
    }
    set data(value: string) {
      this.nodeValue = value;
    }
    get length(): number {
      return this.data.length;
    }
  }
  class Text extends CharacterData {
    constructor(data: string | number | null = "", key?: symbol, id?: number) {
      super(
        internal,
        key === internal && id !== undefined ? id : call("createText", 0, "", String(data)),
      );
    }
  }
  class Comment extends CharacterData {
    constructor(data: string | number | null = "", key?: symbol, id?: number) {
      super(
        internal,
        key === internal && id !== undefined ? id : call("createComment", 0, "", String(data)),
      );
    }
  }
  function node(id: number): Node {
    const existing = nodes.get(id);
    if (existing) return existing;
    switch (call<number>("get", id, "nodeType")) {
      case 1:
        return new Element(internal, id);
      case 3:
        return new Text("", internal, id);
      case 8:
        return new Comment("", internal, id);
      case 11:
        return new DocumentFragment(internal, id);
      default:
        return new Node(internal, id);
    }
  }

  class DocumentFragment extends ParentNode {
    constructor(key?: symbol, id?: number) {
      super(internal, key === internal && id !== undefined ? id : call("createFragment", 0));
    }
  }
  function element(id: number): Element {
    const result = node(id);
    if (!(result instanceof Element)) throw new TypeError("expected Element");
    return result;
  }

  let readyState = "loading";
  class Document extends ParentNode {
    get body() {
      return this.querySelector("body");
    }
    get head() {
      return this.querySelector("head");
    }
    get documentElement() {
      return this.querySelector("html");
    }
    get readyState() {
      return readyState;
    }
    get URL() {
      return href;
    }
    get title() {
      return this.querySelector("title")?.textContent ?? "";
    }
    set title(value: string | number | null) {
      let title = this.querySelector("title");
      if (!title) {
        title = this.createElement("title");
        this.head?.appendChild(title);
      }
      title.textContent = value;
    }
    getElementById(id: string) {
      return this.querySelector(`[id=${JSON.stringify(id)}]`);
    }
    createTextNode(data: string) {
      return new Text(data);
    }
    createComment(data: string) {
      return new Comment(data);
    }
    createDocumentFragment() {
      return new DocumentFragment();
    }
    createElement(tag: string) {
      return element(call("create", 0, tag));
    }
  }
  const document = new Document(internal, 0);
  nodes.set(0, document);
  targets.add(globalThis);

  type Timer = {
    handler: ((...args: unknown[]) => unknown) | string;
    args: unknown[];
    delay: number;
    due: number;
    level: number;
    repeat: boolean;
  };
  const timers = new Map<number, Timer>();
  // Timer strings execute as global scripts in this page's own QuickJS context.
  // oxlint-disable-next-line eslint/no-eval
  const executeScript = eval;
  let nextTimer = 1;
  let timerLevel = 0;
  let timerTasks = 0;
  function long(value: unknown): number {
    if (typeof value === "bigint") throw new TypeError("BigInt is not a timer number");
    return Number(value) | 0;
  }
  function schedule(handler: unknown, timeout: unknown, args: unknown[], repeat: boolean) {
    const callback = typeof handler === "function" ? handler : domString(handler);
    const delay = Math.max(0, long(timeout));
    if (timers.size >= timerLimit) throw new Error("timer capacity limit");
    const id = nextTimer++;
    timers.set(id, {
      // Callable values are validated above; arguments remain page-owned values.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      handler: callback as Timer["handler"],
      args,
      delay,
      due: now() + (timerLevel > 5 ? Math.max(4, delay) : delay),
      level: timerLevel + 1,
      repeat,
    });
    return id;
  }
  function setTimeout(handler: unknown, timeout: unknown = 0, ...args: unknown[]) {
    if (arguments.length === 0) throw new TypeError("setTimeout requires a handler");
    return schedule(handler, timeout, args, false);
  }
  function setInterval(handler: unknown, timeout: unknown = 0, ...args: unknown[]) {
    if (arguments.length === 0) throw new TypeError("setInterval requires a handler");
    return schedule(handler, timeout, args, true);
  }
  function clearTimeout(id: unknown) {
    if (arguments.length === 0) throw new TypeError("clearTimeout requires an id");
    timers.delete(long(id));
  }
  function queueMicrotask(callback: () => unknown) {
    if (typeof callback !== "function") throw new TypeError("queueMicrotask requires a function");
    void Promise.resolve().then(() => {
      try {
        callback();
      } catch (error) {
        reportListenerError(error);
      }
    });
  }
  function timer(run: boolean): number | null {
    if (!run) {
      timerLevel = 0;
      return null;
    }
    let selected: [number, Timer] | undefined;
    for (const entry of timers) {
      if (!selected || entry[1].due < selected[1].due) selected = entry;
    }
    if (!selected) return null;
    const [id, task] = selected;
    const delay = task.due - now();
    if (delay > 0) return delay;
    if (timerTasks >= timerTaskLimit) throw new Error("timer task limit");
    timerTasks++;
    timerLevel = task.level;
    try {
      if (typeof task.handler === "function") task.handler.apply(globalThis, task.args);
      else executeScript(task.handler);
    } catch (error) {
      reportListenerError(error);
    } finally {
      if (timers.get(id) === task) {
        if (task.repeat) {
          task.due = now() + (timerLevel > 5 ? Math.max(4, task.delay) : task.delay);
          task.level = timerLevel + 1;
        } else timers.delete(id);
      }
      // Keep the task nesting level until its microtask checkpoint completes.
    }
    return 0;
  }

  const fetch = async (url: string, options: { method?: string; body?: string } = {}) => {
    for (const key of Object.keys(options)) {
      if (!["method", "body"].includes(key)) throw new Error(`unsupported fetch option: ${key}`);
    }
    const method = (options.method ?? "GET").toUpperCase();
    if (method === "GET" && options.body !== undefined) throw new Error("GET cannot have a body");
    // Rust owns the serialized HTTP response shape.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const response = JSON.parse(await nativeRequest(url, method, options.body ?? "")) as {
      status: number;
      body: string;
      url: string;
    };
    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      url: response.url,
      text: async () => response.body,
      json: async (): Promise<unknown> => JSON.parse(response.body),
    };
  };
  Object.assign(globalThis, {
    document,
    window: globalThis,
    self: globalThis,
    location: Object.freeze({ href, toString: () => href }),
    Event,
    CustomEvent,
    ErrorEvent,
    EventTarget,
    AbortSignal,
    AbortController,
    Node,
    Element,
    Document,
    DocumentFragment,
    NodeList,
    HTMLCollection,
    CharacterData,
    Text,
    Comment,
    fetch,
    setTimeout,
    setInterval,
    clearTimeout,
    clearInterval: clearTimeout,
    queueMicrotask,
    addEventListener: EventTarget.prototype.addEventListener.bind(globalThis),
    removeEventListener: EventTarget.prototype.removeEventListener.bind(globalThis),
    dispatchEvent: EventTarget.prototype.dispatchEvent.bind(globalThis),
  });

  const ready = (complete = true) => {
    readyState = "interactive";
    if (!complete) return;
    dispatch(document, new Event("DOMContentLoaded", { bubbles: true }), true);
    readyState = "complete";
    dispatch(globalThis, new Event("load"), true, true);
  };
  return { ready, timer };
})();
