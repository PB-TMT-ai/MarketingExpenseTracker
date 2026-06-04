import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships a WASM build of Postgres. Next's bundler (Turbopack) must treat it as an
  // external server package rather than trying to bundle/trace its dynamic WASM resolution.
  // Without this, the dev/build server throws "Unknown module type" on the .wasm payload
  // (RESEARCH Pitfall 2 / Open Question 1).
  serverExternalPackages: ["@electric-sql/pglite"],
  // Pin the workspace root to THIS project. A stray package-lock.json in the parent
  // (…/Downloads) otherwise makes Next infer the wrong root for output-file tracing.
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
