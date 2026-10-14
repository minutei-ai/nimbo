//! CLI budget attestation must describe the same defaults used by page construction.
use nimbo_engine::Limits;
use std::process::Command;

#[test]
fn cli_attests_all_default_limits_without_navigation() -> Result<(), Box<dyn std::error::Error>> {
    let output = Command::new(env!("CARGO_BIN_EXE_nimbo-engine"))
        .arg("--limits")
        .env_remove("NIMBO_PROXY_URL")
        .output()?;
    assert!(output.status.success());
    let reported: serde_json::Value = serde_json::from_slice(&output.stdout)?;
    assert_eq!(reported, serde_json::to_value(Limits::default())?);
    assert!(
        !Command::new(env!("CARGO_BIN_EXE_nimbo-engine"))
            .args(["--limits", "unexpected"])
            .output()?
            .status
            .success()
    );
    Ok(())
}
