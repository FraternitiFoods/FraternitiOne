/** "F1-0001" style human code from StoreOnboarding.seq (autoincrement, formatted here). */
export function formatOnboardingCode(seq: number): string {
  return `F1-${String(seq).padStart(4, "0")}`;
}
