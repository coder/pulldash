import { $ } from "bun";

// Build the CLI binary
const result = await Bun.build({
  entrypoints: ["./bin/pulldash.ts"],
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
await $`chmod +x ./dist/pulldash.js`;

// Rename to just 'pulldash' for cleaner bin usage
await $`mv ./dist/pulldash.js ./dist/pulldash`;

console.log("✅ Build complete: ./dist/pulldash");
