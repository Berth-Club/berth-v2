import path from "node:path"
import type { NextConfig } from "next"

// Standalone output (a self-contained `node server.js`) is ONLY for the Docker
// image — the Dockerfile sets DOCKER_BUILD=1. Railway/Nixpacks runs `next
// start`, which is incompatible with output:standalone, so it must stay off
// there.
const isDockerBuild = process.env.DOCKER_BUILD === "1"

const nextConfig: NextConfig = {
  ...(isDockerBuild
    ? { output: "standalone" as const, outputFileTracingRoot: path.join(import.meta.dirname, "../../") }
    : {}),
  transpilePackages: ["@workspace/ui", "@workspace/contracts"],
  experimental: {
    // The pin route accepts an image up to 5MB; the default proxy body cap is
    // 10MB, but raise it explicitly so a valid upload is never rejected at the
    // edge before lib/pin-image.ts can validate it.
    proxyClientMaxBodySize: "6mb",
  },
}

export default nextConfig
