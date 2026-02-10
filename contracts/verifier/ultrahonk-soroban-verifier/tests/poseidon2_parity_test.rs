use soroban_sdk::{testutils::Ledger, Bytes, Env};
use std::{fs, path::PathBuf};
use ultrahonk_soroban_verifier::{
    transcript::generate_transcript_trace,
    utils::{load_proof, load_vk_from_bytes},
    TranscriptHash,
};

#[derive(Debug)]
struct ExpectedTraceStep {
    label: String,
    digest: [u8; 32],
    challenge_lo: [u8; 32],
    challenge_hi: [u8; 32],
    input_fields: Vec<[u8; 32]>,
}

fn parse_hex_32(hex: &str) -> Result<[u8; 32], String> {
    if hex.len() != 64 {
        return Err(format!("expected 64 hex chars, got {}", hex.len()));
    }
    let mut out = [0u8; 32];
    for i in 0..32 {
        let byte_hex = &hex[i * 2..i * 2 + 2];
        out[i] = u8::from_str_radix(byte_hex, 16).map_err(|e| format!("invalid hex byte: {e}"))?;
    }
    Ok(out)
}

fn hex_32(bytes: &[u8; 32]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn parse_trace_fixture(path: &PathBuf) -> Result<Vec<ExpectedTraceStep>, String> {
    let text = fs::read_to_string(path).map_err(|e| format!("read fixture failed: {e}"))?;
    let mut steps = Vec::new();

    for (line_no, raw_line) in text.lines().enumerate() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let parts: Vec<&str> = line.split('|').collect();
        if parts.len() != 5 {
            return Err(format!(
                "line {} malformed: expected 5 columns",
                line_no + 1
            ));
        }

        let inputs = if parts[4].is_empty() {
            Vec::new()
        } else {
            parts[4]
                .split(',')
                .map(parse_hex_32)
                .collect::<Result<Vec<_>, _>>()?
        };

        steps.push(ExpectedTraceStep {
            label: parts[0].to_string(),
            digest: parse_hex_32(parts[1])?,
            challenge_lo: parse_hex_32(parts[2])?,
            challenge_hi: parse_hex_32(parts[3])?,
            input_fields: inputs,
        });
    }

    Ok(steps)
}

#[test]
fn poseidon2_transcript_trace_matches_bbjs_fixture() -> Result<(), String> {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    env.ledger().set_protocol_version(25);

    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..");
    let artifacts = repo_root
        .join("circuits")
        .join("rps_commit")
        .join("artifacts");

    let vk_path = artifacts.join("vk.bin");
    let proof_path = artifacts.join("proof.bin");
    let public_inputs_path = artifacts.join("public_inputs.bin");
    let trace_path = artifacts.join("transcript_poseidon2_trace.txt");

    let vk_raw =
        fs::read(&vk_path).map_err(|e| format!("read {} failed: {e}", vk_path.display()))?;
    let proof_raw =
        fs::read(&proof_path).map_err(|e| format!("read {} failed: {e}", proof_path.display()))?;
    let public_inputs_raw = fs::read(&public_inputs_path)
        .map_err(|e| format!("read {} failed: {e}", public_inputs_path.display()))?;
    let expected_steps = parse_trace_fixture(&trace_path)?;

    let vk_bytes = Bytes::from_slice(&env, &vk_raw);
    let vk = load_vk_from_bytes(&vk_bytes).ok_or("vk parse error".to_string())?;
    let proof_bytes = Bytes::from_slice(&env, &proof_raw);
    let public_inputs = Bytes::from_slice(&env, &public_inputs_raw);
    let proof = load_proof(&proof_bytes);

    let provided = (public_inputs.len() / 32) as u64;
    let trace_steps = generate_transcript_trace(
        &env,
        &proof,
        &public_inputs,
        vk.circuit_size,
        provided + 16,
        1,
        &TranscriptHash::Poseidon2,
    );

    if trace_steps.len() != expected_steps.len() {
        return Err(format!(
            "trace step count mismatch: expected {}, got {}",
            expected_steps.len(),
            trace_steps.len()
        ));
    }

    for (idx, (actual, expected)) in trace_steps.iter().zip(expected_steps.iter()).enumerate() {
        if actual.label != expected.label {
            return Err(format!(
                "first divergence at step {} label: expected {}, got {}",
                idx, expected.label, actual.label
            ));
        }
        if actual.digest != expected.digest {
            return Err(format!(
                "first divergence at step {} ({}) digest: expected {}, got {}",
                idx,
                expected.label,
                hex_32(&expected.digest),
                hex_32(&actual.digest)
            ));
        }
        if actual.challenge_lo != expected.challenge_lo {
            return Err(format!(
                "first divergence at step {} ({}) challenge_lo: expected {}, got {}",
                idx,
                expected.label,
                hex_32(&expected.challenge_lo),
                hex_32(&actual.challenge_lo)
            ));
        }
        if actual.challenge_hi != expected.challenge_hi {
            return Err(format!(
                "first divergence at step {} ({}) challenge_hi: expected {}, got {}",
                idx,
                expected.label,
                hex_32(&expected.challenge_hi),
                hex_32(&actual.challenge_hi)
            ));
        }
        if actual.input_fields != expected.input_fields {
            return Err(format!(
                "first divergence at step {} ({}) input_fields",
                idx, expected.label
            ));
        }
    }

    Ok(())
}
