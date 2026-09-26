import "server-only";

import { MockProvider } from "./mock-provider";
import type { EsignProvider } from "./provider";

export type { EsignProvider } from "./provider";

/**
 * plan.md section 17 safety rule: "if NODE_ENV=production and provider is
 * mock, refuse to start e-sign and show Admin an error." This is the one
 * place that enforces it — every call site (franchisee sign, company sign,
 * webhook route, reconcile) goes through this function, never a concrete
 * provider class directly, so there's exactly one gate to bypass, not one
 * per call site.
 */
export function getEsignProvider(): EsignProvider {
  const providerName = process.env.ESIGN_PROVIDER || "mock";

  if (providerName === "mock") {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "ESIGN_PROVIDER=mock cannot run in production. Configure a real e-sign vendor before releasing an LOI for signing."
      );
    }
    return new MockProvider();
  }

  // Real vendor adapters register here as they're built — one new file
  // implementing EsignProvider + a branch here, per section 17's own note
  // ("Real vendor later = one new file implementing the interface + env
  // vars").
  throw new Error(`Unknown ESIGN_PROVIDER "${providerName}" — no adapter implemented yet.`);
}

export function currentProviderName(): string {
  return process.env.ESIGN_PROVIDER || "mock";
}
