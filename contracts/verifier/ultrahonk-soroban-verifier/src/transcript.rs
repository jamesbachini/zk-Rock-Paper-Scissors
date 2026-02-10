//! Fiat–Shamir transcript for UltraHonk

use crate::trace;
use crate::{
    field::Fr,
    hash::{hash_with, TranscriptHash},
    types::{
        G1Point, Proof, RelationParameters, Transcript, CONST_PROOF_SIZE_LOG_N, NUMBER_OF_ALPHAS,
    },
    utils::coord_to_halves_be,
};
use alloc::{string::String, vec::Vec as AllocVec};
use soroban_sdk::{Bytes, Env};

fn push_point(buf: &mut Bytes, pt: &G1Point) {
    // Serialize a coordinate into two bn254::Fr limbs (lo136, hi<=118)
    let (x_lo, x_hi) = coord_to_halves_be(&pt.x);
    let (y_lo, y_hi) = coord_to_halves_be(&pt.y);
    buf.extend_from_slice(&x_lo);
    buf.extend_from_slice(&x_hi);
    buf.extend_from_slice(&y_lo);
    buf.extend_from_slice(&y_hi);
}

fn split_challenge(challenge: Fr) -> (Fr, Fr) {
    let challenge_bytes = challenge.to_bytes();
    let mut low_bytes = [0u8; 32];
    low_bytes[16..].copy_from_slice(&challenge_bytes[16..]);
    let mut high_bytes = [0u8; 32];
    high_bytes[16..].copy_from_slice(&challenge_bytes[..16]);
    (Fr::from_bytes(&low_bytes), Fr::from_bytes(&high_bytes))
}

#[inline(always)]
fn hash_to_fr(bytes: &Bytes, hasher: &TranscriptHash) -> Fr {
    Fr::from_bytes(&hash_with(bytes, hasher))
}

fn u64_to_be32(x: u64) -> [u8; 32] {
    let mut out = [0u8; 32];
    out[24..].copy_from_slice(&x.to_be_bytes());
    out
}

/// One hash step in the transcript challenge derivation flow.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TranscriptTraceStep {
    pub label: String,
    pub digest: [u8; 32],
    pub challenge_lo: [u8; 32],
    pub challenge_hi: [u8; 32],
    pub input_fields: AllocVec<[u8; 32]>,
}

fn bytes_to_fields_be(data: &Bytes) -> AllocVec<[u8; 32]> {
    let mut out = AllocVec::new();
    let mut idx = 0u32;
    while idx < data.len() {
        let mut chunk = [0u8; 32];
        let remaining = data.len() - idx;
        let chunk_len = if remaining >= 32 { 32 } else { remaining };
        for i in 0..chunk_len {
            chunk[i as usize] = data.get_unchecked(idx + i);
        }
        out.push(chunk);
        idx += chunk_len;
    }
    out
}

fn record_hash_step(
    label: &str,
    data: &Bytes,
    hasher: &TranscriptHash,
    trace_steps: &mut AllocVec<TranscriptTraceStep>,
) -> Fr {
    let digest = hash_with(data, hasher);
    let challenge = Fr::from_bytes(&digest);
    let (lo, hi) = split_challenge(challenge);
    trace_steps.push(TranscriptTraceStep {
        label: String::from(label),
        digest,
        challenge_lo: lo.to_bytes(),
        challenge_hi: hi.to_bytes(),
        input_fields: bytes_to_fields_be(data),
    });
    challenge
}

