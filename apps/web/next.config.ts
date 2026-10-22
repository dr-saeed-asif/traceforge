import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" }
] as const;

const nextConfig: NextConfig = {
  distDir: process.env.TRACEFORGE_NEXT_DIST_DIR?.trim() || ".next",
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@traceforge/claim-anchoring", "@traceforge/verification-contracts"],
  typescript: {
    tsconfigPath: process.env.TRACEFORGE_NEXT_TSCONFIG?.trim() || "tsconfig.json"
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...securityHeaders]
      }
    ];
  }
};

export default nextConfig;
