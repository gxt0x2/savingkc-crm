import type { NextConfig } from "next";
import path from "path";
import packageJson from "./package.json";

const gitSha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || "local";
const buildTime = process.env.BUILD_TIME || new Date().toISOString();

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  images: {
    qualities: [68, 75, 78],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "fprrknfyzlthbxewnwmi.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  allowedDevOrigins: ['crm.savingkc.com'],
  env: {
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
    NEXT_PUBLIC_RELEASE_SHA: gitSha,
    NEXT_PUBLIC_BUILD_TIME: buildTime,
    NEXT_PUBLIC_DEPLOY_ENV: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
  },
};

export default nextConfig;
