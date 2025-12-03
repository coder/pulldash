import { Check, FileCode, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../cn";
import { Keycap } from "../ui/keycap";
import type { PullRequestFile } from "@/api/types";
import { memo } from "react";

interface FileHeaderProps {
  file: PullRequestFile;
  isViewed: boolean;
  onToggleViewed: () => void;
  currentIndex?: number;
  totalFiles?: number;
  onPrevFile?: () => void;
  onNextFile?: () => void;
}

export const FileHeader = memo(function FileHeader({
  file,
  isViewed,
  onToggleViewed,
  currentIndex,
  totalFiles,
  onPrevFile,
  onNextFile,
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
        <span className="font-mono text-sm font-medium truncate">{file.filename}</span>
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
              title="Previous unreviewed file (k)"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <kbd className="hidden sm:inline-block px-1 py-0.5 bg-muted/60 rounded text-[9px] font-mono">
                k
              </kbd>
            </button>
            <span className="text-xs text-muted-foreground tabular-nums px-1">
              {currentIndex + 1}/{totalFiles}
            </span>
            <button
              onClick={onNextFile}
              className="flex items-center gap-0.5 px-1.5 py-0.5 text-xs rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              title="Next unreviewed file (j)"
            >
              <kbd className="hidden sm:inline-block px-1 py-0.5 bg-muted/60 rounded text-[9px] font-mono">
                j
              </kbd>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

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
  );
});
