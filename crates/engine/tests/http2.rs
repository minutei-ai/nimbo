//! Native HTTP/2 negotiation and decoded subresources on a real TLS origin.

use std::process::Command;

#[test]
fn native_transport_negotiates_http2_and_decodes_compressed_subresources()
-> Result<(), Box<dyn std::error::Error>> {
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tooling/native-http2-fixture.ts");
    let output = Command::new("node")
        .arg("--experimental-strip-types")
        .arg(fixture)
        .arg(env!("CARGO_BIN_EXE_nimbo-engine"))
        .output()?;
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let report: serde_json::Value = serde_json::from_slice(&output.stdout)?;
    assert_eq!(report.get("requests"), Some(&serde_json::json!(4)));
    assert_eq!(report.get("protocol"), Some(&serde_json::json!("h2")));
    assert_eq!(report.get("encoding"), Some(&serde_json::json!("gzip")));
    Ok(())
}
