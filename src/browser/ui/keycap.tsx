import { memo } from "react";
import {
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  CornerDownLeft,
  Command,
} from "lucide-react";
import { cn } from "../cn";

// ============================================================================
// OS Detection
// ============================================================================

const isMac =
  typeof navigator !== "undefined"
    ? /Mac|iPod|iPhone|iPad/.test(navigator.platform)
    : false;

// ============================================================================
// Keycap Component
// ============================================================================

interface KeycapProps {
  /**
   * The key to display. Special values:
   * - "cmd" or "meta" - Shows ⌘ on Mac, Ctrl on other systems
   * - "ctrl" - Always shows Ctrl
   * - "shift" - Shows ⇧
   * - "alt" or "option" - Shows ⌥ on Mac, Alt on other systems
   * - "enter" or "return" - Shows ↵ icon
   * - "esc" or "escape" - Shows Esc
   * - "up", "down", "left", "right" - Shows arrow icons
   * - "arrowup", "arrowdown" - Also shows arrow icons
   * - Any other string is shown as-is
   */
  keyName: string;
  /** Additional class names */
  className?: string;
  /** Size variant */
  size?: "xs" | "sm" | "md";
}

export const Keycap = memo(function Keycap({
  keyName,
  className,
  size = "sm",
}: KeycapProps) {
  const content = getKeyContent(keyName);

  const sizeClasses = {
    xs: "px-1 py-0.5 text-[9px] min-w-[18px]",
    sm: "px-1.5 py-0.5 text-[10px] min-w-[22px]",
    md: "px-2 py-1 text-xs min-w-[26px]",
  };

  const iconSizes = {
    xs: "w-2.5 h-2.5",
    sm: "w-3 h-3",
    md: "w-3.5 h-3.5",
  };

  return (
    <kbd
      className={cn(
        "inline-flex items-center justify-center gap-0.5",
        "font-mono font-medium",
        "bg-muted/80 text-muted-foreground",
        "border border-border/50",
        "rounded shadow-[0_1px_0_1px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.05)]",
        "select-none",
        sizeClasses[size],
        className
      )}
    >
      {typeof content === "string" ? (
        content
      ) : (
        <content.icon className={iconSizes[size]} />
      )}
    </kbd>
  );
});

// ============================================================================
// Key Content Mapping
// ============================================================================

function getKeyContent(keyName: string): string | { icon: typeof ArrowUp } {
  const key = keyName.toLowerCase();

  switch (key) {
    // Modifier keys
    case "cmd":
    case "meta":
    case "command":
      return isMac ? "⌘" : "Ctrl";
    case "ctrl":
    case "control":
      return "Ctrl";
    case "shift":
      return "Shift";
    case "alt":
    case "option":
      return isMac ? "⌥" : "Alt";

    // Special keys
    case "enter":
    case "return":
      return { icon: CornerDownLeft };
    case "esc":
    case "escape":
      return "Esc";
    case "tab":
      return "Tab";
    case "space":
      return "Space";
    case "backspace":
      return "⌫";
    case "delete":
      return "Del";

    // Arrow keys - use Lucide icons
    case "up":
    case "arrowup":
    case "↑":
      return { icon: ArrowUp };
    case "down":
    case "arrowdown":
    case "↓":
      return { icon: ArrowDown };
    case "left":
    case "arrowleft":
    case "←":
      return { icon: ArrowLeft };
    case "right":
    case "arrowright":
    case "→":
      return { icon: ArrowRight };

    // Default: return as-is but uppercase single chars
    default:
      return keyName.length === 1 ? keyName.toUpperCase() : keyName;
  }
}

// ============================================================================
// Keycap Group (for key combinations like Cmd+K)
// ============================================================================

interface KeycapGroupProps {
  /** Array of key names to display */
  keys: string[];
  /** Additional class names */
  className?: string;
  /** Size variant */
  size?: "xs" | "sm" | "md";
  /** Separator between keys (default: none, keys are adjacent) */
  separator?: "+" | "none";
}

export const KeycapGroup = memo(function KeycapGroup({
  keys,
  className,
  size = "sm",
  separator = "none",
}: KeycapGroupProps) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {keys.map((key, index) => (
        <span key={index} className="inline-flex items-center">
          {index > 0 && separator === "+" && (
            <span className="text-muted-foreground/50 text-[9px] mx-0.5">
              +
            </span>
          )}
          <Keycap keyName={key} size={size} />
        </span>
      ))}
    </span>
  );
});

// ============================================================================
// Export isMac for use elsewhere
// ============================================================================

export { isMac };
