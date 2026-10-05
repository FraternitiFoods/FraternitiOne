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
    },
  },
});
