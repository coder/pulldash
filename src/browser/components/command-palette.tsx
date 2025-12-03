import { Command } from "cmdk";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { File, FileCode, Search } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "../cn";
import { usePRReviewSelector, usePRReviewStore } from "../contexts/pr-review";
import { Keycap, KeycapGroup } from "../ui/keycap";
import type { PullRequestFile } from "@/api/types";

// ============================================================================
// Global Command Palette Context
// ============================================================================

interface CommandPaletteContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+K or Ctrl+P to open command palette
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "p")) {
        e.preventDefault();
        e.stopPropagation();
        setOpen((prev) => !prev);
      }
    };

    // Use capture phase to intercept before browser handles it
    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, []);

  return (
    <CommandPaletteContext.Provider value={{ open, setOpen }}>
      {children}
    </CommandPaletteContext.Provider>
  );
}

export function useCommandPalette() {
  const context = useContext(CommandPaletteContext);
  if (!context) {
    throw new Error("useCommandPalette must be used within CommandPaletteProvider");
  }
  return context;
}

// ============================================================================
// Search Context (avoids prop drilling that causes re-renders)
// ============================================================================

const SearchQueryContext = createContext("");

// ============================================================================
// Pre-computed file data for faster searching
// ============================================================================

interface FileSearchData {
  file: PullRequestFile;
  lowerFilename: string;
  basename: string;
  lowerBasename: string;
  basenameWithoutExt: string;
  lowerBasenameWithoutExt: string;
}

function createSearchData(file: PullRequestFile): FileSearchData {
  const lowerFilename = file.filename.toLowerCase();
  const basename = file.filename.split("/").pop() || file.filename;
  const lowerBasename = basename.toLowerCase();
  const basenameWithoutExt = basename.replace(/\.[^.]+$/, "");
  const lowerBasenameWithoutExt = basenameWithoutExt.toLowerCase();

  return {
    file,
    lowerFilename,
    basename,
    lowerBasename,
    basenameWithoutExt,
    lowerBasenameWithoutExt,
  };
}

// ============================================================================
// Fuzzy Search Scoring (optimized with pre-computed data)
// ============================================================================

function scoreMatch(data: FileSearchData, lowerQuery: string): number {
  // No query = show all with 0 score (maintains original order)
  if (!lowerQuery) return 0;

  const { lowerFilename, lowerBasename, lowerBasenameWithoutExt } = data;

  // Exact filename match (highest priority)
  if (lowerBasename === lowerQuery) return 1000;
  if (lowerBasenameWithoutExt === lowerQuery) return 990;

  // Filename starts with query
  if (lowerBasename.startsWith(lowerQuery))
    return 900 + (lowerQuery.length / lowerBasename.length) * 50;
  if (lowerBasenameWithoutExt.startsWith(lowerQuery))
    return 880 + (lowerQuery.length / lowerBasenameWithoutExt.length) * 50;

  // Filename contains query as substring
  const basenameIdx = lowerBasename.indexOf(lowerQuery);
  if (basenameIdx !== -1) {
    // Bonus for matching at word boundary (after . - _ or start)
    const charBefore = basenameIdx === 0 ? "" : lowerBasename[basenameIdx - 1];
    const isWordBoundary =
      basenameIdx === 0 ||
      charBefore === "." ||
      charBefore === "-" ||
      charBefore === "_";
    return (
      800 +
      (isWordBoundary ? 50 : 0) +
      (lowerQuery.length / lowerBasename.length) * 30
    );
  }

  // Full path contains query
  if (lowerFilename.includes(lowerQuery)) {
    return 500 + (lowerQuery.length / lowerFilename.length) * 50;
  }

  // Fuzzy match - check if all characters appear in order
  let queryIdx = 0;
  let consecutiveBonus = 0;
  let lastMatchIdx = -2;

  for (
    let i = 0;
    i < lowerFilename.length && queryIdx < lowerQuery.length;
    i++
  ) {
    if (lowerFilename[i] === lowerQuery[queryIdx]) {
      if (i === lastMatchIdx + 1) consecutiveBonus += 10;
      lastMatchIdx = i;
      queryIdx++;
    }
  }

  if (queryIdx === lowerQuery.length) {
    return (
      100 + consecutiveBonus + (lowerQuery.length / lowerFilename.length) * 50
    );
  }

  return -1; // No match
}

