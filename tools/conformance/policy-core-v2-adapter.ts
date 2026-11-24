// `--impl` adapter between the conformance runner of libre-ai/schemas-and-contracts
// (`tools/quality/conformance-runner.ts`, child protocol in `conformance-runner-process.ts`) and
// the policy-core-v2 reference evaluator of this repository.
//
//   stdin   {"kind": string, "input": unknown, "dir": string}
//   stdout  one JSON object:
//           {"outcome": "accept", "evaluation": <evaluation>, "canonicalOutput": <output text>}
//           {"outcome": "reject", "code": <WIT error-code>}
//           {"outcome": "unsupported"}            for a kind this adapter does not serve
//
// The `policy-core-v2.evaluate` input carries the four arguments of the world's `evaluate`
// (`policy`, `snapshot`, `need` as JSON values, `evaluatedAt` as a string). The adapter
// serializes the first three to bytes, as the golden conformance test of the reference package
// does, and returns the output bytes both decoded as text (`canonicalOutput`, judged octet for
// octet) and parsed (`evaluation`).
//
// A request the adapter cannot read is not a verdict: it writes nothing on stdout and exits 1, so
// the runner reports the case `blocked`.

import { evaluate } from "../../packages/policy-core-ref/src/index";

export const POLICY_CORE_V2_KIND = "policy-core-v2.evaluate";

export type AdapterResponse =
  | { outcome: "accept"; evaluation: unknown; canonicalOutput: string }
  | { outcome: "reject"; code: string }
  | { outcome: "unsupported" };

/** A request that does not follow the runner protocol or the kind's input shape. */
export class AdapterRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdapterRequestError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const INPUT_MEMBERS = ["evaluatedAt", "need", "policy", "snapshot"];

export async function respond(request: unknown): Promise<AdapterResponse> {
  if (!isRecord(request) || typeof request.kind !== "string" || !("input" in request))
    throw new AdapterRequestError("request is not {kind, input, dir}");
  if (request.kind !== POLICY_CORE_V2_KIND) return { outcome: "unsupported" };
  const { input } = request;
  if (!isRecord(input) || Object.keys(input).sort().join(",") !== INPUT_MEMBERS.join(","))
    throw new AdapterRequestError("input is not {policy, snapshot, need, evaluatedAt}");
  if (typeof input.evaluatedAt !== "string")
    throw new AdapterRequestError("input.evaluatedAt is not a string");

  const encoder = new TextEncoder();
  const result = await evaluate(
    encoder.encode(JSON.stringify(input.policy)),
    encoder.encode(JSON.stringify(input.snapshot)),
    encoder.encode(JSON.stringify(input.need)),
    input.evaluatedAt,
  );
  if (!result.ok) return { outcome: "reject", code: result.error };
  // Fatal decoding: output bytes that are not UTF-8 are a defect to report, not to repair.
  const canonicalOutput = new TextDecoder("utf-8", { fatal: true }).decode(result.jcs);
  return { outcome: "accept", evaluation: JSON.parse(canonicalOutput), canonicalOutput };
}

async function main(): Promise<number> {
  let request: unknown;
  try {
    request = JSON.parse(await Bun.stdin.text());
  } catch {
    console.error("policy-core-v2 adapter: stdin is not JSON");
    return 1;
  }
  try {
    process.stdout.write(JSON.stringify(await respond(request)));
    return 0;
  } catch (error) {
    // Never a verdict on stdout: the runner reads the non-zero exit as `blocked`.
    console.error(`policy-core-v2 adapter: ${(error as Error).message}`);
    return 1;
  }
}

if (import.meta.main) process.exitCode = await main();
