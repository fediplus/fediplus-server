import { resolve } from "node:path";
import dotenv from "dotenv";
import type { NextConfig } from "next";

dotenv.config({ path: resolve(import.meta.dirname, "../../.env") });

const nextConfig: NextConfig = {
  transpilePackages: ["@fediplus/shared"],
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
        port: "9000",
      },
    ],
  },
};

export default nextConfig;
