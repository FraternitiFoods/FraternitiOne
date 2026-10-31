import path from "node:path";
import { defineConfig } from "vitest/config";

// plan.md section 19 L5: webhook-processor.ts (and most server modules) import
// via the "@/*" alias tsconfig.json already defines for the app bundler.
// Vitest has no config of its own to resolve that without this — mirrors
// tsconfig.json's `paths` mapping exactly, nothing else.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // See src/test/server-only-shim.ts — lets a test import a module that
      // does `import "server-only"` (e.g. permissions.ts) without Node's
      // plain `require` throwing the way it would without Next's bundler.
      "server-only": path.resolve(__dirname, "./src/test/server-only-shim.ts"),
    },
  },
  test: {
    // This branch's M0 cleanup removed every *.test.ts file along with the
    // modules they covered — pure-function tests return once Site BOQ logic
    // (rate rules, amount calc, order-status derivation) lands in M1+.
    // Without this, vitest exits 1 on an empty suite and would make CI's
    // "Unit tests" step permanently red until then.
    passWithNoTests: true,
  },
});
