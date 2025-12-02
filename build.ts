import { $ } from "bun";

// Build the CLI binary
const result = await Bun.build({
  entrypoints: ["./bin/pullpal.ts"],
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
await $`chmod +x ./dist/pullpal.js`;

// Rename to just 'pullpal' for cleaner bin usage
await $`mv ./dist/pullpal.js ./dist/pullpal`;

console.log("✅ Build complete: ./dist/pullpal");

