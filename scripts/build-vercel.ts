import { $ } from "bun";
import { cp, mkdir } from "fs/promises";
import { resolve } from "path";

const rootDir = resolve(import.meta.dir, "..");
const publicDir = resolve(rootDir, "public");

// Clean and create public directory
await $`rm -rf ${publicDir}`;
await mkdir(publicDir, { recursive: true });

// Build browser files
console.log("Building browser...");
await import("./build-browser.ts");

// Copy browser build to public
await cp(resolve(rootDir, "dist/browser"), publicDir, { recursive: true });
console.log("Copied browser files to public/");

// Copy src directory for Vercel's Hono detection
await mkdir(resolve(publicDir, "src"), { recursive: true });
await cp(resolve(rootDir, "src/index.ts"), resolve(publicDir, "src/index.ts"));
await cp(resolve(rootDir, "src/api"), resolve(publicDir, "src/api"), { recursive: true });
console.log("Copied server source to public/src/");

console.log("✅ Vercel build complete: public/");
