import { describe, expect, test } from "bun:test";

import { rustBuildEnvironment } from "./rust-build-environment";

describe("rustBuildEnvironment", () => {
  test("passes an environment without Rust build controls through unchanged", () => {
    const environment = { PATH: "/usr/bin", CARGO_HOME: "/opt/cargo", CARGO_TERM_COLOR: "always" };
    expect(rustBuildEnvironment(environment)).toEqual(environment);
  });

  test("removes the CI Rust setup default CARGO_INCREMENTAL=0 from the cargo child", () => {
    expect(rustBuildEnvironment({ PATH: "/usr/bin", CARGO_INCREMENTAL: "0" })).toEqual({
      PATH: "/usr/bin",
    });
  });

  test("refuses CARGO_INCREMENTAL with any value other than 0", () => {
    expect(() => rustBuildEnvironment({ CARGO_INCREMENTAL: "1" })).toThrow(
      "forbids external Rust build controls: CARGO_INCREMENTAL",
    );
  });

  test("names every refused control, exact names and prefixes alike", () => {
    expect(() =>
      rustBuildEnvironment({
        RUSTFLAGS: "-Copt-level=0",
        CARGO_PROFILE_RELEASE_LTO: "false",
        CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUNNER: "x",
      }),
    ).toThrow(
      "controls: RUSTFLAGS, CARGO_PROFILE_RELEASE_LTO, CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUNNER",
    );
  });

  test("ignores a control that is set but empty, as an unset one", () => {
    expect(rustBuildEnvironment({ RUSTFLAGS: "" })).toEqual({ RUSTFLAGS: "" });
  });
});
