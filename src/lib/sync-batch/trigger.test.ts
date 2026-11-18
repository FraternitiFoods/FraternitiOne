import { describe, expect, it } from "vitest";
import { classifyKickResponse, missingConfig } from "./trigger";

describe("classifyKickResponse", () => {
  it("ok:true -> ok", () => {
    expect(classifyKickResponse(200, JSON.stringify({ ok: true, runId: "r1" }))).toEqual({ kind: "ok" });
  });
  it("busy:true -> busy", () => {
    expect(classifyKickResponse(200, JSON.stringify({ busy: true }))).toEqual({ kind: "busy" });
  });
  it("ok:false carries the script's error (truncated) and never anything else", () => {
    const r = classifyKickResponse(200, JSON.stringify({ ok: false, error: "x".repeat(500) }));
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message.length).toBeLessThan(260);
  });
  it("a Google HTML page (not deployed / not authorised) is an error, not JSON", () => {
    const r = classifyKickResponse(200, "<!DOCTYPE html><html>Authorization needed</html>");
    expect(r).toMatchObject({ kind: "error", message: expect.stringContaining("deployed or authorised") });
  });
  it("non-2xx -> error naming only the status", () => {
    expect(classifyKickResponse(500, "boom")).toEqual({ kind: "error", message: "The sheet's web app answered HTTP 500." });
  });
  it("JSON without ok/busy -> unexpected answer", () => {
    expect(classifyKickResponse(200, "{}").kind).toBe("error");
  });
});

describe("missingConfig", () => {
  it("lists env var NAMES only, for just the requested legs", () => {
    const env = { SYNC_STAGES_WEBAPP_URL: "https://x", DASHBOARD_SYNC_SECRET: "s" } as unknown as NodeJS.ProcessEnv;
    expect(missingConfig(["STAGES"], env)).toEqual([]);
    expect(missingConfig(["SITE_BOQ"], env)).toEqual(["SYNC_SITE_BOQ_WEBAPP_URL", "SHEET_SYNC_SECRET"]);
    expect(missingConfig(["OPS_BOQ"], {} as NodeJS.ProcessEnv)).toEqual(["SYNC_OPS_BOQ_WEBAPP_URL", "OPS_BOQ_SYNC_SECRET"]);
  });
});
