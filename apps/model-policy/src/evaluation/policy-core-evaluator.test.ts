import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { CONTRACT_ERROR_CODES, mapContractError } from "./error-mapping";
import { createPolicyCoreEvaluator } from "./policy-core-evaluator";

// mapContractError is pure — always exercised, no WASM toolchain required.
describe("mapContractError", () => {
  test("passes every contract code through with its message", () => {
    for (const code of CONTRACT_ERROR_CODES) {
      expect(mapContractError(code, "why")).toEqual({ code, message: "why" });
    }
  });

  test("fails closed to engine-unknown on an unlisted code", () => {
    expect(mapContractError("brand-new-code", "why")).toEqual({
      code: "engine-unknown",
      message: "why",
    });
    expect(mapContractError(undefined, "why").code).toBe("engine-unknown");
  });

  test("falls back to a stable message when none is provided", () => {
    expect(mapContractError("tenant-mismatch", undefined).message).toBe(
      "policy-core evaluation refused",
    );
    expect(mapContractError("tenant-mismatch", "").message).toBe("policy-core evaluation refused");
  });
});

interface GoldenCase {
  id: string;
  policy: unknown;
  snapshot: unknown;
  need: unknown;
  evaluatedAt: string;
  expectedEvaluation?: Record<string, unknown>;
  expectedError?: { variant: string };
}

// The golden set is read unconditionally, before tests are registered: a missing
// or unreadable file fails this suite even when the WASM artifact is absent.
const goldenPath = resolve(
  import.meta.dir,
  "../../../../node_modules/@libre-ai/contracts-authority/contracts/fixtures/policy-core-v2/golden.json",
);
const golden = (await Bun.file(goldenPath).json()) as { cases: GoldenCase[] };
if (!Array.isArray(golden.cases) || golden.cases.length === 0) {
  throw new Error(`golden.json declares no conformance case: ${goldenPath}`);
}
const goldenCases: GoldenCase[] = golden.cases;

// Live integration: needs the built artifact (node tools/quality/build-policy-core-wasm.ts).
// The root `check` script builds it (`check:wasm-build`) before this suite runs, so CI
// replays every golden case against the WASM built from the current code. Under CI
// (`CI=true`, set by every GitHub Actions runner and inherited by the composition) an
// absent artifact fails this suite: a skip there would hide a reordered or broken build.
// Outside CI the suite may skip, and the skip and its volume are printed, never silent.
const generatedDirectory = resolve(
  import.meta.dir,
  "../../../../target/policy-core-wasm/generated",
);
const artifactBuilt = existsSync(resolve(generatedDirectory, "policy-core.js"));
const artifactRequired = process.env.CI === "true";
if (artifactBuilt) {
  console.log(`policy-core WASM evaluator (live): ${goldenCases.length} golden case(s) loaded`);
} else if (artifactRequired) {
  throw new Error(
    `policy-core WASM evaluator (live): artifact absent under CI=true, ${goldenCases.length} golden case(s) would not be replayed; run bun run check:wasm-build first`,
  );
} else {
  console.warn(
    `policy-core WASM evaluator (live): SKIPPED, ${goldenCases.length} golden case(s) not replayed — artifact absent; build it with node tools/quality/build-policy-core-wasm.ts`,
  );
}

const encoder = new TextEncoder();
function bytes(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

describe.skipIf(!artifactBuilt)("policy-core WASM evaluator (live)", () => {
  let evaluator: Awaited<ReturnType<typeof createPolicyCoreEvaluator>>;

  beforeAll(async () => {
    evaluator = await createPolicyCoreEvaluator(generatedDirectory);
  });

  test("golden set holds both a success and an error vector", () => {
    expect(goldenCases.some((c) => c.expectedEvaluation)).toBe(true);
    expect(goldenCases.some((c) => c.expectedError)).toBe(true);
  });

  for (const [index, vector] of goldenCases.entries()) {
    test(`golden vector ${index} (${vector.id})`, () => {
      const result = evaluator.evaluate(
        bytes(vector.policy),
        bytes(vector.snapshot),
        bytes(vector.need),
        vector.evaluatedAt,
      );
      if (vector.expectedError) {
        // A contract error maps to a typed refusal carrying the WIT variant.
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code as string).toBe(vector.expectedError.variant);
        return;
      }
      if (!vector.expectedEvaluation) {
        throw new Error(`golden case ${vector.id} has neither expectedEvaluation nor expectedError`);
      }
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(JSON.parse(new TextDecoder().decode(result.value))).toEqual(vector.expectedEvaluation);
    });
  }
});
