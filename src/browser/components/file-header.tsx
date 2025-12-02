import { Check, FileCode } from "lucide-react";
import { cn } from "../cn";
import { Keycap } from "../ui/keycap";
import type { PullRequestFile } from "@/api/types";
import { memo } from "react";

interface FileHeaderProps {
  file: PullRequestFile;
  isViewed: boolean;
  onToggleViewed: () => void;
}

export const FileHeader = memo(function FileHeader({ file, isViewed, onToggleViewed }: FileHeaderProps) {
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

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <FileCode className="w-4 h-4 text-muted-foreground" />
        <span className="font-mono text-sm font-medium">{file.filename}</span>
        {fileStatusBadge}
        <span className="text-xs text-muted-foreground">
          <span className="text-green-500">+{file.additions}</span>{" "}
          <span className="text-red-500">−{file.deletions}</span>
        </span>
      </div>

      <button
        onClick={onToggleViewed}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors",
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

