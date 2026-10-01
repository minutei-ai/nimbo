(() => {
  "use strict";
  const nativeDom = nimboDom;
  const nativeRequest = nimboRequest;
  const href = nimboUrl;
  Reflect.deleteProperty(globalThis, "nimboDom");
  Reflect.deleteProperty(globalThis, "nimboRequest");
  Reflect.deleteProperty(globalThis, "nimboUrl");

  const ids = new WeakMap<Node, number>();
  const nodes = new Map<number, Node>();
  type Listener = (this: EventTarget, event: Event) => void;
  const listeners = new WeakMap<EventTarget, Map<string, Set<Listener>>>();

  // Result shapes are serialized by Rust for each native operation.
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters
  const call = <T>(operation: string, id: number, arg = "", value = ""): T => {
    // The bridge owns this JSON contract; it is not page-supplied JSON.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return JSON.parse(nativeDom(operation, id, arg, value)) as T;
  };

  class Event {
    target: EventTarget | null = null;
    constructor(readonly type: string) {}
    get currentTarget() {
      return this.target;
    }
  }
  class EventTarget {
    addEventListener(type: string, callback: Listener) {
      if (typeof callback !== "function") throw new TypeError("callback must be a function");
      const events = listeners.get(this) ?? new Map<string, Set<Listener>>();
      const callbacks = events.get(type) ?? new Set<Listener>();
      callbacks.add(callback);
      events.set(type, callbacks);
      listeners.set(this, events);
    }
    removeEventListener(type: string, callback: Listener) {
      listeners.get(this)?.get(type)?.delete(callback);
    }
    dispatchEvent(event: Event) {
      event.target = this;
      const snapshot = Array.from(listeners.get(this)?.get(event.type) ?? []);
      for (const callback of snapshot) callback.call(this, event);
      return true;
    }
  }
  function idOf(candidate: Node): number {
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
  const windowEvents = new EventTarget();

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
    addEventListener: windowEvents.addEventListener.bind(windowEvents),
    removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
    dispatchEvent: windowEvents.dispatchEvent.bind(windowEvents),
  });

  return () => {
    readyState = "interactive";
    document.dispatchEvent(new Event("DOMContentLoaded"));
    windowEvents.dispatchEvent(new Event("DOMContentLoaded"));
    readyState = "complete";
    windowEvents.dispatchEvent(new Event("load"));
  };
})();
