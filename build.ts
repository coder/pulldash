import { $ } from "bun";

// Build the CLI binary
const result = await Bun.build({
  entrypoints: ["./bin/prdash.ts"],
  outdir: "./dist",
  target: "bun",
  minify: true,
  sourcemap: "none",
});

if (!result.success) {
  console.error("Build failed:");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

// Make the binary executable
await $`chmod +x ./dist/prdash.js`;

// Rename to just 'prdash' for cleaner bin usage
await $`mv ./dist/prdash.js ./dist/prdash`;

console.log("✅ Build complete: ./dist/prdash");

