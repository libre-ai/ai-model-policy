import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { type ErrorCode, evaluate, jcs } from "../index";

interface GoldenCase {
  id: string;
  policy: unknown;
  snapshot: unknown;
  need: unknown;
  evaluatedAt: string;
  expectedEvaluation?: unknown;
  expectedError?: { variant: string };
}

interface GoldenFile {
  schemaVersion: string;
  engineVersion: string;
  canonicalization: string;
  digestAlgorithm: string;
  semantics: string;
  cases: GoldenCase[];
}

const GOLDEN_URL = new URL(
  "../../../../node_modules/@libre-ai/contracts-authority/contracts/fixtures/policy-core-v2/golden.json",
  import.meta.url,
);

// Loaded at module evaluation, before any test is registered: `bun test` collects
// tests synchronously, so a set loaded in `beforeAll` cannot size the loop and
// the case count would have to be written by hand. A missing or unreadable file
// rejects here and fails the whole suite; it never registers zero tests.
const golden = JSON.parse(await readFile(GOLDEN_URL, "utf8")) as GoldenFile;
if (!Array.isArray(golden.cases) || golden.cases.length === 0) {
  throw new Error(`golden.json declares no conformance case: ${GOLDEN_URL.pathname}`);
}
const goldenCases: GoldenCase[] = golden.cases;
console.log(`policy-core-ref golden conformance: ${goldenCases.length} case(s) loaded`);

describe(`golden vector conformance (${goldenCases.length} cases)`, () => {
  it("loads a non-empty golden set", () => {
    expect(goldenCases.length).toBeGreaterThan(0);
  });

  for (const [index, testCase] of goldenCases.entries()) {
    it(`should pass golden vector ${index} (${testCase.id})`, async () => {
      const policyBytes = new TextEncoder().encode(JSON.stringify(testCase.policy));
      const snapshotBytes = new TextEncoder().encode(JSON.stringify(testCase.snapshot));
      const needBytes = new TextEncoder().encode(JSON.stringify(testCase.need));

      const result = await evaluate(
        new Uint8Array(policyBytes),
        new Uint8Array(snapshotBytes),
        new Uint8Array(needBytes),
        testCase.evaluatedAt,
      );

      if (testCase.expectedError) {
        expect(result.ok).toBe(false);
        if (!result.ok) {
          // Error codes use hyphens in WIT (input-invalid, not input_invalid)
          const expectedVariant = testCase.expectedError.variant as ErrorCode;
          expect(result.error).toBe(expectedVariant);
        }
        return;
      }

      if (testCase.expectedEvaluation === undefined) {
        // A case that states no expectation would otherwise pass without asserting anything.
        throw new Error(`golden case ${testCase.id} has neither expectedEvaluation nor expectedError`);
      }

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Both sides are canonicalized to JCS before comparison.
      const decodedResult = JSON.parse(new TextDecoder().decode(result.jcs));
      const expectedJcs = new TextDecoder().decode(jcs(testCase.expectedEvaluation));
      const resultJcs = new TextDecoder().decode(jcs(decodedResult));
      expect(resultJcs).toBe(expectedJcs);
      expect(result.jcs.byteLength).toBe(jcs(testCase.expectedEvaluation).byteLength);
    });
  }
});
