import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the build works under any GitHub Pages sub-path.
  // Runtime fetches must prefix import.meta.env.BASE_URL (see PLAN.md).
  base: "./",
  server: {
    // PORT lets tooling (e.g. Claude Code previews) assign a free port when
    // 8080 is already taken by another dev-server instance.
    port: Number(process.env.PORT) || 8080,
    open: false,
  },
});
