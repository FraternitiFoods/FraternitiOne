import { validateProductionEnv } from "@/lib/env-validation";

export function register() {
  validateProductionEnv();
}
