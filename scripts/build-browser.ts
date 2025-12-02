import tailwind from "bun-plugin-tailwind";
import { watch } from "fs";
import { resolve } from "path";

const isWatch = process.argv.includes("--watch");

async function build() {
  const result = await Bun.build({
    entrypoints: ["./src/browser/index.html"],
    outdir: "./dist/browser",
    plugins: [tailwind],
  });

  if (!result.success) {
    console.error("Build failed:");
    for (const log of result.logs) {
      console.error(log);
    }
    return false;
  }

  console.log(`Bundled ${result.outputs.length} files`);
  for (const output of result.outputs) {
    console.log(`  ${output.path}`);
  }
  return true;
}

await build();

if (isWatch) {
  console.log("\nWatching for changes...");
  const srcDir = resolve(import.meta.dir, "..", "src", "browser");

  let debounce: Timer | null = null;
  watch(srcDir, { recursive: true }, (_event, filename) => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(async () => {
      console.log(`\nFile changed: ${filename}`);
      await build();
    }, 100);
  });
}
