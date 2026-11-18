import { describe, expect, it } from "vitest";
import { SERVER_SYNC_VERSION, splitChanged, stampHash } from "./hash";

describe("splitChanged", () => {
  const stored = new Map([
    ["a", stampHash("h1")],
    ["b", stampHash("h2")],
  ]);

  it("treats a matching stamped hash as unchanged and everything else as changed", () => {
    const r = splitChanged(
      [
        { key: "a", hash: "h1" }, // same
        { key: "b", hash: "CHANGED" }, // differs
        { key: "c", hash: "h3" }, // never synced
      ],
      stored
    );
    expect(r).toEqual({ changed: ["b", "c"], unchanged: ["a"] });
  });

  it("rewrites everything when forced", () => {
    expect(splitChanged([{ key: "a", hash: "h1" }], stored, { force: true })).toEqual({ changed: ["a"], unchanged: [] });
  });

  it("rewrites a unit whose target row is missing/inactive even if the sheet did not change", () => {
    const r = splitChanged([{ key: "a", hash: "h1" }], stored, { mustRewrite: new Set(["a"]) });
    expect(r.changed).toEqual(["a"]);
  });

  it("a different SERVER_SYNC_VERSION invalidates a stored hash", () => {
    const old = new Map([["a", `0:h1`]]);
    expect(SERVER_SYNC_VERSION).not.toBe("0");
    expect(splitChanged([{ key: "a", hash: "h1" }], old).changed).toEqual(["a"]);
  });

  it("a duplicate key in one manifest counts once (first wins)", () => {
    const r = splitChanged(
      [
        { key: "a", hash: "h1" },
        { key: "a", hash: "other" },
      ],
      stored
    );
    expect(r).toEqual({ changed: [], unchanged: ["a"] });
  });
});