fn generate_eta_challenge(
    env: &Env,
    proof: &Proof,
    public_inputs: &Bytes,
    circuit_size: u64,
    public_inputs_size: u64,
    pub_inputs_offset: u64,
    hasher: &TranscriptHash,
) -> (Fr, Fr, Fr, Fr) {
    let mut data = Bytes::new(env);
    data.extend_from_slice(&u64_to_be32(circuit_size));
    data.extend_from_slice(&u64_to_be32(public_inputs_size));
    data.extend_from_slice(&u64_to_be32(pub_inputs_offset));
    data.append(public_inputs);
    for fr in &proof.pairing_point_object {
        data.extend_from_slice(&fr.to_bytes());
    }
    for w in &[&proof.w1, &proof.w2, &proof.w3] {
        push_point(&mut data, w);
    }

    let previous_challenge = hash_to_fr(&data, hasher);
    let (eta, eta_two) = split_challenge(previous_challenge);
    let prev_bytes = Bytes::from_array(env, &previous_challenge.to_bytes());
    let previous_challenge = hash_to_fr(&prev_bytes, hasher);
    let (eta_three, _) = split_challenge(previous_challenge);

    (eta, eta_two, eta_three, previous_challenge)
}

fn generate_beta_and_gamma_challenges(
    env: &Env,
    previous_challenge: Fr,
    proof: &Proof,
    hasher: &TranscriptHash,
) -> (Fr, Fr, Fr) {
    let mut data = Bytes::new(env);
    data.extend_from_slice(&previous_challenge.to_bytes());
    for w in &[
        &proof.lookup_read_counts,
        &proof.lookup_read_tags,
        &proof.w4,
    ] {
        push_point(&mut data, w);
    }
    let next_previous_challenge = hash_to_fr(&data, hasher);
    let (beta, gamma) = split_challenge(next_previous_challenge);
    (beta, gamma, next_previous_challenge)
}

fn generate_alpha_challenges(
    env: &Env,
    previous_challenge: Fr,
    proof: &Proof,
    hasher: &TranscriptHash,
) -> ([Fr; NUMBER_OF_ALPHAS], Fr) {
    let mut data = Bytes::new(env);
    data.extend_from_slice(&previous_challenge.to_bytes());
    for w in &[&proof.lookup_inverses, &proof.z_perm] {
        push_point(&mut data, w);
    }
    let mut next_previous_challenge = hash_to_fr(&data, hasher);

    let mut alphas = [Fr::zero(); NUMBER_OF_ALPHAS];
    let (a0, a1) = split_challenge(next_previous_challenge);
    alphas[0] = a0;
    alphas[1] = a1;

    for i in 1..(NUMBER_OF_ALPHAS / 2) {
        let next_bytes = Bytes::from_array(env, &next_previous_challenge.to_bytes());
        next_previous_challenge = hash_to_fr(&next_bytes, hasher);
        let (lo, hi) = split_challenge(next_previous_challenge);
        alphas[2 * i] = lo;
        alphas[2 * i + 1] = hi;
    }

    if (NUMBER_OF_ALPHAS & 1) == 1 && NUMBER_OF_ALPHAS > 2 {
        let next_bytes = Bytes::from_array(env, &next_previous_challenge.to_bytes());
        next_previous_challenge = hash_to_fr(&next_bytes, hasher);
        let (last, _) = split_challenge(next_previous_challenge);
        alphas[NUMBER_OF_ALPHAS - 1] = last;
    }

    (alphas, next_previous_challenge)
}

fn generate_relation_parameters_challenges(
    env: &Env,
    proof: &Proof,
    public_inputs: &Bytes,
    circuit_size: u64,
    public_inputs_size: u64,
    pub_inputs_offset: u64,
    hasher: &TranscriptHash,
) -> (RelationParameters, Fr) {
    let (eta, eta_two, eta_three, previous_challenge) = generate_eta_challenge(
        env,
        proof,
        public_inputs,
        circuit_size,
        public_inputs_size,
        pub_inputs_offset,
        hasher,
    );
    let (beta, gamma, next_previous_challenge) =
        generate_beta_and_gamma_challenges(env, previous_challenge, proof, hasher);
    let rp = RelationParameters {
        eta,
        eta_two,
        eta_three,
        beta,
        gamma,
        public_inputs_delta: Fr::zero(),
    };
    (rp, next_previous_challenge)
}

