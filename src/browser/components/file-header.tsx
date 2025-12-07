import {
  Check,
  FileCode,
  ChevronLeft,
  ChevronRight,
  Columns2,
  AlignJustify,
} from "lucide-react";
import { cn } from "../cn";
import { Keycap } from "../ui/keycap";
import type { PullRequestFile } from "@/api/types";
import { memo } from "react";
import type { DiffViewMode } from "../contexts/pr-review";

interface FileHeaderProps {
  file: PullRequestFile;
  isViewed: boolean;
  onToggleViewed: () => void;
  currentIndex?: number;
  totalFiles?: number;
  onPrevFile?: () => void;
  onNextFile?: () => void;
  diffViewMode?: DiffViewMode;
  onToggleDiffViewMode?: () => void;
}

export const FileHeader = memo(function FileHeader({
  file,
  isViewed,
  onToggleViewed,
  currentIndex,
  totalFiles,
  onPrevFile,
  onNextFile,
  diffViewMode,
  onToggleDiffViewMode,
}: FileHeaderProps) {
  const fileStatusBadge = (() => {
    switch (file.status) {
      case "added":
        return (
          <span className="px-1.5 py-0.5 text-xs rounded bg-green-500/20 text-green-500 font-medium">
            Added
          </span>
        );
      case "removed":
        return (
          <span className="px-1.5 py-0.5 text-xs rounded bg-red-500/20 text-red-500 font-medium">
            Deleted
          </span>
        );
      case "renamed":
        return (
          <span className="px-1.5 py-0.5 text-xs rounded bg-blue-500/20 text-blue-500 font-medium">
            Renamed
          </span>
        );
      default:
        return null;
    }
  })();

  const showNavigation = currentIndex !== undefined && totalFiles !== undefined;

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <FileCode className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className="font-mono text-sm font-medium truncate">
          {file.filename}
        </span>
        {fileStatusBadge}
        <span className="text-xs text-muted-foreground shrink-0">
          <span className="text-green-500">+{file.additions}</span>{" "}
          <span className="text-red-500">−{file.deletions}</span>
        </span>
        {/* Navigation buttons */}
        {showNavigation && (
          <div className="flex items-center gap-1 shrink-0 ml-2">
            <button
              onClick={onPrevFile}
              className="flex items-center gap-0.5 px-1.5 py-0.5 text-xs rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              title="Previous unreviewed file (j)"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <kbd className="hidden sm:inline-block px-1 py-0.5 bg-muted/60 rounded text-[9px] font-mono">
                j
              </kbd>
            </button>
            <span className="text-xs text-muted-foreground tabular-nums px-1">
              {currentIndex + 1}/{totalFiles}
            </span>
            <button
              onClick={onNextFile}
              className="flex items-center gap-0.5 px-1.5 py-0.5 text-xs rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              title="Next unreviewed file (k)"
            >
              <kbd className="hidden sm:inline-block px-1 py-0.5 bg-muted/60 rounded text-[9px] font-mono">
                k
              </kbd>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* Split/Unified toggle */}
        {onToggleDiffViewMode && (
          <div className="flex items-center rounded-md border border-border bg-muted/30 p-0.5">
            <button
              onClick={() =>
                diffViewMode !== "unified" && onToggleDiffViewMode()
              }
              className={cn(
                "flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors",
                diffViewMode === "unified"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
              title="Unified view"
            >
              <AlignJustify className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Unified</span>
            </button>
            <button
              onClick={() => diffViewMode !== "split" && onToggleDiffViewMode()}
              className={cn(
                "flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors",
                diffViewMode === "split"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
              title="Split view"
            >
              <Columns2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Split</span>
            </button>
          </div>
        )}

        <button
          onClick={onToggleViewed}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors shrink-0",
            isViewed
              ? "bg-green-500/20 text-green-500 hover:bg-green-500/30"
              : "bg-muted hover:bg-muted/80 text-muted-foreground"
          )}
        >
          <Check className={cn("w-4 h-4", isViewed && "text-green-500")} />
          {isViewed ? "Viewed" : "Mark as viewed"}
          <Keycap keyName="v" size="xs" className="ml-1" />
        </button>
      </div>
    </div>
  );
});
