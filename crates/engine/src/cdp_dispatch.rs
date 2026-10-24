//! CDP commands Playwright 1.64 sends for `connectOverCDP`, `newPage`, `goto`,
//! and `evaluate`. Anything else gets an empty result.

use serde_json::{Map, Value, json};

use super::Drive;

pub(super) const DEBUGGER_AGENT: &str = concat!(
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ",
    "(KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36",
);

pub(super) fn dispatch(drive: &mut Drive, message: &Value) -> Vec<Value> {
    let method = message.get("method").and_then(Value::as_str).unwrap_or("");
    let id = message.get("id").cloned().unwrap_or(Value::Null);
    let session = message
        .get("sessionId")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let params = message.get("params").unwrap_or(&Value::Null);
    let session = session.as_deref();
    match method {
        "Browser.getVersion" => one(&id, session, version()),
        "Target.getTargetInfo" => one(&id, session, target_info()),
        "Target.createTarget" => create_target(drive, &id, session),
        "Page.getFrameTree" => one(&id, session, frame_tree(drive)),
        "Page.navigate" => navigate(drive, &id, session, params),
        "Page.addScriptToEvaluateOnNewDocument" => one(&id, session, script_id(drive)),
        "Page.createIsolatedWorld" => isolated_world(drive, &id, session, params),
        "Runtime.enable" => runtime_enable(drive, &id, session),
        "Runtime.evaluate" => runtime_evaluate(drive, &id, session, params),
        "Runtime.callFunctionOn" => call_function(drive, &id, session, params),
        _ => one(&id, session, json!({})),
    }
}

fn version() -> Value {
    json!({
        "protocolVersion": "1.3",
        "product": "Chrome/120.0.0.0",
        "revision": "0",
        "userAgent": DEBUGGER_AGENT,
        "jsVersion": "0.0.0",
    })
}

fn target_info() -> Value {
    json!({
        "targetInfo": {
            "targetId": "browser",
            "type": "browser",
            "title": "",
            "url": "",
            "attached": true,
            "canAccessOpener": false,
        }
    })
}

fn create_target(drive: &mut Drive, id: &Value, session: Option<&str>) -> Vec<Value> {
    let serial = drive.target_serial;
    drive.target_serial = drive.target_serial.saturating_add(1);
    let target = format!("target-{serial}");
    let child = format!("session-{serial}");
    drive.frame_id.clone_from(&target);
    "about:blank".clone_into(&mut drive.frame_url);
    "://".clone_into(&mut drive.origin);
    drive.loader_id = format!("loader-{serial}");
    // The attached event has to be on the wire before createTarget's result,
    // or Playwright looks up a page that does not exist yet.
    let attached = event(
        None,
        "Target.attachedToTarget",
        json!({
            "sessionId": child,
            "waitingForDebugger": true,
            "targetInfo": {
                "targetId": target,
                "type": "page",
                "title": "",
                "url": "about:blank",
                "attached": true,
                "canAccessOpener": false,
                "browserContextId": "default",
            }
        }),
    );
    finish(vec![attached], id, session, json!({ "targetId": target }))
}

fn frame_tree(drive: &Drive) -> Value {
    json!({
        "frameTree": {
            "frame": frame_body(drive),
            "childFrames": [],
        }
    })
}

fn navigate(drive: &mut Drive, id: &Value, session: Option<&str>, params: &Value) -> Vec<Value> {
    let Some(url) = params.get("url").and_then(Value::as_str) else {
        return one(
            id,
            session,
            json!({
                "frameId": drive.frame_id,
                "loaderId": drive.loader_id,
                "errorText": "missing url",
            }),
        );
    };
    let loader = next_loader(drive);
    let page = match drive.browser.navigate(url) {
        Ok(page) => page,
        Err(error) => {
            return one(
                id,
                session,
                json!({
                    "frameId": drive.frame_id,
                    "loaderId": loader,
                    "errorText": error.to_string(),
                }),
            );
        }
    };
    let final_url = page.url().to_owned();
    drive.page = Some(page);
    drive.frame_url.clone_from(&final_url);
    drive.origin = security_origin(&final_url);
    drive.loader_id = loader;
    let context = next_context(drive);
    // frameNavigated clears lifecycle, so load follows it. Both precede the
    // result that lets page.goto observe them.
    let events = vec![
        event(
            session,
            "Page.frameNavigated",
            json!({ "frame": frame_body(drive) }),
        ),
        event(
            session,
            "Page.lifecycleEvent",
            lifecycle(drive, "DOMContentLoaded"),
        ),
        event(session, "Page.lifecycleEvent", lifecycle(drive, "load")),
        event(
            session,
            "Runtime.executionContextCreated",
            context_params(drive, context, "", true),
        ),
    ];
    finish(
        events,
        id,
        session,
        json!({ "frameId": drive.frame_id, "loaderId": drive.loader_id }),
    )
}

fn script_id(drive: &mut Drive) -> Value {
    let identifier = drive.scripts;
    drive.scripts = drive.scripts.saturating_add(1);
    json!({ "identifier": identifier.to_string() })
}

fn isolated_world(
    drive: &mut Drive,
    id: &Value,
    session: Option<&str>,
    params: &Value,
) -> Vec<Value> {
    let main = next_context(drive);
    let utility = next_context(drive);
    let name = params
        .get("worldName")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    let events = vec![
        event(
            session,
            "Runtime.executionContextCreated",
            context_params(drive, main, "", true),
        ),
        event(
            session,
            "Runtime.executionContextCreated",
            context_params(drive, utility, &name, false),
        ),
    ];
    finish(
        events,
        id,
        session,
        json!({ "executionContextId": utility }),
    )
}

