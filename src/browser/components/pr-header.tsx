import { GitPullRequest, GitMerge, ExternalLink } from "lucide-react";
import { memo } from "react";
import { cn } from "../cn";
import type { PullRequest } from "@/api/types";

interface PRHeaderProps {
  pr: PullRequest;
  owner: string;
  repo: string;
}

export const PRHeader = memo(function PRHeader({
  pr,
  owner,
  repo,
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
    <header className="border-b border-border px-4 py-2 flex items-center gap-3 shrink-0 bg-card/30">
      {/* State Badge */}
      <span
        className={cn(
          "inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full text-white shrink-0",
          stateBgColor
        )}
      >
        {stateIcon}
        {stateLabel}
      </span>

      {/* Repo Link */}
      <a
        href={`https://github.com/${owner}/${repo}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-muted-foreground hover:text-blue-400 transition-colors font-mono shrink-0"
      >
        {owner}/{repo}
      </a>

      {/* Title */}
      <h1 className="text-sm font-medium truncate flex-1 min-w-0">
        <span>{pr.title}</span>
        <span className="text-muted-foreground ml-1.5">#{pr.number}</span>
      </h1>

      {/* Right side info */}
      <div className="flex items-center gap-3 shrink-0">
        {/* Branch info */}
        <div className="text-[11px] text-muted-foreground font-mono hidden sm:flex items-center gap-1">
          <code className="px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded">
            {pr.base.ref}
          </code>
          <span>←</span>
          <code className="px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded">
            {pr.head.ref}
          </code>
        </div>

        {/* Author */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <img
            src={pr.user.avatar_url}
            alt={pr.user.login}
            className="w-5 h-5 rounded-full"
          />
          <span className="hidden lg:inline">{pr.user.login}</span>
        </div>

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
