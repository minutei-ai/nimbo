// Native bindings installed by page.rs before evaluating web.js.
declare function nimboDom(operation: string, id: number, arg: string, value: string): string;
declare function nimboRequest(url: string, method: string, body: string): string | Promise<string>;
declare const nimboUrl: string;
