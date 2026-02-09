import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Compute perceived lightness of a hex color (0–1).
 * Uses sRGB relative luminance formula.
 */
function perceivedLightness(hex: string): number {
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Returns inline styles for a GitHub-style label.
 * In light mode, light-colored labels get a solid background with dark text
 * so they remain visible against a white page background.
 */
export function labelStyles(color: string): React.CSSProperties {
  const isLight = document.documentElement.classList.contains("light");
  const l = perceivedLightness(color);
  if (isLight && l > 0.6) {
    return {
      backgroundColor: `#${color}`,
      color: "#1f2328",
      border: `1px solid #${color}`,
    };
  }
  return {
    backgroundColor: `#${color}20`,
    color: `#${color}`,
    border: `1px solid #${color}40`,
  };
}
