import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import api from "@/api/api";
import { resolve } from "path";
import { Hono } from "hono";
import { readFileSync } from "fs";

const app = new Hono();

const distDir = resolve(__dirname, "..", "..", "dist", "browser");

console.log("distDir", distDir);

// API routes first
app.route("/", api);

// Static files
app.use("/*", serveStatic({ root: distDir }));

// SPA fallback - serve index.html for client-side routing
app.get("*", (c) => {
  if (c.req.path === "/favicon.ico") {
    return c.body(null, 404);
  }
  const indexPath = resolve(distDir, "index.html");
  const html = readFileSync(indexPath, "utf-8");
  return c.html(html.replaceAll("./", "/"));
});

serve({
  fetch: app.fetch,
  port: 3000,
});

console.log("🚀 pulldash running at http://localhost:3000");
