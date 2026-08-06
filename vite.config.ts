import { defineConfig } from "vite";
import { resolve } from "node:path";

/**
 * Bundles the plugin to the single file the host loads.
 *
 * The host runs plugin code as `new Function("api", code)` and uses whatever the
 * body RETURNS as the module. So this emits an IIFE assigned to a local, plus a
 * footer that returns it. Nothing in the host had to change to allow a build
 * step: it is purely author-side, which is why hand-written ES5 plugins still
 * work exactly as before.
 *
 * Vite refuses to emit into its own root, so output goes to dist/ and
 * scripts/finish-build.mjs moves the one artifact to ./index.js — which is what
 * the packaged zip contains and what the host reads.
 */
export default defineConfig({
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    minify: false, // a readable bundle is worth more than the bytes here
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      formats: ["iife"],
      name: "__viboplrPlugin",
      fileName: () => "index.js",
    },
    rollupOptions: {
      output: {
        extend: false,
        footer: "\nreturn __viboplrPlugin;",
      },
    },
    target: "es2020",
  },
  test: {
    environment: "jsdom",
  },
});
