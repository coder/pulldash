import { Hono } from "hono";

// ============================================================================
// GitHub OAuth App Configuration
// ============================================================================

// OAuth App (not GitHub App) - enables simple user authentication
// like the GitHub CLI, without requiring app installation on repos.
// Users just authorize and get access to their repos based on scopes.
const GITHUB_CLIENT_ID = "Ov23ct2e5eDCkITh5xlh";
// Note: Client secret would be added here for OAuth web flow in the future
// const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;

// ============================================================================
// API Routes
// ============================================================================

const api = new Hono()
  .basePath("/api")

  // Device Authorization - Step 1: Request device code
  // Proxies to GitHub since their endpoint doesn't support CORS
  // For OAuth Apps, we request scopes here. 'repo' gives full access to
  // private repos - same as what the GitHub CLI uses.
  .post("/auth/device/code", async (c) => {
    try {
      const response = await fetch("https://github.com/login/device/code", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          scope: "repo read:user",
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return c.json(
          { error: "Failed to initiate device authorization", details: error },
          500
        );
      }

      const data = await response.json();
      return c.json(data);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  })

  // Device Authorization - Step 2: Poll for access token
  // Proxies to GitHub since their endpoint doesn't support CORS
  .post("/auth/device/token", async (c) => {
    try {
      const body = await c.req.json();
      const { device_code } = body;

      if (!device_code) {
        return c.json({ error: "device_code is required" }, 400);
      }

      const response = await fetch(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            client_id: GITHUB_CLIENT_ID,
            device_code,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        return c.json(
          { error: "Failed to get access token", details: error },
          500
        );
      }

      const data = await response.json();
      return c.json(data);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

export default api;
export type AppType = typeof api;
