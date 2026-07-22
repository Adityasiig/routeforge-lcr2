import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    proxyClientMaxBodySize: "100mb",
  },
  outputFileTracingExcludes: {
    "/*": [
      "./.data/**/*",
      "./app/**/*",
      "./lib/**/*",
      "./tests/**/*",
      "./public/**/*",
      "./README.md",
      "./Dockerfile",
      "./docker-compose.yml",
      "./eslint.config.mjs",
      "./next.config.ts",
      "./package-lock.json",
      "./postcss.config.mjs",
      "./tsconfig.json",
    ],
  },
};

export default nextConfig;
