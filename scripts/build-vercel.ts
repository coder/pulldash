import { $ } from "bun";
import { cp, mkdir, readdir } from "fs/promises";
import { resolve } from "path";

const rootDir = resolve(import.meta.dir, "..");
const publicDir = resolve(rootDir, "public");
const browserDistDir = resolve(rootDir, "dist/browser");

// Clean and create public directory
await $`rm -rf ${publicDir}`;
await mkdir(publicDir, { recursive: true });

// Build browser files
console.log("Building browser...");
await import("./build-browser");

// Copy browser build contents to public (served by Vercel CDN)
const browserFiles = await readdir(browserDistDir);
for (const file of browserFiles) {
  await cp(resolve(browserDistDir, file), resolve(publicDir, file), { recursive: true });
}
console.log("Copied browser files to public/");

// Vercel auto-detects and compiles src/index.ts as the Hono server
// SPA fallback is handled by rewrites in vercel.json
console.log("✅ Vercel build complete!");
console.log("   Static files: public/ (CDN)");
console.log("   Server: src/index.ts (auto-compiled by Vercel)");
