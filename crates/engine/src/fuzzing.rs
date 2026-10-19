//! Instrumented development harness; absent from ordinary engine artifacts.

use std::{sync::Arc, time::Instant};

use crate::{
    Error, Limits, Result,
    machine::{Action, Machine},
};

const URL: &str = "https://example.test/fuzz";
const MAX_BYTES: usize = 8192;

fn machine(html: &str) -> Result<Machine> {
    let limits = Limits {
        max_javascript_ticks: 64,
        max_microtasks: 128,
        max_timers: 32,
        max_timer_tasks: 128,
        max_initial_dom_nodes: 1024,
        max_dom_nodes: 2048,
        max_layout_nodes: 256,
        max_dom_operations: 4096,
        max_dom_write_bytes: 16384,
        max_stylesheet_bytes: 16384,
        javascript_memory_bytes: 8 * 1024 * 1024,
        ..Limits::default()
    };
    let started = Instant::now();
    Machine::new(
        &crate::machine::Response {
            url: URL.into(),
            status: 200,
            body: html.into(),
            raw_body: None,
            content_type: "text/html".into(),
            headers: Vec::new(),
        },
        limits,
        Arc::new(move || {
            if started.elapsed() >= limits.timeout {
                Err(Error::Limit("fuzz deadline"))
            } else {
                Ok(())
            }
        }),
        true,
        crate::cookies::Session::default(),
        crate::MediaEnvironment::default(),
    )
}

fn drive(machine: &mut Machine, clock: &mut f64) -> Result<Option<String>> {
    for _ in 0..256 {
        machine.advance(*clock)?;
        *clock += 1000.0;
        match machine.step()? {
            Action::Ready => return Ok(None),
            Action::Result { json } => return Ok(Some(json)),
            Action::Wait { .. } | Action::Await { .. } => {}
            Action::Request { id, .. } => machine.reject(id, "fuzz subrequest blocked")?,
        }
    }
    Err(Error::Limit("fuzz host steps"))
}

fn candidate(mode: u8, source: &str) -> Result<()> {
    let encoded = serde_json::to_string(source)?;
    let (html, expression) = match mode % 5 {
        0 => (source.to_owned(), "document.body.textContent".to_owned()),
        1 => (
            format!("<style>{source}</style><div id=p>text</div>"),
            "document.getElementById('p').getBoundingClientRect().width".to_owned(),
        ),
        2 => (
            "<div id=p><i class=x>text</i></div>".to_owned(),
            format!("document.querySelectorAll({encoded}).length"),
        ),
        3 => (
            format!(
                "<script type=importmap>{source}</script><script type=module>export {{}};</script>"
            ),
            "document.body.textContent".to_owned(),
        ),
        _ => ("<div id=p>text</div>".to_owned(), source.to_owned()),
    };
    let mut page = machine(&html)?;
    let mut clock = 0.0;
    drive(&mut page, &mut clock)?;
    page.evaluate(&expression)?;
    drive(&mut page, &mut clock)?;
    Ok(())
}

/// Exercise arbitrary malformed HTML, CSS, selectors, import maps or JS expressions.
/// Expected input errors are accepted; a fresh runtime must remain usable afterward.
/// All subrequests are rejected by this harness without network access.
pub fn exercise(input: &[u8]) {
    if input.len() > MAX_BYTES {
        return;
    }
    if let Some((&mode, payload)) = input.split_first()
        && let Err(error) = candidate(mode, &String::from_utf8_lossy(payload))
    {
        assert!(
            !matches!(error, Error::Io(_) | Error::Http(_)),
            "unexpected external failure: {error}"
        );
    }
    let fresh = (|| -> Result<Option<String>> {
        let mut page = machine("<title>fresh</title>")?;
        let mut clock = 0.0;
        drive(&mut page, &mut clock)?;
        page.evaluate("document.title==='fresh' && typeof leaked==='undefined' && localStorage.getItem('leaked')===null && document.cookie==='' && ({}).leaked===undefined")?;
        drive(&mut page, &mut clock)
    })();
    assert!(
        matches!(fresh, Ok(Some(ref json)) if json == "true"),
        "fresh runtime failed: {fresh:?}"
    );
}
