import tailwind from "bun-plugin-tailwind";
import { watch } from "fs";
import { cp } from "fs/promises";
import { resolve } from "path";

const isWatch = process.argv.includes("--watch");

async function build() {
  // Build main app
  const mainResult = await Bun.build({
    entrypoints: ["./src/browser/index.html"],
    outdir: "./dist/browser",
    plugins: [tailwind],
    target: "browser",
    format: "esm",
  });

  if (!mainResult.success) {
    console.error("Main build failed:");
    for (const log of mainResult.logs) {
      console.error(log);
    }
    return false;
  }

  // Make paths absolute to root in index.html
  const indexPath = "./dist/browser/index.html";
  const indexHtml = await Bun.file(indexPath).text();
  await Bun.write(indexPath, indexHtml.replaceAll("./", "/"));

  await cp(
    resolve(process.cwd(), "src", "browser", "logo.svg"),
    resolve(process.cwd(), "dist", "browser", "logo.svg")
  );

  // Build worker separately with document shim for Prism/refractor
  const workerResult = await Bun.build({
    entrypoints: ["./src/browser/lib/diff-worker.ts"],
    outdir: "./dist/browser/lib",
    target: "browser",
    format: "esm",
    banner: `// Worker shim for libraries that check for document (Prism/refractor)
if (typeof document === 'undefined') {
  globalThis.document = {
    currentScript: null,
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: () => null,
    getElementsByClassName: () => [],
    getElementsByTagName: () => [],
    createElement: () => ({
      setAttribute: () => {},
      getAttribute: () => null,
      appendChild: () => {},
      removeChild: () => {},
      classList: { add: () => {}, remove: () => {}, contains: () => false },
      style: {},
      innerHTML: '',
      textContent: '',
    }),
    createTextNode: () => ({ textContent: '' }),
    createDocumentFragment: () => ({ appendChild: () => {}, childNodes: [] }),
    head: { appendChild: () => {}, removeChild: () => {} },
    body: { appendChild: () => {}, removeChild: () => {} },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}
`,
  });

  if (!workerResult.success) {
    console.error("Worker build failed:");
    for (const log of workerResult.logs) {
      console.error(log);
    }
    return false;
  }

  const allOutputs = [...mainResult.outputs, ...workerResult.outputs];

  console.log(`Bundled ${allOutputs.length} files`);
  for (const output of allOutputs) {
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
