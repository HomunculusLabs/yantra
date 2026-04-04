import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["node-pty", "simple-git", "better-sqlite3"],
  turbopack: {
    root: path.resolve(__dirname),
  },
  webpack: (config) => {
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      tailwindcss$: path.resolve(__dirname, "node_modules/tailwindcss/index.css"),
      "tw-animate-css$": path.resolve(
        __dirname,
        "node_modules/tw-animate-css/dist/tw-animate.css"
      ),
      "shadcn/tailwind.css$": path.resolve(
        __dirname,
        "node_modules/shadcn/dist/tailwind.css"
      ),
    };
    return config;
  },
};

export default nextConfig;
