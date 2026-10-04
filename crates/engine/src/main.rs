//! Command-line JSON extraction from a bounded browser page.

use std::{
    env,
    io::{self, Write},
    process::ExitCode,
};

use nimbo_engine::{Browser, Limits};

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = env::args().skip(1);
    let usage = "usage: nimbo-engine [--proxy <proxy URL>] <url> [JavaScript expression]";
    let mut proxy = match env::var("NIMBO_PROXY_URL") {
        Ok(value) => Some(value),
        Err(env::VarError::NotPresent) => None,
        Err(env::VarError::NotUnicode(_value)) => return Err("invalid proxy configuration".into()),
    };
    let mut url = args.next().ok_or(usage)?;
    if url == "--proxy" {
        proxy = Some(args.next().ok_or(usage)?);
        url = args.next().ok_or(usage)?;
    }
    let expression = args.next().unwrap_or_else(|| {
        "({ url: location.href, title: document.title, text: document.body.textContent })".into()
    });
    if args.next().is_some() {
        return Err(usage.into());
    }
    let browser = Browser::with_media_and_proxy(
        &url,
        Limits::default(),
        nimbo_engine::MediaEnvironment::default(),
        proxy.as_deref(),
    )?;
    let page = browser.navigate(&url)?;
    let value = page.evaluate(&expression)?;
    serde_json::to_writer(io::stdout().lock(), &value)?;
    writeln!(io::stdout().lock())?;
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            #[expect(
                clippy::let_underscore_must_use,
                reason = "Failure to report an error must still return failure"
            )]
            let _ = writeln!(io::stderr().lock(), "{error}");
            ExitCode::FAILURE
        }
    }
}