// ============================================================================
// Command Palette Component
// ============================================================================

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const CommandPalette = memo(function CommandPalette({
  open,
  onOpenChange,
}: CommandPaletteProps) {
  const [search, setSearch] = useState("");
  const [selectedValue, setSelectedValue] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const store = usePRReviewStore();
  const files = usePRReviewSelector((s) => s.files);
  const viewedFiles = usePRReviewSelector((s) => s.viewedFiles);

  // Defer the search query so typing stays responsive
  const deferredSearch = useDeferredValue(search);
  const lowerQuery = deferredSearch.trim().toLowerCase();

  // Pre-compute search data for all files (only when files change)
  const searchData = useMemo(() => files.map(createSearchData), [files]);

  // Reset search and focus input when opening
  useEffect(() => {
    if (open) {
      setSearch("");
      setSelectedValue(files[0]?.filename || "");
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [open, files]);

  // Filter and sort files based on deferred search query
  const filteredFiles = useMemo(() => {
    if (!lowerQuery) {
      return searchData.map((d) => d.file);
    }

    // Score, filter, and sort
    return searchData
      .map((data) => ({ file: data.file, score: scoreMatch(data, lowerQuery) }))
      .filter((item) => item.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.file);
  }, [searchData, lowerQuery]);

  // Virtualizer for efficient rendering
  const virtualizer = useVirtualizer({
    count: filteredFiles.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 44, // Estimated row height
    overscan: 5,
  });

  // Auto-select first result when filtered files change
  useEffect(() => {
    if (filteredFiles.length > 0) {
      setSelectedValue(filteredFiles[0].filename);
    }
  }, [filteredFiles]);

  const handleSelect = useCallback(
    (filename: string) => {
      store.selectFile(filename);
      onOpenChange(false);
    },
    [store, onOpenChange]
  );

  // Handle keyboard navigation with virtualizer scroll
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onOpenChange(false);
      }
      if (e.key === "Enter" && selectedValue) {
        e.preventDefault();
        handleSelect(selectedValue);
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const currentIdx = filteredFiles.findIndex(
          (f) => f.filename === selectedValue
        );
        const nextIdx =
          e.key === "ArrowDown"
            ? Math.min(currentIdx + 1, filteredFiles.length - 1)
            : Math.max(currentIdx - 1, 0);

        if (nextIdx !== currentIdx && filteredFiles[nextIdx]) {
          e.preventDefault();
          setSelectedValue(filteredFiles[nextIdx].filename);
          virtualizer.scrollToIndex(nextIdx, { align: "auto" });
        }
      }
    },
    [onOpenChange, selectedValue, handleSelect, filteredFiles, virtualizer]
  );

  if (!open) return null;

  const isStale = search !== deferredSearch;

  return (
    <SearchQueryContext.Provider value={deferredSearch}>
      <div className="fixed inset-0 z-50" onKeyDown={handleKeyDown}>
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={() => onOpenChange(false)}
        />

        {/* Command Dialog */}
        <div className="absolute left-1/2 top-[20%] -translate-x-1/2 w-full max-w-xl">
          <Command
            className="rounded-xl border border-border bg-card shadow-2xl overflow-hidden"
            shouldFilter={false}
            loop
            value={selectedValue}
            onValueChange={setSelectedValue}
          >
            <div className="flex items-center border-b border-border px-4 gap-2">
              <Search
                className={cn(
                  "w-4 h-4 shrink-0 transition-colors",
                  isStale ? "text-yellow-500" : "text-muted-foreground"
                )}
              />
              <input
                ref={inputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search files..."
                className="flex-1 h-12 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                autoFocus
              />
              <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                {filteredFiles.length}/{files.length}
              </span>
            </div>

            <div
              ref={listRef}
              className="max-h-[400px] overflow-y-auto p-2 themed-scrollbar"
            >
              {filteredFiles.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No files found.
                </div>
              ) : (
                <div
                  style={{
                    height: `${virtualizer.getTotalSize()}px`,
                    width: "100%",
                    position: "relative",
                  }}
                >
                  {virtualizer.getVirtualItems().map((virtualRow) => {
                    const file = filteredFiles[virtualRow.index];
                    return (
                      <div
                        key={file.filename}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      >
                        <FileItem
                          file={file}
                          isViewed={viewedFiles.has(file.filename)}
                          isSelected={selectedValue === file.filename}
                          onSelect={handleSelect}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="border-t border-border px-4 py-2 flex items-center justify-between text-xs text-muted-foreground">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1.5">
                  <KeycapGroup keys={["up", "down"]} size="xs" />
                  navigate
                </span>
                <span className="flex items-center gap-1.5">
                  <Keycap keyName="Enter" size="xs" />
                  select
                </span>
                <span className="flex items-center gap-1.5">
                  <Keycap keyName="Esc" size="xs" />
                  close
                </span>
              </div>
            </div>
          </Command>
        </div>
      </div>
    </SearchQueryContext.Provider>
  );
});

// ============================================================================
// File Item Component
// ============================================================================

interface FileItemProps {
  file: PullRequestFile;
  isViewed: boolean;
  isSelected: boolean;
  onSelect: (filename: string) => void;
}

const FileItem = memo(function FileItem({
  file,
  isViewed,
  isSelected,
  onSelect,
}: FileItemProps) {
  const fileName = file.filename.split("/").pop() || file.filename;
  const dirPath = file.filename.includes("/")
    ? file.filename.split("/").slice(0, -1).join("/")
    : "";
  const ext = fileName.split(".").pop();

  return (
    <Command.Item
      value={file.filename}
      onSelect={() => onSelect(file.filename)}
      data-selected={isSelected}
      className={cn(
        "group flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors",
        "data-[selected=true]:bg-accent"
      )}
    >
      <FileIcon extension={ext} />
      <div className="flex-1 min-w-0 flex items-baseline gap-2">
        <HighlightedText
          text={fileName}
          className={cn(
            "text-sm font-medium transition-colors",
            isViewed
              ? "text-muted-foreground group-data-[selected=true]:text-foreground"
              : "text-foreground"
          )}
        />
        {dirPath && (
          <span className="text-xs text-muted-foreground group-data-[selected=true]:text-white/70 truncate transition-colors">
            {dirPath}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs shrink-0">
        {file.status === "added" && (
          <span className="text-green-500 group-data-[selected=true]:text-green-300">
            +{file.additions}
          </span>
        )}
        {file.status === "removed" && (
          <span className="text-red-500 group-data-[selected=true]:text-red-300">
            −{file.deletions}
          </span>
        )}
        {file.status === "modified" && (
          <>
            <span className="text-green-500 group-data-[selected=true]:text-green-300">
              +{file.additions}
            </span>
            <span className="text-red-500 group-data-[selected=true]:text-red-300">
              −{file.deletions}
            </span>
          </>
        )}
        {file.status === "renamed" && (
          <span className="text-yellow-500 group-data-[selected=true]:text-yellow-300">
            renamed
          </span>
        )}
        {isViewed && (
          <span className="px-1.5 py-0.5 bg-green-500/20 text-green-400 group-data-[selected=true]:bg-green-400/30 group-data-[selected=true]:text-green-200 rounded text-[10px]">
            viewed
          </span>
        )}
      </div>
    </Command.Item>
  );
});

// ============================================================================
// Highlighted Text Component
// ============================================================================

interface HighlightedTextProps {
  text: string;
  className?: string;
}

const HighlightedText = memo(function HighlightedText({
  text,
  className,
}: HighlightedTextProps) {
  const query = useContext(SearchQueryContext);

  if (!query.trim()) {
    return <span className={className}>{text}</span>;
  }

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase().trim();

  // Find substring match first
  const idx = lowerText.indexOf(lowerQuery);
  if (idx !== -1) {
    return (
      <span className={className}>
        {text.slice(0, idx)}
        <span className="bg-yellow-500/30 text-yellow-200 group-data-[selected=true]:bg-yellow-400/40 group-data-[selected=true]:text-white">
          {text.slice(idx, idx + query.length)}
        </span>
        {text.slice(idx + query.length)}
      </span>
    );
  }

  // Fuzzy highlight - highlight matching characters
  const result: React.ReactNode[] = [];
  let queryIdx = 0;

  for (let i = 0; i < text.length; i++) {
    if (queryIdx < lowerQuery.length && lowerText[i] === lowerQuery[queryIdx]) {
      result.push(
        <span
          key={i}
          className="bg-yellow-500/30 text-yellow-200 group-data-[selected=true]:bg-yellow-400/40 group-data-[selected=true]:text-white"
        >
          {text[i]}
        </span>
      );
      queryIdx++;
    } else {
      result.push(text[i]);
    }
  }

  return <span className={className}>{result}</span>;
});

// ============================================================================
// File Icon Component
// ============================================================================

interface FileIconProps {
  extension?: string;
}

const CODE_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "py",
  "go",
  "rs",
  "rb",
  "java",
  "c",
  "cpp",
  "h",
  "hpp",
  "cs",
  "php",
  "swift",
  "kt",
  "scala",
  "vue",
  "svelte",
  "astro",
  "sql",
]);

const FileIcon = memo(function FileIcon({ extension }: FileIconProps) {
  const isCode = CODE_EXTENSIONS.has(extension || "");

  if (isCode) {
    return (
      <FileCode className="w-4 h-4 text-blue-400 group-data-[selected=true]:text-blue-300 shrink-0 transition-colors" />
    );
  }

  return (
    <File className="w-4 h-4 text-muted-foreground group-data-[selected=true]:text-white shrink-0 transition-colors" />
  );
});

