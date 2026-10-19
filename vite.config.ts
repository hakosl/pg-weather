import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative asset paths, so the build works under GitHub Pages' /pg-weather/ path and anywhere else.
  base: "./",
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: { include: ["src/analysis/**", "src/forecast/**", "src/live/**", "src/favorites.ts"] },
  },
});
