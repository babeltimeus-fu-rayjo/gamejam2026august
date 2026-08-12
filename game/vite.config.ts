import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the build works under any GitHub Pages sub-path.
  // Runtime fetches must prefix import.meta.env.BASE_URL (see PLAN.md).
  base: "./",
  server: {
    port: 8080,
    open: false,
  },
});
