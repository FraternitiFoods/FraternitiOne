/**
 * Tiny in-memory sliding-window limiter for the chat route. Best effort by
 * design: on serverless each instance has its own memory, so this stops a
 * single user hammering one instance (and runaway client loops) but is not a
 * global cap. The real global ceiling is Gemini's own per-project quota, which
 * the route turns into a friendly "busy" message.
 */
export type RateLimiter = { check(key: string, now?: number): boolean };

export function createRateLimiter(maxHits: number, windowMs: number): RateLimiter {
  const hits = new Map<string, number[]>();

  return {
    /** Records a hit and returns true if allowed, false if the key is over the limit. */
    check(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= maxHits) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);

      // Keep the map from growing forever: drop idle keys opportunistically.
      if (hits.size > 5000) {
        for (const [k, ts] of hits) {
          if (ts.every((t) => now - t >= windowMs)) hits.delete(k);
        }
      }
      return true;
    },
  };
}
