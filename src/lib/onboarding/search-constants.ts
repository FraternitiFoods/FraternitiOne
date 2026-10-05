/**
 * Split out of search.ts: a plain string sentinel, safe in Client Components,
 * but search.ts itself starts with `import "server-only"` (it also exports
 * the real Prisma query builder). Keeping this one constant in its own
 * server-only-free file lets `store-onboarding-list.tsx` (a Client
 * Component) import it directly instead of pulling in server.ts's guard.
 */
export const LOI_NOT_GENERATED = "NOT_GENERATED" as const;
