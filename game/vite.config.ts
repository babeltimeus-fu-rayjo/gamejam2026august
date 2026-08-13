import { execSync } from "node:child_process";
import { defineConfig } from "vite";

/**
 * Short commit hash, stamped into the bundle so a deployed build can be traced
 * back to a commit from the title screen. A trailing `+` means the tree had
 * uncommitted changes when it was built.
 */
function commitHash(): string {
  try {
    const hash = execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    const dirty =
      execSync("git status --porcelain", {
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim().length > 0;
    return dirty ? `${hash}+` : hash;
  } catch {
    // No git (e.g. a tarball build) — fall back to CI's own commit env var.
    return process.env.GITHUB_SHA?.slice(0, 7) ?? "unknown";
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the build works under any GitHub Pages sub-path.
  // Runtime fetches must prefix import.meta.env.BASE_URL (see PLAN.md).
  base: "./",
  define: {
    __COMMIT_HASH__: JSON.stringify(commitHash()),
  },
  server: {
    // PORT lets tooling (e.g. Claude Code previews) assign a free port when
    // 8080 is already taken by another dev-server instance.
    port: Number(process.env.PORT) || 8080,
    open: false,
  },
});
