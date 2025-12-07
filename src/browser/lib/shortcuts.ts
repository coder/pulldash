/**
 * Centralized keyboard shortcuts configuration.
 * This is the single source of truth for all keyboard shortcuts in the app.
 *
 * Both the keyboard handlers and the shortcuts modal read from this config.
 */

// ============================================================================
// Types
// ============================================================================

export type ShortcutCategory =
  | "Navigation"
  | "Actions"
  | "Go to Line"
  | "File Search"
  | "Tabs"
  | "Help";

export interface ShortcutDefinition {
  /** The key(s) to display in the UI */
  keys: string[];
  /** Human-readable description */
  description: string;
  /** Category for grouping in the modal */
  category: ShortcutCategory;
  /** If true, requires Cmd (Mac) / Ctrl (other) modifier */
  withModifier?: boolean;
}

// ============================================================================
// Shortcuts Configuration
// ============================================================================

export const SHORTCUTS = {
  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------
  NAVIGATE_UP: {
    keys: ["↑"],
    description: "Navigate up",
    category: "Navigation",
  },
  NAVIGATE_DOWN: {
    keys: ["↓"],
    description: "Navigate down",
    category: "Navigation",
  },
  NAVIGATE_LEFT: {
    keys: ["←"],
    description: "Switch to left side (split view)",
    category: "Navigation",
  },
  NAVIGATE_RIGHT: {
    keys: ["→"],
    description: "Switch to right side (split view)",
    category: "Navigation",
  },
  JUMP_UP: {
    keys: ["cmd", "↑"],
    description: "Jump 10 lines up",
    category: "Navigation",
    withModifier: true,
  },
  JUMP_DOWN: {
    keys: ["cmd", "↓"],
    description: "Jump 10 lines down",
    category: "Navigation",
    withModifier: true,
  },
  NEXT_UNVIEWED_FILE: {
    keys: ["j"],
    description: "Next unviewed file",
    category: "Navigation",
  },
  PREV_UNVIEWED_FILE: {
    keys: ["k"],
    description: "Previous unviewed file",
    category: "Navigation",
  },
  GOTO_LINE_MODE: {
    keys: ["g"],
    description: "Go to line mode",
    category: "Navigation",
  },
  GOTO_OVERVIEW: {
    keys: ["o"],
    description: "Go to overview",
    category: "Navigation",
  },

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  TOGGLE_VIEWED: {
    keys: ["v"],
    description: "Toggle viewed status",
    category: "Actions",
  },
  COMMENT: {
    keys: ["c"],
    description: "Comment on line",
    category: "Actions",
  },
  EDIT_COMMENT: {
    keys: ["e"],
    description: "Edit comment",
    category: "Actions",
  },
  REPLY_COMMENT: {
    keys: ["r"],
    description: "Reply to comment",
    category: "Actions",
  },
  DELETE_COMMENT: {
    keys: ["d"],
    description: "Delete comment",
    category: "Actions",
  },
  EXPAND_SECTION: {
    keys: ["enter"],
    description: "Expand collapsed section",
    category: "Actions",
  },
  CANCEL: {
    keys: ["esc"],
    description: "Cancel / clear selection",
    category: "Actions",
  },

  // ---------------------------------------------------------------------------
  // Go to Line Mode
  // ---------------------------------------------------------------------------
  GOTO_INPUT_DIGITS: {
    keys: ["0-9"],
    description: "Enter line number",
    category: "Go to Line",
  },
  GOTO_TOGGLE_SIDE: {
    keys: ["tab"],
    description: "Toggle side",
    category: "Go to Line",
  },
  GOTO_EXECUTE: {
    keys: ["enter"],
    description: "Go to line",
    category: "Go to Line",
  },
  GOTO_EXIT: {
    keys: ["esc"],
    description: "Exit mode",
    category: "Go to Line",
  },

  // ---------------------------------------------------------------------------
  // File Search
  // ---------------------------------------------------------------------------
  OPEN_FILE_SEARCH_K: {
    keys: ["cmd", "k"],
    description: "Open file search",
    category: "File Search",
    withModifier: true,
  },
  OPEN_FILE_SEARCH_P: {
    keys: ["cmd", "p"],
    description: "Open file search",
    category: "File Search",
    withModifier: true,
  },

  // ---------------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------------
  SWITCH_TAB: {
    keys: ["cmd", "1-9"],
    description: "Switch to tab",
    category: "Tabs",
    withModifier: true,
  },
  CLOSE_TAB: {
    keys: ["cmd", "w"],
    description: "Close current tab",
    category: "Tabs",
    withModifier: true,
  },

  // ---------------------------------------------------------------------------
  // Help
  // ---------------------------------------------------------------------------
  SHOW_SHORTCUTS: {
    keys: ["?"],
    description: "Show keyboard shortcuts",
    category: "Help",
  },
} as const satisfies Record<string, ShortcutDefinition>;

export type ShortcutId = keyof typeof SHORTCUTS;

// ============================================================================
// Utilities
// ============================================================================

/** Order for displaying categories in the modal */
const CATEGORY_ORDER: ShortcutCategory[] = [
  "Navigation",
  "Actions",
  "Go to Line",
  "File Search",
  "Tabs",
  "Help",
];

/**
 * Get all shortcuts grouped by category, ordered for display.
 * Used by the keyboard shortcuts modal.
 */
export function getShortcutsByCategory(): Array<{
  category: ShortcutCategory;
  shortcuts: ShortcutDefinition[];
}> {
  const map = new Map<ShortcutCategory, ShortcutDefinition[]>();

  // Initialize with empty arrays in order
  for (const category of CATEGORY_ORDER) {
    map.set(category, []);
  }

  // Group shortcuts by category
  for (const shortcut of Object.values(SHORTCUTS)) {
    const existing = map.get(shortcut.category);
    if (existing) {
      existing.push(shortcut);
    }
  }

  // Convert to array, filtering out empty categories
  return CATEGORY_ORDER.filter((cat) => (map.get(cat)?.length ?? 0) > 0).map(
    (category) => ({
      category,
      shortcuts: map.get(category)!,
    })
  );
}

/**
 * Check if a keyboard event matches a shortcut's key.
 * Handles modifier key requirements.
 */
export function matchesKey(
  event: KeyboardEvent,
  shortcutId: ShortcutId
): boolean {
  const shortcut = SHORTCUTS[shortcutId];

  // Check modifier requirement
  if (
    "withModifier" in shortcut &&
    shortcut.withModifier &&
    !(event.metaKey || event.ctrlKey)
  ) {
    return false;
  }

  // Get the actual key (last element if modifier is separate)
  const targetKey = shortcut.keys[shortcut.keys.length - 1].toLowerCase();
  const eventKey = event.key.toLowerCase();

  // Handle special key mappings
  switch (targetKey) {
    case "↑":
      return eventKey === "arrowup";
    case "↓":
      return eventKey === "arrowdown";
    case "←":
      return eventKey === "arrowleft";
    case "→":
      return eventKey === "arrowright";
    case "esc":
      return eventKey === "escape";
    case "enter":
      return eventKey === "enter";
    case "tab":
      return eventKey === "tab";
    default:
      return eventKey === targetKey;
  }
}
