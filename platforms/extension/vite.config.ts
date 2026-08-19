import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";
import { copyFileSync, cpSync, mkdirSync, existsSync } from "fs";

export default defineConfig(({ mode }) => {
  const testBuild = mode === "test";
  const outDir = resolve(process.env.PINDOU_EXTENSION_OUT_DIR ?? resolve(__dirname, testBuild ? "dist-test" : "dist"));
  return {
  root: resolve(__dirname),
  define: {
    __PINDOU_EXTENSION_TEST__: JSON.stringify(testBuild),
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "copy-extension-files",
      closeBundle() {
        // The build orchestrator writes the merged, versioned manifest.
        // Direct Vite builds retain the base manifest for developer compatibility.
        copyFileSync(resolve(__dirname, "manifest.base.json"), resolve(outDir, "manifest.json"));
        cpSync(resolve(__dirname, "_locales"), resolve(outDir, "_locales"), { recursive: true });
        // Copy icons from src-tauri
        const iconsDir = resolve(outDir, "icons");
        if (!existsSync(iconsDir)) mkdirSync(iconsDir, { recursive: true });
        const srcIcons = resolve(__dirname, "../../src-tauri/icons");
        for (const name of ["32x32.png", "128x128.png"]) {
          const src = resolve(srcIcons, name);
          if (existsSync(src)) {
            copyFileSync(src, resolve(iconsDir, name));
          }
        }
      },
    },
  ],
  build: {
    outDir,
    modulePreload: false,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        background: resolve(__dirname, "background.ts"),
      },
      output: {
        entryFileNames: (chunkInfo) =>
          chunkInfo.name === "background" ? "background.js" : "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "../../src"),
    },
  },
};
});
