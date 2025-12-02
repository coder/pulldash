/**
 * Generate app icons from the SVG logo for all platforms
 *
 * - macOS: icon.icns (multiple sizes bundled, with ~10% padding per Apple HIG)
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

// macOS icons need padding around the icon to match Apple HIG
// Standard macOS icons have ~10% padding on each side (icon fills ~80% of canvas)
const MACOS_ICON_SCALE = 0.8;

/**
 * Generate a PNG with padding for macOS icons
 * macOS desktop icons (Finder, Dock, etc.) have standard padding/safe zone
 */
async function generateMacOSIcon(
  svgBuffer: Buffer,
  size: number
): Promise<Buffer> {
  const iconSize = Math.round(size * MACOS_ICON_SCALE);
  const padding = Math.round((size - iconSize) / 2);

  // First resize the SVG to the smaller icon size
  const resizedIcon = await sharp(svgBuffer)
    .resize(iconSize, iconSize, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  // Then composite onto a transparent canvas with padding
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: resizedIcon,
        left: padding,
        top: padding,
      },
    ])
    .png()
    .toBuffer();
}

async function generateIcons() {
  console.log("📦 Generating app icons from SVG...\n");

  // Ensure build directory exists
  if (!existsSync(BUILD_DIR)) {
    mkdirSync(BUILD_DIR, { recursive: true });
  }

  // Read and convert SVG to high-res PNG first
  const svgBuffer = readFileSync(LOGO_PATH);

  // Generate PNGs at various sizes (for Windows/Linux - no padding)
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

  // Generate macOS-specific icons with padding
  const macPngBuffers: Map<number, Buffer> = new Map();
  for (const size of ICON_SIZES) {
    console.log(`  Generating ${size}x${size} macOS PNG (with padding)...`);
    const buffer = await generateMacOSIcon(svgBuffer, size);
    macPngBuffers.set(size, buffer);
  }

  // Save the main 256x256 PNG for Linux and general use
  const png256 = pngBuffers.get(256)!;
  writeFileSync(join(BUILD_DIR, "icon.png"), png256);
  console.log("  ✅ icon.png (256x256)");

  // Save 512x512 as well for high-DPI displays
  const png512 = pngBuffers.get(512)!;
  writeFileSync(join(BUILD_DIR, "icon@2x.png"), png512);

  // Generate macOS .icns (using padded icons for proper macOS appearance)
  console.log("\n  Generating macOS icon.icns (with padding)...");
  try {
    // Use 1024x1024 padded version as the source for best quality
    const png1024 = macPngBuffers.get(1024)!;
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
