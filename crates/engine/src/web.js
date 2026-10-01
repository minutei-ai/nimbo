/* global nimboDom, nimboRequest, nimboUrl */
(() => {
  "use strict";
  const nativeDom = nimboDom;
  const nativeRequest = nimboRequest;
  const href = nimboUrl;
  // Capture native bindings and hide them from page scripts.
  Reflect.deleteProperty(globalThis, "nimboDom");
  Reflect.deleteProperty(globalThis, "nimboRequest");
  Reflect.deleteProperty(globalThis, "nimboUrl");

  /** @type {WeakMap<Element, number>} */
  const ids = new WeakMap();
  /** @type {Map<number, Element>} */
  const nodes = new Map();
  /** @typedef {(this: EventTarget, event: Event) => void} Listener */
  /** @type {WeakMap<EventTarget, Map<string, Set<Listener>>>} */
  const listeners = new WeakMap();

  // The operation defines the result type, so T is intentionally return-only.
  /* oxlint-disable typescript/no-unnecessary-type-parameters */
  /**
   * JSON types are determined by the operation in the Rust bridge.
   * @template T
   * @param {string} operation
   * @param {number} id
   * @param {string} [arg]
   * @param {string} [value]
   * @returns {T}
   */
  const call = (operation, id, arg = "", value = "") =>
    // Rust serializes the response according to the requested operation.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    /** @type {T} */ (JSON.parse(nativeDom(operation, id, arg, value)));
  /* oxlint-enable typescript/no-unnecessary-type-parameters */

  class Event {
    /** @param {string} type */
    constructor(type) {
      this.type = type;
      /** @type {EventTarget | null} */
      this.target = null;
    }
    get currentTarget() {
      return this.target;
    }
  }
  class EventTarget {
    /** @param {string} type @param {Listener} callback */
    addEventListener(type, callback) {
      if (typeof callback !== "function") throw new TypeError("callback must be a function");
      /** @type {Map<string, Set<Listener>>} */
      const freshEvents = new Map();
      const events = listeners.get(this) ?? freshEvents;
      /** @type {Set<Listener>} */
      const freshCallbacks = new Set();
      const callbacks = events.get(type) ?? freshCallbacks;
      callbacks.add(callback);
      events.set(type, callbacks);
      listeners.set(this, events);
    }
    /** @param {string} type @param {Listener} callback */
    removeEventListener(type, callback) {
      listeners.get(this)?.get(type)?.delete(callback);
    }
    /** @param {Event} event */
    dispatchEvent(event) {
      event.target = this;
      const snapshot = Array.from(listeners.get(this)?.get(event.type) ?? []);
      for (const callback of snapshot) callback.call(this, event);
      return true;
    }
  }

  /** @param {Element} element @returns {number} */
  function idOf(element) {
    const id = ids.get(element);
    if (id === undefined) throw new TypeError("invalid Element");
    return id;
  }
  class Element extends EventTarget {
    /** @param {number} id */
    constructor(id) {
      super();
      ids.set(this, id);
    }
    /** @param {string} selector @returns {Element[]} */
    querySelectorAll(selector) {
      /** @type {number[]} */
      const handles = call("query", idOf(this), selector);
      return handles.map(node);
    }
    /** @param {string} selector */
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null;
    }
    /** @returns {string} */
    get textContent() {
      return call("get", idOf(this), "textContent");
    }
    /** @param {string | number | null} value */
    set textContent(value) {
      call("set", idOf(this), "textContent", String(value ?? ""));
    }
    /** @returns {string} */
    get innerHTML() {
      return call("get", idOf(this), "innerHTML");
    }
    /** @param {string | number | null} value */
    set innerHTML(value) {
      call("set", idOf(this), "innerHTML", String(value));
    }
    /** @returns {string} */
    get outerHTML() {
      return call("get", idOf(this), "outerHTML");
    }
    /** @returns {string} */
    get tagName() {
      return call("get", idOf(this), "tagName");
    }
    get id() {
      return this.getAttribute("id") ?? "";
    }
    /** @param {string | number | null} value */
    set id(value) {
      this.setAttribute("id", value);
    }
    get className() {
      return this.getAttribute("class") ?? "";
    }
    /** @param {string | number | null} value */
    set className(value) {
      this.setAttribute("class", value);
    }
    /** @param {string} name @returns {string | null} */
    getAttribute(name) {
      return call("attr", idOf(this), name);
    }
    /** @param {string} name @param {string | number | null} value */
    setAttribute(name, value) {
      call("setAttr", idOf(this), name, String(value));
    }
    /** @param {Element} child */
    appendChild(child) {
      call("append", idOf(this), "", String(idOf(child)));
      return child;
    }
    remove() {
      call("remove", idOf(this));
    }
  }
  /** @param {number} id @returns {Element} */
  function node(id) {
    let element = nodes.get(id);
    if (!element) {
      element = new Element(id);
      nodes.set(id, element);
    }
    return element;
  }

  let readyState = "loading";
  class Document extends Element {
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
    /** @param {string | number | null} value */
    set title(value) {
      let title = this.querySelector("title");
      if (!title) {
        title = this.createElement("title");
        this.head?.appendChild(title);
      }
      title.textContent = value;
    }
    /** @param {string} id */
    getElementById(id) {
      return this.querySelector(`[id=${JSON.stringify(id)}]`);
    }
    /** @param {string} tag */
    createElement(tag) {
      return node(call("create", 0, tag));
    }
  }
  const document = new Document(0);
  nodes.set(0, document);
  const windowEvents = new EventTarget();

  /** @param {string} url @param {{method?: string, body?: string}} [options] */
  const fetch = async (url, options = {}) => {
    for (const key of Object.keys(options)) {
      if (!["method", "body"].includes(key)) throw new Error(`unsupported fetch option: ${key}`);
    }
    const method = (options.method ?? "GET").toUpperCase();
    if (method === "GET" && options.body !== undefined) throw new Error("GET cannot have a body");
    // Rust owns the serialized response shape.
    /* oxlint-disable typescript/no-unsafe-type-assertion */
    const response = /** @type {{status: number, body: string, url: string}} */ (
      JSON.parse(nativeRequest(url, method, options.body ?? ""))
    );
    /* oxlint-enable typescript/no-unsafe-type-assertion */
    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      url: response.url,
      text: async () => response.body,
      json: async () => /** @type {unknown} */ (JSON.parse(response.body)),
    };
  };
  Object.assign(globalThis, {
    document,
    window: globalThis,
    self: globalThis,
    location: Object.freeze({ href, toString: () => href }),
    Event,
    Element,
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
