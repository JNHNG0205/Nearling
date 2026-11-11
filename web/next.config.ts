import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@nearling/shared", "@nearling/race", "@nearling/sprites", "@nearling/device"],
};

export default config;
