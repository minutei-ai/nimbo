//! Compile the owned browser bindings into version-matched `QuickJS` bytecode.

use std::{
    env,
    io::{self, Write},
    path::PathBuf,
    process::Command,
};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let crate_dir =
        PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").ok_or("missing manifest directory")?);
    let root = crate_dir
        .parent()
        .and_then(std::path::Path::parent)
        .ok_or("missing workspace root")?;
    let output = PathBuf::from(env::var_os("OUT_DIR").ok_or("missing Cargo output directory")?)
        .join("web.js");
    for path in [
        "src/web.ts",
        "../../tooling/build-web.ts",
        "../../tooling/build-fonts.ts",
        "../../bun.lock",
    ] {
        writeln!(io::stdout().lock(), "cargo:rerun-if-changed={path}")?;
    }
    let font_output = output
        .parent()
        .ok_or("missing build output parent")?
        .join("fonts");
    let font_status = Command::new("bun")
        .current_dir(root)
        .args(["run", "tooling/build-fonts.ts"])
        .arg(&font_output)
        .status()?;
    if !font_status.success() {
        return Err("pinned public font reference build failed".into());
    }
    let status = Command::new("bun")
        .current_dir(root)
        .arg("run")
        .arg("tooling/build-web.ts")
        .arg(&output)
        .status()?;
    if !status.success() {
        return Err(
            "TypeScript bridge compilation failed; run bun install --frozen-lockfile".into(),
        );
    }
    let source = std::fs::read_to_string(&output)?;
    let source = source
        .strip_prefix("\"use strict\";\n")
        .ok_or("missing browser bindings strict prologue")?;
    let source = format!("export default {source}");
    let runtime = rquickjs::Runtime::new()?;
    let context = rquickjs::Context::full(&runtime)?;
    let bytes = context.with(|ctx| {
        rquickjs::Module::declare(ctx, "nimbo:bindings", source)?.write(rquickjs::WriteOptions {
            endianness: rquickjs::WriteOptionsEndianness::Little,
            strip_source: true,
            ..rquickjs::WriteOptions::default()
        })
    })?;
    std::fs::write(output.with_extension("bytecode"), bytes)?;
    Ok(())
}
