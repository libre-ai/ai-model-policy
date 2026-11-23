// The capability-free, reproducible policy-core WASM build must not be steered by
// external compiler controls; the same guard notebook qualification applies.

const FORBIDDEN_NAMES = new Set([
  "CARGO_BUILD_RUSTC",
  "CARGO_BUILD_RUSTC_WRAPPER",
  "CARGO_BUILD_RUSTFLAGS",
  "CARGO_ENCODED_RUSTFLAGS",
  "CARGO_INCREMENTAL",
  "CARGO_TARGET_DIR",
  "RUSTC",
  "RUSTC_BOOTSTRAP",
  "RUSTC_WRAPPER",
  "RUSTC_WORKSPACE_WRAPPER",
  "RUSTFLAGS",
]);
const FORBIDDEN_PREFIXES = ["CARGO_PROFILE_RELEASE_", "CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_"];

// The Rust setup action of the CI composition exports CARGO_INCREMENTAL=0 to every
// later step, including the root `bun run check` that now builds this artifact.
// Incremental compilation is already off for a release build, so "0" changes no
// output: it is removed from the cargo child, as the composition's WASM gate does
// (check-products.py). Any other value stays a refused external control.
function isInertDefault(name: string, value: string): boolean {
  return name === "CARGO_INCREMENTAL" && value === "0";
}

/**
 * Returns the environment for the cargo child, or throws naming every external
 * Rust build control that is set.
 */
export function rustBuildEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const forbidden: string[] = [];
  const child: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(environment)) {
    const controlsBuild =
      FORBIDDEN_NAMES.has(name) || FORBIDDEN_PREFIXES.some((prefix) => name.startsWith(prefix));
    if (controlsBuild && value) {
      if (isInertDefault(name, value)) {
        continue;
      }
      forbidden.push(name);
    }
    child[name] = value;
  }
  if (forbidden.length > 0) {
    throw new Error(
      `policy-core WASM build forbids external Rust build controls: ${forbidden.join(", ")}`,
    );
  }
  return child;
}
