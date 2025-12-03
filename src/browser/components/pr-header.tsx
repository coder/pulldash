import {
  GitPullRequest,
  GitMerge,
  ExternalLink,
  Copy,
  Check,
  Menu,
} from "lucide-react";
import { memo, useState, useCallback } from "react";
import { cn } from "../cn";
import { UserHoverCard } from "../ui/user-hover-card";
import type { PullRequest } from "@/api/types";

interface PRHeaderProps {
  pr: PullRequest;
  owner: string;
  repo: string;
  onToggleSidebar?: () => void;
}

export const PRHeader = memo(function PRHeader({
  pr,
  owner,
  repo,
  onToggleSidebar,
}: PRHeaderProps) {
  const stateIcon = pr.merged ? (
    <GitMerge className="w-3.5 h-3.5" />
  ) : pr.state === "open" ? (
    <GitPullRequest className="w-3.5 h-3.5" />
  ) : (
    <GitPullRequest className="w-3.5 h-3.5" />
  );

  const stateLabel = pr.merged
    ? "Merged"
    : pr.draft
      ? "Draft"
      : pr.state === "open"
        ? "Open"
        : "Closed";

  const stateBgColor = pr.merged
    ? "bg-purple-600"
    : pr.state === "open"
      ? pr.draft
        ? "bg-gray-600"
        : "bg-green-600"
      : "bg-red-600";

  return (
    <header className="border-b border-border px-2 sm:px-4 py-2 flex items-center gap-2 sm:gap-3 shrink-0 bg-card/30">
      {/* Mobile menu button */}
      {onToggleSidebar && (
        <button
          onClick={onToggleSidebar}
          className="p-1.5 rounded-md hover:bg-muted transition-colors md:hidden shrink-0"
          title="Toggle file list"
        >
          <Menu className="w-4 h-4" />
        </button>
      )}

      {/* State Badge */}
      <span
        className={cn(
          "inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full text-white shrink-0",
          stateBgColor
        )}
      >
        {stateIcon}
        <span className="hidden xs:inline">{stateLabel}</span>
      </span>

      {/* Repo Link - hidden on smallest screens */}
      <a
        href={`https://github.com/${owner}/${repo}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-muted-foreground hover:text-blue-400 transition-colors font-mono shrink-0 hidden sm:inline"
      >
        {owner}/{repo}
      </a>

      {/* Title */}
      <h1 className="text-sm font-medium truncate flex-1 min-w-0">
        <span>{pr.title}</span>
        <span className="text-muted-foreground ml-1.5">#{pr.number}</span>
      </h1>

      {/* Right side info */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {/* Branch info */}
        <div className="text-[11px] text-muted-foreground font-mono hidden lg:flex items-center gap-1">
          <BranchBadge branch={pr.base.ref} />
          <span>←</span>
          <BranchBadge branch={pr.head.ref} />
        </div>

        {/* Author */}
        <UserHoverCard login={pr.user.login}>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
            <img
              src={pr.user.avatar_url}
              alt={pr.user.login}
              className="w-5 h-5 rounded-full"
            />
            <span className="hidden lg:inline">{pr.user.login}</span>
          </div>
        </UserHoverCard>

        {/* External Link */}
        <a
          href={`https://github.com/${owner}/${repo}/pull/${pr.number}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-blue-400 transition-colors"
          title="View on GitHub"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    </header>
  );
});

// ============================================================================
// Branch Badge with Copy Button
// ============================================================================

function BranchBadge({ branch }: { branch: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(branch);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [branch]);

  return (
    <span className="inline-flex items-center gap-0.5 group">
      <code className="px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded">
        {branch}
      </code>
      <button
        onClick={handleCopy}
        className="p-0.5 rounded text-muted-foreground hover:text-blue-400 hover:bg-blue-500/20 transition-colors opacity-0 group-hover:opacity-100"
        title="Copy branch name"
      >
        {copied ? (
          <Check className="w-3 h-3 text-green-500" />
        ) : (
          <Copy className="w-3 h-3" />
        )}
      </button>
    </span>
  );
}
