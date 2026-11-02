import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Don't advertise the framework in responses.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // HSTS only makes sense once the app is actually served over
          // HTTPS (true on Vercel/production, never true for local dev) —
          // preload is left off since that commits the whole domain (and
          // subdomains) ahead of DNS actually being set up for it.
          ...(process.env.NODE_ENV === "production"
            ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
            : []),
        ],
      },
    ];
  },
  experimental: {
    serverActions: {
      // Next's default is 1MB — item photos and PO PDFs (plan.md section 3/6)
      // will routinely exceed that. 20MB is a judgment-call ceiling, not a
      // hard requirement — revisit if real usage needs more.
      bodySizeLimit: "20mb",
    },
    // Enables next/navigation's `forbidden()` — used to gate /site-boq (and
    // its sub-routes) off from external/franchisee-type roles (plan.md
    // section 2). Experimental per Next's own docs; still the officially
    // documented way to get a real 403 from a Server Component.
    authInterrupts: true,
  },
};

export default nextConfig;
