//! Compila a ponte TypeScript para o diretório de artefatos do Cargo.

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
    for path in ["src/web.ts", "../../tooling/build-web.ts", "../../bun.lock"] {
        writeln!(io::stdout().lock(), "cargo:rerun-if-changed={path}")?;
    }
    let status = Command::new("bun")
        .current_dir(root)
        .arg("run")
        .arg("tooling/build-web.ts")
        .arg(output)
        .status()?;
    if !status.success() {
        return Err(
            "TypeScript bridge compilation failed; run bun install --frozen-lockfile".into(),
        );
    }
    Ok(())
}