fn runtime_enable(drive: &mut Drive, id: &Value, session: Option<&str>) -> Vec<Value> {
    let context = next_context(drive);
    let created = event(
        session,
        "Runtime.executionContextCreated",
        context_params(drive, context, "", true),
    );
    finish(vec![created], id, session, json!({}))
}

fn runtime_evaluate(
    drive: &Drive,
    id: &Value,
    session: Option<&str>,
    params: &Value,
) -> Vec<Value> {
    let by_value = params
        .get("returnByValue")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    // Playwright's utility object is a handle, not a JSON value. Running that
    // source would exceed the page expression budget.
    let result = if by_value {
        let expression = params
            .get("expression")
            .and_then(Value::as_str)
            .unwrap_or("");
        evaluated(drive, expression)
    } else {
        json!({ "result": { "type": "object", "objectId": "utility", "description": "Object" } })
    };
    one(id, session, result)
}

fn call_function(drive: &Drive, id: &Value, session: Option<&str>, params: &Value) -> Vec<Value> {
    let declaration = params
        .get("functionDeclaration")
        .and_then(Value::as_str)
        .unwrap_or("");
    let result = if declaration.contains("utilityScript.evaluate") {
        let is_function = argument(params, 1)
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let expression = argument(params, 3).and_then(Value::as_str).unwrap_or("");
        let source = if is_function {
            format!("({expression})()")
        } else {
            expression.to_owned()
        };
        evaluated(drive, &source)
    } else {
        json!({ "result": { "type": "undefined" } })
    };
    one(id, session, result)
}

fn evaluated(drive: &Drive, expression: &str) -> Value {
    let Some(page) = drive.page.as_ref() else {
        return failed("no page");
    };
    match page.evaluate(expression) {
        Ok(value) => json!({ "result": remote(&value) }),
        Err(error) => failed(&error.to_string()),
    }
}

fn remote(value: &Value) -> Value {
    match value {
        Value::Null => json!({ "type": "object", "subtype": "null", "value": null }),
        Value::Bool(bit) => json!({ "type": "boolean", "value": bit }),
        Value::Number(number) => json!({ "type": "number", "value": number }),
        Value::String(text) => json!({ "type": "string", "value": text }),
        Value::Array(_) | Value::Object(_) => json!({ "type": "object", "value": value }),
    }
}

fn failed(message: &str) -> Value {
    json!({
        "exceptionDetails": {
            "text": message,
            "exception": {
                "type": "object",
                "subtype": "error",
                "description": message,
            }
        },
        "result": {
            "type": "object",
            "subtype": "error",
            "description": message,
        }
    })
}

fn frame_body(drive: &Drive) -> Value {
    json!({
        "id": drive.frame_id,
        "loaderId": drive.loader_id,
        "url": drive.frame_url,
        "mimeType": "text/html",
        "securityOrigin": drive.origin,
        "name": "",
    })
}

fn lifecycle(drive: &Drive, name: &str) -> Value {
    json!({
        "frameId": drive.frame_id,
        "loaderId": drive.loader_id,
        "name": name,
    })
}

fn context_params(drive: &Drive, id: i64, name: &str, default: bool) -> Value {
    json!({
        "context": {
            "id": id,
            "name": name,
            "origin": drive.origin,
            "auxData": {
                "frameId": drive.frame_id,
                "isDefault": default,
            }
        }
    })
}

fn security_origin(url: &str) -> String {
    let Some((scheme, rest)) = url.split_once("://") else {
        return "://".to_owned();
    };
    let host = rest.split('/').next().unwrap_or("");
    if host.is_empty() {
        "://".to_owned()
    } else {
        format!("{scheme}://{host}")
    }
}

fn next_loader(drive: &mut Drive) -> String {
    let serial = drive.loader_serial;
    drive.loader_serial = drive.loader_serial.saturating_add(1);
    format!("loader-{serial}")
}

fn next_context(drive: &mut Drive) -> i64 {
    let id = drive.context;
    drive.context = drive.context.saturating_add(1);
    id
}

fn argument(params: &Value, index: usize) -> Option<&Value> {
    params
        .get("arguments")?
        .as_array()?
        .get(index)?
        .get("value")
}

fn one(id: &Value, session: Option<&str>, result: Value) -> Vec<Value> {
    vec![reply(id, session, result)]
}

fn finish(mut events: Vec<Value>, id: &Value, session: Option<&str>, result: Value) -> Vec<Value> {
    events.push(reply(id, session, result));
    events
}

fn reply(id: &Value, session: Option<&str>, result: Value) -> Value {
    let mut message = Map::new();
    message.insert("id".to_owned(), id.clone());
    if let Some(session) = session {
        message.insert("sessionId".to_owned(), Value::String(session.to_owned()));
    }
    message.insert("result".to_owned(), result);
    Value::Object(message)
}

fn event(session: Option<&str>, method: &str, params: Value) -> Value {
    let mut message = Map::new();
    if let Some(session) = session {
        message.insert("sessionId".to_owned(), Value::String(session.to_owned()));
    }
    message.insert("method".to_owned(), Value::String(method.to_owned()));
    message.insert("params".to_owned(), params);
    Value::Object(message)
}
