import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://asia-pvp-servers.vercel.app",
  trailingSlash: "always",
  vite: { build: { cssMinify: false } }, // keep CSS byte-for-byte as authored
  build: {
    format: "directory",
    inlineStylesheets: "always", // CSS stays inline in <head>, exactly as before
  },
});
