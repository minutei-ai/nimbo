//! Native proxy integration with real forwarding sockets and isolated TLS origins.

use std::process::Command;

#[test]
fn native_cli_proxy_covers_navigation_and_javascript_subrequests()
-> Result<(), Box<dyn std::error::Error>> {
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tooling/native-proxy-fixture.py");
    let output = Command::new("python3")
        .arg(fixture)
        .arg(env!("CARGO_BIN_EXE_nimbo-engine"))
        .output()?;
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let report: serde_json::Value = serde_json::from_slice(&output.stdout)?;
    assert_eq!(
        report.get("origin_requests"),
        Some(&serde_json::json!(2688))
    );
    Ok(())
}
