// Replays the policy-core-v2 vectors of libre-ai/schemas-and-contracts against this repository's
// reference evaluator, through the authority's own runner and `policy-core-v2-adapter.ts`.
//
//   bun tools/conformance/run-policy-core-v2.ts <schemas-and-contracts checkout>
//
// The checkout is taken at a pinned commit by `.github/workflows/contract-conformance.yml`; this
// script reads nothing else of it than the runner and `contracts/vectors`.
//
// It prints every runner line, then the four counters, then its verdict. The job is red when a
// vector is `fail` or `blocked`, when nothing was discovered, when the counters do not add up to
// the discovered volume, when the summary line is missing or malformed, or when the runner's exit
// code disagrees with its own counters. `unavailable` is counted and printed apart, and does not
// turn the job red.

import { resolve } from "node:path";

export interface Counters {
  discovered: number;
  total: number;
  pass: number;
  fail: number;
  unavailable: number;
  blocked: number;
}

export interface Verdict {
  ok: boolean;
  counters: Counters | null;
  reasons: string[];
}

const SUMMARY =
  /^discovered=(\d+) total=(\d+) pass=(\d+) fail=(\d+) unavailable=(\d+) blocked=(\d+)$/;

export function parseSummary(output: string): Counters | null {
  const last = output.trimEnd().split("\n").at(-1) ?? "";
  const match = SUMMARY.exec(last);
  if (match === null) return null;
  const [discovered, total, pass, fail, unavailable, blocked] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  return { discovered, total, pass, fail, unavailable, blocked };
}

/** Runner exit codes: 0 all pass; 1 a fail; 2 no fail, an unavailable or blocked; 3 usage. */
function expectedExitCode(counters: Counters): number {
  if (counters.fail > 0) return 1;
  if (counters.unavailable + counters.blocked > 0) return 2;
  return 0;
}

export function verdict(output: string, exitCode: number): Verdict {
  const counters = parseSummary(output);
  if (counters === null)
    return { ok: false, counters, reasons: ["the runner printed no summary line"] };
  const reasons: string[] = [];
  const { discovered, total, pass, fail, unavailable, blocked } = counters;
  if (discovered === 0) reasons.push("no vector discovered");
  if (total !== discovered || pass + fail + unavailable + blocked !== discovered)
    reasons.push("counters do not add up to the discovered volume");
  if (fail > 0) reasons.push(`${fail} vector(s) fail`);
  if (blocked > 0) reasons.push(`${blocked} vector(s) blocked`);
  if (exitCode === 3) reasons.push("the runner refused the run (exit code 3)");
  else if (exitCode !== expectedExitCode(counters))
    reasons.push(`runner exit code ${exitCode} disagrees with its counters`);
  return { ok: reasons.length === 0, counters, reasons };
}

/** A path embedded in the `sh -c` command line; a quote would end the quoting. */
function quoted(path: string): string {
  if (path.includes("'")) throw new Error(`path contains a single quote: ${path}`);
  return `'${path}'`;
}

async function main(args: readonly string[]): Promise<number> {
  const [checkout, ...extra] = args;
  if (checkout === undefined || extra.length > 0) {
    console.error("usage: bun tools/conformance/run-policy-core-v2.ts <schemas-and-contracts>");
    return 2;
  }
  const authority = resolve(checkout);
  const adapter = resolve(import.meta.dir, "policy-core-v2-adapter.ts");
  // Absolute Bun: the runner gives its child PATH alone, and the case runs in a temporary directory.
  const implementation = `${quoted(process.execPath)} ${quoted(adapter)}`;
  const child = Bun.spawn(
    [
      process.execPath,
      resolve(authority, "tools/quality/conformance-runner.ts"),
      resolve(authority, "contracts/vectors"),
      "--filter",
      "policy-core-v2",
      "--impl",
      implementation,
    ],
    { stdout: "pipe", stderr: "inherit" },
  );
  const output = await new Response(child.stdout).text();
  const exitCode = await child.exited;
  process.stdout.write(output);

  const result = verdict(output, exitCode);
  const counters = result.counters;
  if (counters !== null) {
    console.log(
      `policy-core-v2 conformance: discovered=${counters.discovered} pass=${counters.pass} ` +
        `fail=${counters.fail} unavailable=${counters.unavailable} blocked=${counters.blocked}`,
    );
    console.log(`policy-core-v2 conformance: unavailable (not judged) = ${counters.unavailable}`);
  }
  for (const reason of result.reasons) console.error(`policy-core-v2 conformance: ${reason}`);
  console.log(`policy-core-v2 conformance: ${result.ok ? "PASS" : "FAIL"}`);
  return result.ok ? 0 : 1;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
