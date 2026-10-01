use std::{
    env,
    io::{self, Write},
    process::ExitCode,
};

use nimbo_engine::{Browser, Limits};

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = env::args().skip(1);
    let Some(url) = args.next() else {
        return Err("usage: nimbo-engine <url> [JavaScript expression]".into());
    };
    let expression = args.next().unwrap_or_else(|| {
        "({ url: location.href, title: document.title, text: document.body.textContent })".into()
    });
    if args.next().is_some() {
        return Err("usage: nimbo-engine <url> [JavaScript expression]".into());
    }
    let browser = Browser::new(&url, Limits::default())?;
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
            let _ = writeln!(io::stderr().lock(), "{error}");
            ExitCode::FAILURE
        }
    }
}