fn generate_gate_challenges(
    env: &Env,
    previous_challenge: Fr,
    hasher: &TranscriptHash,
) -> ([Fr; CONST_PROOF_SIZE_LOG_N], Fr) {
    let mut next_previous_challenge = previous_challenge;
    let mut gate_challenges = [Fr::zero(); CONST_PROOF_SIZE_LOG_N];
    for i in 0..CONST_PROOF_SIZE_LOG_N {
        let next_bytes = Bytes::from_array(env, &next_previous_challenge.to_bytes());
        next_previous_challenge = hash_to_fr(&next_bytes, hasher);
        gate_challenges[i] = split_challenge(next_previous_challenge).0;
    }
    (gate_challenges, next_previous_challenge)
}

fn generate_sumcheck_challenges(
    env: &Env,
    proof: &Proof,
    previous_challenge: Fr,
    hasher: &TranscriptHash,
) -> ([Fr; CONST_PROOF_SIZE_LOG_N], Fr) {
    let mut next_previous_challenge = previous_challenge;
    let mut sumcheck_challenges = [Fr::zero(); CONST_PROOF_SIZE_LOG_N];
    for r in 0..CONST_PROOF_SIZE_LOG_N {
        let mut data = Bytes::new(env);
        data.extend_from_slice(&next_previous_challenge.to_bytes());
        for &c in proof.sumcheck_univariates[r].iter() {
            data.extend_from_slice(&c.to_bytes());
        }
        next_previous_challenge = hash_to_fr(&data, hasher);
        sumcheck_challenges[r] = split_challenge(next_previous_challenge).0;
    }
    (sumcheck_challenges, next_previous_challenge)
}

fn generate_rho_challenge(
    env: &Env,
    proof: &Proof,
    previous_challenge: Fr,
    hasher: &TranscriptHash,
) -> (Fr, Fr) {
    let mut data = Bytes::new(env);
    data.extend_from_slice(&previous_challenge.to_bytes());
    for &e in proof.sumcheck_evaluations.iter() {
        data.extend_from_slice(&e.to_bytes());
    }
    let next_previous_challenge = hash_to_fr(&data, hasher);
    let rho = split_challenge(next_previous_challenge).0;
    (rho, next_previous_challenge)
}

fn generate_gemini_r_challenge(
    env: &Env,
    proof: &Proof,
    previous_challenge: Fr,
    hasher: &TranscriptHash,
) -> (Fr, Fr) {
    let mut data = Bytes::new(env);
    data.extend_from_slice(&previous_challenge.to_bytes());
    for pt in proof.gemini_fold_comms.iter() {
        push_point(&mut data, pt);
    }
    let next_previous_challenge = hash_to_fr(&data, hasher);
    let gemini_r = split_challenge(next_previous_challenge).0;
    (gemini_r, next_previous_challenge)
}

fn generate_shplonk_nu_challenge(
    env: &Env,
    proof: &Proof,
    previous_challenge: Fr,
    hasher: &TranscriptHash,
) -> (Fr, Fr) {
    let mut data = Bytes::new(env);
    data.extend_from_slice(&previous_challenge.to_bytes());
    for &a in proof.gemini_a_evaluations.iter() {
        data.extend_from_slice(&a.to_bytes());
    }
    let next_previous_challenge = hash_to_fr(&data, hasher);
    let shplonk_nu = split_challenge(next_previous_challenge).0;
    (shplonk_nu, next_previous_challenge)
}

fn generate_shplonk_z_challenge(
    env: &Env,
    proof: &Proof,
    previous_challenge: Fr,
    hasher: &TranscriptHash,
) -> (Fr, Fr) {
    let mut data = Bytes::new(env);
    data.extend_from_slice(&previous_challenge.to_bytes());
    push_point(&mut data, &proof.shplonk_q);
    let next_previous_challenge = hash_to_fr(&data, hasher);
    let shplonk_z = split_challenge(next_previous_challenge).0;
    (shplonk_z, next_previous_challenge)
}

