import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR?.trim() || ".next",
  experimental: {
    useWasmBinary: true
  }
};

export default nextConfig;
