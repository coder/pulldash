import { Hono } from "hono";
import { readFileSync, readdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import api from "./api/api";
import { serveStatic } from "@hono/node-server/serve-static";

const app = new Hono();

// Debug route to see filesystem structure on Vercel
app.get("/_debug", (c) => {
  const listDir = (path: string, depth = 0): string[] => {
    const results: string[] = [];
    const indent = "  ".repeat(depth);
    try {
      if (!existsSync(path)) {
        results.push(`${indent}[NOT FOUND: ${path}]`);
        return results;
      }
      const entries = readdirSync(path, { withFileTypes: true });
      for (const entry of entries.slice(0, 50)) {
        // Limit to 50 entries
        if (entry.isDirectory()) {
          results.push(`${indent}${entry.name}/`);
          if (depth < 2) {
            // Limit depth
            results.push(...listDir(resolve(path, entry.name), depth + 1));
          }
        } else {
          results.push(`${indent}${entry.name}`);
        }
      }
    } catch (e) {
      results.push(`${indent}[ERROR: ${e}]`);
    }
    return results;
  };

  const cwd = process.cwd();
  const metaDirname = import.meta.dirname;

  const info = {
    cwd,
    metaDirname,
    cwdContents: listDir(cwd),
    metaDirnameContents: listDir(metaDirname),
    publicFromCwd: listDir(resolve(cwd, "public")),
    parentDir: listDir(resolve(metaDirname, "..")),
  };

  return c.json(info, 200, { "Content-Type": "application/json" });
});

// API routes first
app.route("/", api);

app.use("/*", serveStatic({ root: resolve(process.cwd(), "public") }));

// SPA fallback - serve index.html for client-side routing
// Static files are served by Vercel CDN from public/
app.get("*", (c) => {
  const path = c.req.path;

  // Skip if it looks like a static file request
  if (path.includes(".") && !path.endsWith(".html")) {
    return c.notFound();
  }

  // Serve index.html for SPA routes
  try {
    const indexPath = resolve(process.cwd(), "public", "index.html");
    const html = readFileSync(indexPath, "utf-8");
    return c.html(html);
  } catch {
    return c.notFound();
  }
});

export default app;
