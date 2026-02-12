import type { NextConfig } from "next";

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
