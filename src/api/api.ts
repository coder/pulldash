import { Hono } from "hono";
import { execSync } from "child_process";

// ============================================================================
// GitHub Token
// ============================================================================

let cachedToken: string | null = null;

function getGitHubToken(): string {
  if (cachedToken) return cachedToken;
  try {
    let token: string;

    if (process.platform === "win32") {
      // Windows: gh should be in PATH from installer
      token = execSync("gh auth token", { encoding: "utf-8" }).trim();
    } else {
      // macOS/Linux: Use login shell to source user's profile for proper PATH
      // This ensures gh is found even when app is launched from Finder/desktop
      const shell = process.env.SHELL || "/bin/sh";
      token = execSync(`${shell} -l -c "gh auth token"`, {
        encoding: "utf-8",
      }).trim();
    }

    cachedToken = token;
    return cachedToken;
  } catch (err) {
    throw new Error(
      "Failed to get GitHub token. Make sure gh CLI is authenticated: " +
        (err as Error).message,
      {
        cause: err,
      }
    );
  }
}

// ============================================================================
// API Routes
// ============================================================================

const api = new Hono()
  .basePath("/api")

  // Token endpoint - provides GitHub token for client-side API calls
  .get("/token", (c) => {
    return c.json({ token: getGitHubToken() });
  });

export default api;
export type AppType = typeof api;
