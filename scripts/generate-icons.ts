/**
 * Generate app icons from the SVG logo for all platforms
 *
 * - macOS: icon.icns (multiple sizes bundled)
 * - Windows: icon.ico (multiple sizes bundled)
 * - Linux: icon.png (256x256)
 */

import sharp from "sharp";
import { resolve, join } from "path";
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "fs";
import png2icons from "png2icons";

const ROOT_DIR = resolve(__dirname, "..");
const BUILD_DIR = join(ROOT_DIR, "build");
const LOGO_PATH = join(ROOT_DIR, "src", "browser", "logo.svg");

// Icon sizes needed for each platform
const ICON_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024];

async function generateIcons() {
  console.log("📦 Generating app icons from SVG...\n");

  // Ensure build directory exists
  if (!existsSync(BUILD_DIR)) {
    mkdirSync(BUILD_DIR, { recursive: true });
  }

  // Read and convert SVG to high-res PNG first
  const svgBuffer = readFileSync(LOGO_PATH);

  // Generate PNGs at various sizes
  const pngBuffers: Map<number, Buffer> = new Map();

  for (const size of ICON_SIZES) {
    console.log(`  Generating ${size}x${size} PNG...`);
    const buffer = await sharp(svgBuffer)
      .resize(size, size, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    pngBuffers.set(size, buffer);
  }

  // Save the main 256x256 PNG for Linux and general use
  const png256 = pngBuffers.get(256)!;
  writeFileSync(join(BUILD_DIR, "icon.png"), png256);
  console.log("  ✅ icon.png (256x256)");

  // Save 512x512 as well for high-DPI displays
  const png512 = pngBuffers.get(512)!;
  writeFileSync(join(BUILD_DIR, "icon@2x.png"), png512);

  // Generate macOS .icns
  console.log("\n  Generating macOS icon.icns...");
  try {
    // Use 1024x1024 as the source for best quality
    const png1024 = pngBuffers.get(1024)!;
    const icns = png2icons.createICNS(png1024, png2icons.BICUBIC2, 0);
    if (icns) {
      writeFileSync(join(BUILD_DIR, "icon.icns"), icns);
      console.log("  ✅ icon.icns");
    } else {
      console.error("  ❌ Failed to create ICNS");
    }
  } catch (err) {
    console.error("  ❌ Failed to generate ICNS:", err);
  }

  // Generate Windows .ico
  console.log("\n  Generating Windows icon.ico...");
  try {
    const png256ForIco = pngBuffers.get(256)!;
    const ico = png2icons.createICO(png256ForIco, png2icons.BICUBIC2, 0, true);
    if (ico) {
      writeFileSync(join(BUILD_DIR, "icon.ico"), ico);
      console.log("  ✅ icon.ico");
    } else {
      console.error("  ❌ Failed to create ICO");
    }
  } catch (err) {
    console.error("  ❌ Failed to generate ICO:", err);
  }

  console.log("\n✅ Icon generation complete! Files in ./build/\n");
}

generateIcons().catch((err) => {
  console.error("Failed to generate icons:", err);
  process.exit(1);
});