/// Produce deterministic transcript hashing trace data for parity checks.
pub fn generate_transcript_trace(
    env: &Env,
    proof: &Proof,
    public_inputs: &Bytes,
    circuit_size: u64,
    public_inputs_size: u64,
    pub_inputs_offset: u64,
    hasher: &TranscriptHash,
) -> AllocVec<TranscriptTraceStep> {
    let mut trace_steps = AllocVec::new();

    let mut eta_seed = Bytes::new(env);
    eta_seed.extend_from_slice(&u64_to_be32(circuit_size));
    eta_seed.extend_from_slice(&u64_to_be32(public_inputs_size));
    eta_seed.extend_from_slice(&u64_to_be32(pub_inputs_offset));
    eta_seed.append(public_inputs);
    for fr in &proof.pairing_point_object {
        eta_seed.extend_from_slice(&fr.to_bytes());
    }
    for w in &[&proof.w1, &proof.w2, &proof.w3] {
        push_point(&mut eta_seed, w);
    }
    let mut previous_challenge =
        record_hash_step("eta_round_0", &eta_seed, hasher, &mut trace_steps);

    let prev_bytes = Bytes::from_array(env, &previous_challenge.to_bytes());
    previous_challenge = record_hash_step("eta_round_1", &prev_bytes, hasher, &mut trace_steps);

    let mut beta_gamma_seed = Bytes::new(env);
    beta_gamma_seed.extend_from_slice(&previous_challenge.to_bytes());
    for w in &[
        &proof.lookup_read_counts,
        &proof.lookup_read_tags,
        &proof.w4,
    ] {
        push_point(&mut beta_gamma_seed, w);
    }
    previous_challenge = record_hash_step(
        "beta_gamma_round_0",
        &beta_gamma_seed,
        hasher,
        &mut trace_steps,
    );

    let mut alpha_seed = Bytes::new(env);
    alpha_seed.extend_from_slice(&previous_challenge.to_bytes());
    for w in &[&proof.lookup_inverses, &proof.z_perm] {
        push_point(&mut alpha_seed, w);
    }
    previous_challenge = record_hash_step("alpha_round_0", &alpha_seed, hasher, &mut trace_steps);

    for i in 1..(NUMBER_OF_ALPHAS / 2) {
        let next_bytes = Bytes::from_array(env, &previous_challenge.to_bytes());
        let label = alloc::format!("alpha_round_{i}");
        previous_challenge = record_hash_step(&label, &next_bytes, hasher, &mut trace_steps);
    }

    if (NUMBER_OF_ALPHAS & 1) == 1 && NUMBER_OF_ALPHAS > 2 {
        let next_bytes = Bytes::from_array(env, &previous_challenge.to_bytes());
        previous_challenge =
            record_hash_step("alpha_round_last", &next_bytes, hasher, &mut trace_steps);
    }

    for i in 0..CONST_PROOF_SIZE_LOG_N {
        let next_bytes = Bytes::from_array(env, &previous_challenge.to_bytes());
        let label = alloc::format!("gate_round_{i}");
        previous_challenge = record_hash_step(&label, &next_bytes, hasher, &mut trace_steps);
    }

    for r in 0..CONST_PROOF_SIZE_LOG_N {
        let mut sumcheck_seed = Bytes::new(env);
        sumcheck_seed.extend_from_slice(&previous_challenge.to_bytes());
        for &c in proof.sumcheck_univariates[r].iter() {
            sumcheck_seed.extend_from_slice(&c.to_bytes());
        }
        let label = alloc::format!("sumcheck_round_{r}");
        previous_challenge = record_hash_step(&label, &sumcheck_seed, hasher, &mut trace_steps);
    }

    let mut rho_seed = Bytes::new(env);
    rho_seed.extend_from_slice(&previous_challenge.to_bytes());
    for &e in proof.sumcheck_evaluations.iter() {
        rho_seed.extend_from_slice(&e.to_bytes());
    }
    previous_challenge = record_hash_step("rho_round_0", &rho_seed, hasher, &mut trace_steps);

    let mut gemini_seed = Bytes::new(env);
    gemini_seed.extend_from_slice(&previous_challenge.to_bytes());
    for pt in proof.gemini_fold_comms.iter() {
        push_point(&mut gemini_seed, pt);
    }
    previous_challenge =
        record_hash_step("gemini_r_round_0", &gemini_seed, hasher, &mut trace_steps);

    let mut shplonk_nu_seed = Bytes::new(env);
    shplonk_nu_seed.extend_from_slice(&previous_challenge.to_bytes());
    for &a in proof.gemini_a_evaluations.iter() {
        shplonk_nu_seed.extend_from_slice(&a.to_bytes());
    }
    previous_challenge = record_hash_step(
        "shplonk_nu_round_0",
        &shplonk_nu_seed,
        hasher,
        &mut trace_steps,
    );

    let mut shplonk_z_seed = Bytes::new(env);
    shplonk_z_seed.extend_from_slice(&previous_challenge.to_bytes());
    push_point(&mut shplonk_z_seed, &proof.shplonk_q);
    let _ = record_hash_step(
        "shplonk_z_round_0",
        &shplonk_z_seed,
        hasher,
        &mut trace_steps,
    );

    trace_steps
}

