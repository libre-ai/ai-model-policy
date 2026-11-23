// Strict decoding at the component boundary (policy-core-v2 SEMANTICS.md §2):
// "The decoder MUST reject [...] duplicate JSON object member names [...] nesting
// deeper than 64 values", and every decoder refusal is the `input-invalid` variant.
//
// Each refusal below is paired with a control that differs only by the defect and
// evaluates successfully, so a refusal cannot come from anything but the defect.

use policy_core::{ErrorCode, evaluate};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;

const GOLDEN_V2: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../node_modules/@libre-ai/contracts-authority/contracts/fixtures/policy-core-v2/golden.json"
);
const RAW_INPUTS_V2: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../node_modules/@libre-ai/contracts-authority/contracts/fixtures/policy-core-invalid-json"
);
const CASE_ID: &str = "all-operators-eligible";

struct GoldenCase {
    policy: Vec<u8>,
    snapshot: Vec<u8>,
    need: Vec<u8>,
    evaluated_at: String,
}

fn golden_case() -> GoldenCase {
    let text = fs::read_to_string(GOLDEN_V2).expect("policy-core-v2 golden.json is readable");
    let golden: Value = serde_json::from_str(&text).expect("golden.json is JSON");
    let case = golden["cases"]
        .as_array()
        .and_then(|cases| cases.iter().find(|case| case["id"] == CASE_ID))
        .expect("golden.json declares the all-operators-eligible case");
    GoldenCase {
        policy: serde_json::to_vec(&case["policy"]).expect("policy serializes"),
        snapshot: serde_json::to_vec(&case["snapshot"]).expect("snapshot serializes"),
        need: serde_json::to_vec(&case["need"]).expect("need serializes"),
        evaluated_at: case["evaluatedAt"]
            .as_str()
            .expect("evaluatedAt is a string")
            .to_string(),
    }
}

/// The outcome only: a failing assertion then prints a variant, not the JCS bytes.
fn evaluate_policy(case: &GoldenCase, policy: &[u8]) -> Result<(), ErrorCode> {
    evaluate(policy, &case.snapshot, &case.need, &case.evaluated_at).map(|_| ())
}

/// The golden policy with `member` inserted right after the first occurrence of `anchor`.
fn insert_after(policy: &[u8], anchor: &str, member: &str) -> Vec<u8> {
    let text = std::str::from_utf8(policy).expect("serialized policy is UTF-8");
    let at = text
        .find(anchor)
        .expect("anchor is present in the golden policy")
        + anchor.len();
    format!("{}{}{}", &text[..at], member, &text[at..]).into_bytes()
}

fn nested_arrays(levels: usize) -> String {
    format!("{}{}", "[".repeat(levels), "]".repeat(levels))
}

#[test]
fn golden_policy_control_is_eligible() {
    let case = golden_case();
    assert!(evaluate_policy(&case, &case.policy).is_ok());
}

#[test]
fn duplicate_member_at_the_root_is_input_invalid() {
    let case = golden_case();
    // A last-wins decoder reads "approved", the golden value, and evaluates the
    // golden policy; a first-wins decoder reads "draft".
    let policy = insert_after(&case.policy, "{", r#""status":"draft","#);
    assert_eq!(
        evaluate_policy(&case, &policy),
        Err(ErrorCode::InputInvalid)
    );
}

#[test]
fn duplicate_member_in_a_nested_object_is_input_invalid() {
    let case = golden_case();
    // A last-wins decoder reads "human" and passes approval separation; a
    // first-wins decoder reads "agent" and would refuse with approval-invalid.
    let policy = insert_after(&case.policy, r#""approval":{"#, r#""actorKind":"agent","#);
    assert_eq!(
        evaluate_policy(&case, &policy),
        Err(ErrorCode::InputInvalid)
    );
}

#[test]
fn policy_core_v3_duplicate_member_carrier_is_input_invalid() {
    // Provenance: libre-ai/schemas-and-contracts, pull request #44 head
    // 5d4c1513f64d7d5cd084c288fd41ac0be6ccd696,
    // contracts/fixtures/policy-core-v3/raw-inputs/carrier-duplicate-member.bin
    // (Apache-2.0). Its manifest records the digest and length asserted below.
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/carrier-duplicate-member.bin"
    );
    let carrier = fs::read(path).expect("carrier fixture is readable");
    let digest: String = Sha256::digest(&carrier)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    assert_eq!(
        digest,
        "27ff64871a5886d96f4fa43432fe658df8ad523d19ce7965efb0762311e5f822"
    );
    assert_eq!(carrier.len(), 4769);

    let case = golden_case();
    // Control: the carrier minus its leading duplicate is a valid golden policy.
    let duplicate = br#""status":"approved","#;
    assert_eq!(&carrier[1..1 + duplicate.len()], duplicate);
    let mut without_duplicate = vec![carrier[0]];
    without_duplicate.extend_from_slice(&carrier[1 + duplicate.len()..]);
    assert!(evaluate_policy(&case, &without_duplicate).is_ok());

    assert_eq!(
        evaluate_policy(&case, &carrier),
        Err(ErrorCode::InputInvalid)
    );
}

#[test]
fn nesting_seventy_deep_is_input_invalid() {
    let case = golden_case();
    let policy = insert_after(&case.policy, "{", &format!(r#""x":{},"#, nested_arrays(70)));
    assert_eq!(
        evaluate_policy(&case, &policy),
        Err(ErrorCode::InputInvalid)
    );
}

#[test]
fn policy_core_v2_raw_input_vectors_are_refused_with_their_variant() {
    // These vectors are not policies: a lenient decoder also ends in input-invalid,
    // so they guard non-regression, not the strict decoder itself.
    let manifest_path = format!("{RAW_INPUTS_V2}/manifest.json");
    let manifest_text = fs::read_to_string(&manifest_path).expect("raw-input manifest is readable");
    let manifest: Value = serde_json::from_str(&manifest_text).expect("manifest is JSON");
    let cases = manifest["cases"]
        .as_array()
        .expect("manifest declares cases");
    assert!(!cases.is_empty(), "raw-input manifest declares no case");

    let golden = golden_case();
    let mut examined = 0;
    for case in cases {
        let id = case["id"].as_str().expect("case id");
        let file = case["file"].as_str().expect("case file");
        let bytes = fs::read(format!("{RAW_INPUTS_V2}/{file}")).expect("raw input is readable");
        let expected = case["expectedErrors"]["policy-core-v2"]["variant"]
            .as_str()
            .expect("case declares a policy-core-v2 variant");
        let got = evaluate_policy(&golden, &bytes)
            .err()
            .map(|code| code.as_str());
        assert_eq!(got, Some(expected), "raw input {id}");
        examined += 1;
    }
    println!("policy-core-v2 raw-input vectors examined: {examined}");
    assert_eq!(examined, cases.len());
}
