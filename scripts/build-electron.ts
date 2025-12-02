/**
 * Build the Electron app
 *
 * 1. Build the browser bundle
 * 2. Compile the Electron main process
 * 3. Package with electron-builder
 */

import { $ } from "bun";
import { resolve, join } from "path";
import {
  mkdirSync,
  existsSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
} from "fs";

const ROOT_DIR = resolve(__dirname, "..");
const DIST_DIR = join(ROOT_DIR, "dist");
const ELECTRON_DIST = join(DIST_DIR, "electron");

async function build() {
  console.log("🔨 Building Pulldash Electron App\n");

  // Step 1: Build browser bundle
  console.log("📦 Step 1: Building browser bundle...");
  await $`bun run build:browser`;
  console.log("   ✅ Browser bundle complete\n");

  // Step 2: Generate icons if they don't exist
  const iconPath = join(ROOT_DIR, "build", "icon.png");
  if (!existsSync(iconPath)) {
    console.log("🎨 Step 2: Generating app icons...");
    await $`bun run scripts/generate-icons.ts`;
    console.log("   ✅ Icons generated\n");
  } else {
    console.log("🎨 Step 2: Icons already exist, skipping...\n");
  }

  // Step 3: Compile Electron main process with esbuild/bun
  console.log("⚡ Step 3: Compiling Electron main process...");

  // Ensure electron dist directory exists
  if (!existsSync(ELECTRON_DIST)) {
    mkdirSync(ELECTRON_DIST, { recursive: true });
  }

  // Use Bun to bundle the main process
  const result = await Bun.build({
    entrypoints: [join(ROOT_DIR, "src", "electron", "main.ts")],
    outdir: ELECTRON_DIST,
    target: "node",
    format: "cjs", // Electron requires CommonJS
    external: ["electron"], // Don't bundle electron
    minify: false, // Keep readable for debugging
    sourcemap: "external",
  });

  if (!result.success) {
    console.error("Build failed:");
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  console.log("   ✅ Electron main process compiled\n");

  // Step 4: Create package.json for electron-builder
  console.log("📝 Step 4: Creating electron package.json...");

  const mainPkg = JSON.parse(
    readFileSync(join(ROOT_DIR, "package.json"), "utf-8")
  );

  const electronPkg = {
    name: mainPkg.name,
    version: mainPkg.version,
    description: mainPkg.description,
    main: "electron/main.js",
    author: mainPkg.author || {
      name: "Coder",
      email: "support@coder.com",
    },
    license: mainPkg.license,
    // Note: no "type": "module" since we bundle as CommonJS
  };

  writeFileSync(
    join(DIST_DIR, "package.json"),
    JSON.stringify(electronPkg, null, 2)
  );
  console.log("   ✅ Package.json created\n");

  console.log("✅ Build preparation complete!");
  console.log(
    "   Run 'bun run electron:package' to create distributable packages.\n"
  );
}

build().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
