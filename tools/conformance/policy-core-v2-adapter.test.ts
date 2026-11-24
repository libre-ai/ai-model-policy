// Tests of the `--impl` adapter and of the verdict of the conformance job. Expectations come from
// the pinned contracts authority (golden.json, as the reference package's own conformance test
// reads it) and from the runner's documented summary line, never from the adapter's output.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { jcs } from "../../packages/policy-core-ref/src/index";
import { AdapterRequestError, POLICY_CORE_V2_KIND, respond } from "./policy-core-v2-adapter";
import { verdict } from "./run-policy-core-v2";

interface GoldenCase {
  id: string;
  policy: unknown;
  snapshot: unknown;
  need: unknown;
  evaluatedAt: string;
  expectedEvaluation?: unknown;
  expectedError?: { variant: string };
}

const GOLDEN_URL = new URL(
  "../../node_modules/@libre-ai/contracts-authority/contracts/fixtures/policy-core-v2/golden.json",
  import.meta.url,
);
// A missing or unreadable file rejects at module evaluation and fails the suite.
const golden = JSON.parse(await readFile(GOLDEN_URL, "utf8")) as { cases: GoldenCase[] };
const accepted = golden.cases.find((testCase) => testCase.expectedEvaluation !== undefined);
const rejected = golden.cases.find((testCase) => testCase.expectedError !== undefined);
if (accepted === undefined || rejected === undefined)
  throw new Error("golden.json needs one success case and one error case for these tests");

const adapter = resolve(import.meta.dir, "policy-core-v2-adapter.ts");

function request(testCase: GoldenCase, kind: string = POLICY_CORE_V2_KIND) {
  const { policy, snapshot, need, evaluatedAt } = testCase;
  return { kind, input: { policy, snapshot, need, evaluatedAt }, dir: "/nonexistent" };
}

async function spawnAdapter(stdin: string) {
  const child = Bun.spawn([process.execPath, adapter], {
    stdin: new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(child.stdout).text();
  return { stdout, code: await child.exited };
}

describe("policy-core-v2 adapter", () => {
  test("a success case answers accept, its evaluation and the canonical output text", async () => {
    const response = await respond(request(accepted));
    expect(response.outcome).toBe("accept");
    if (response.outcome !== "accept") return;
    expect(response.evaluation).toEqual(accepted.expectedEvaluation);
    expect(response.canonicalOutput).toBe(
      new TextDecoder().decode(jcs(accepted.expectedEvaluation)),
    );
  });

  test("an error case answers reject with the WIT error-code", async () => {
    expect(await respond(request(rejected))).toEqual({
      outcome: "reject",
      code: rejected.expectedError?.variant ?? "",
    });
  });

  test("another kind answers unsupported", async () => {
    expect(await respond(request(accepted, "policy-core-v1.evaluate"))).toEqual({
      outcome: "unsupported",
    });
  });

  test("a malformed request is refused, never answered", async () => {
    const { evaluatedAt: _, ...withoutTime } = request(accepted).input;
    const malformed: unknown[] = [
      null,
      { input: {} },
      { kind: POLICY_CORE_V2_KIND },
      { kind: POLICY_CORE_V2_KIND, input: withoutTime },
      { kind: POLICY_CORE_V2_KIND, input: { ...request(accepted).input, extra: 1 } },
      { kind: POLICY_CORE_V2_KIND, input: { ...request(accepted).input, evaluatedAt: 1 } },
    ];
    for (const item of malformed)
      await expect(respond(item)).rejects.toBeInstanceOf(AdapterRequestError);
  });

  test("the process writes one JSON object and exits 0, or nothing and exits 1", async () => {
    const answered = await spawnAdapter(JSON.stringify(request(rejected)));
    expect(answered.code).toBe(0);
    expect(JSON.parse(answered.stdout)).toEqual({
      outcome: "reject",
      code: rejected.expectedError?.variant ?? "",
    });
    for (const stdin of ["not json", JSON.stringify({ kind: POLICY_CORE_V2_KIND })]) {
      const refused = await spawnAdapter(stdin);
      expect(refused.code).toBe(1);
      expect(refused.stdout).toBe("");
    }
  });
});

describe("conformance job verdict", () => {
  const line = (d: number, p: number, f: number, u: number, b: number, t: number = d) =>
    `pass\tx\t\ndiscovered=${d} total=${t} pass=${p} fail=${f} unavailable=${u} blocked=${b}\n`;

  test("all pass is green", () => {
    expect(verdict(line(20, 20, 0, 0, 0), 0)).toMatchObject({ ok: true, reasons: [] });
  });

  test("unavailable alone is green and counted apart", () => {
    const result = verdict(line(20, 18, 0, 2, 0), 2);
    expect(result.ok).toBe(true);
    expect(result.counters?.unavailable).toBe(2);
  });

  test("a fail, a blocked, nothing discovered, nothing judged or a refused run is red", () => {
    const red: [string, number, RegExp][] = [
      [line(20, 19, 1, 0, 0), 1, /fail/],
      [line(20, 19, 0, 0, 1), 2, /blocked/],
      [line(20, 18, 0, 1, 1), 2, /blocked/],
      [line(0, 0, 0, 0, 0), 3, /no vector discovered/],
      ["conformance-runner: --impl is required\n", 3, /no summary line/],
      [line(20, 19, 0, 0, 0), 0, /do not add up/],
      [line(20, 20, 0, 0, 0, 19), 0, /do not add up/],
      // Every vector unavailable: the adapter served none, so nothing was judged.
      [line(20, 0, 0, 20, 0), 2, /no vector judged/],
      [line(20, 20, 0, 0, 0), 1, /disagrees/],
      [line(20, 19, 1, 0, 0), 0, /disagrees/],
    ];
    for (const [output, code, reason] of red) {
      const result = verdict(output, code);
      expect(result.ok).toBe(false);
      expect(result.reasons.join("; ")).toMatch(reason);
    }
  });
});
