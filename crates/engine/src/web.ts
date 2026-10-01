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
    remove() {
      call("remove", idOf(this));
    }
  }
  class ParentNode extends Node {
    querySelectorAll(selector: string): Element[] {
      return call<number[]>("query", idOf(this), selector).map(element);
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
      default:
        return new Node(internal, id);
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
