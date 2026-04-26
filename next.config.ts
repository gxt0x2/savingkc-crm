import type { NextConfig } from "next";
import packageJson from "./package.json";

const gitSha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || "local";
const buildTime = process.env.BUILD_TIME || new Date().toISOString();

const nextConfig: NextConfig = {
  allowedDevOrigins: ['crm.savingkc.com'],
  env: {
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
    NEXT_PUBLIC_RELEASE_SHA: gitSha,
    NEXT_PUBLIC_BUILD_TIME: buildTime,
    NEXT_PUBLIC_DEPLOY_ENV: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
  },
};

export default nextConfig;
