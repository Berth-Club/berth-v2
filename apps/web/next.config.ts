import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  transpilePackages: ["@workspace/ui", "@workspace/contracts"],
  experimental: {
    // The pin route accepts an image up to 5MB; the default proxy body cap is
    // 10MB, but raise it explicitly so a valid upload is never rejected at the
    // edge before lib/pin-image.ts can validate it.
    proxyClientMaxBodySize: "6mb",
  },
}

export default nextConfig
