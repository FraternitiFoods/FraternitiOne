import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Next's default is 1MB, which real Document Vault uploads (design
      // drawings, BOQ PDFs, site photos — SRD section 5/17) routinely
      // exceed. 20MB is a judgment-call ceiling, not an SRD requirement —
      // revisit if real usage needs more.
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
