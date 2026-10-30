import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