pub fn generate_transcript(
    env: &Env,
    proof: &Proof,
    public_inputs: &Bytes,
    circuit_size: u64,
    public_inputs_size: u64,
    pub_inputs_offset: u64,
    hasher: &TranscriptHash,
) -> Transcript {
    // 1) eta/beta/gamma
    let (rp, previous_challenge) = generate_relation_parameters_challenges(
        env,
        proof,
        public_inputs,
        circuit_size,
        public_inputs_size,
        pub_inputs_offset,
        hasher,
    );

    // 2) alphas
    let (alphas, previous_challenge) =
        generate_alpha_challenges(env, previous_challenge, proof, hasher);

    // 3) gate challenges
    let (gate_chals, previous_challenge) =
        generate_gate_challenges(env, previous_challenge, hasher);

    // 4) sumcheck challenges
    let (u_chals, previous_challenge) =
        generate_sumcheck_challenges(env, proof, previous_challenge, hasher);

    // 5) rho
    let (rho, previous_challenge) = generate_rho_challenge(env, proof, previous_challenge, hasher);

    // 6) gemini_r
    let (gemini_r, previous_challenge) =
        generate_gemini_r_challenge(env, proof, previous_challenge, hasher);

    // 7) shplonk_nu
    let (shplonk_nu, previous_challenge) =
        generate_shplonk_nu_challenge(env, proof, previous_challenge, hasher);

    // 8) shplonk_z
    let (shplonk_z, _previous_challenge) =
        generate_shplonk_z_challenge(env, proof, previous_challenge, hasher);

    trace!("===== TRANSCRIPT PARAMETERS =====");
    trace!("eta = 0x{}", hex::encode(rp.eta.to_bytes()));
    trace!("eta_two = 0x{}", hex::encode(rp.eta_two.to_bytes()));
    trace!("eta_three = 0x{}", hex::encode(rp.eta_three.to_bytes()));
    trace!("beta = 0x{}", hex::encode(rp.beta.to_bytes()));
    trace!("gamma = 0x{}", hex::encode(rp.gamma.to_bytes()));
    trace!("rho = 0x{}", hex::encode(rho.to_bytes()));
    trace!("gemini_r = 0x{}", hex::encode(gemini_r.to_bytes()));
    trace!("shplonk_nu = 0x{}", hex::encode(shplonk_nu.to_bytes()));
    trace!("shplonk_z = 0x{}", hex::encode(shplonk_z.to_bytes()));
    trace!("circuit_size = {}", circuit_size);
    trace!("public_inputs_total = {}", public_inputs_size);
    trace!("public_inputs_offset = {}", pub_inputs_offset);
    trace!("=================================");

    Transcript {
        rel_params: rp,
        alphas,
        gate_challenges: gate_chals,
        sumcheck_u_challenges: u_chals,
        rho,
        gemini_r,
        shplonk_nu,
        shplonk_z,
    }
}
