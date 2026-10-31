// Vitest alias target for the "server-only" package (see vitest.config.ts).
// Next's bundler strips server-only's throw-on-client-import check out of
// server bundles via a webpack condition; vitest has no such condition, so
// importing a file that does `import "server-only"` would otherwise throw
// under plain Node. This noop module stands in for it in tests only — it
// changes nothing about the real build.
export {};
