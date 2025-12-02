import { GitPullRequest, GitMerge, ExternalLink } from "lucide-react";
import { memo } from "react";
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
  const stateIcon =
    pr.state === "open" && !pr.draft ? (
      <GitPullRequest className="w-3.5 h-3.5 text-green-500" />
    ) : pr.merged ? (
      <GitMerge className="w-3.5 h-3.5 text-purple-500" />
    ) : pr.draft ? (
      <GitPullRequest className="w-3.5 h-3.5 text-muted-foreground" />
    ) : (
      <GitPullRequest className="w-3.5 h-3.5 text-red-500" />
    );

  return (
    <header className="border-b border-border px-3 py-1.5 flex items-center gap-3 shrink-0 bg-card/30">
      <div className="flex items-center gap-1.5">
        {stateIcon}
        <a
          href={`https://github.com/${owner}/${repo}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors font-mono"
        >
          {owner}/{repo}
        </a>
        <span className="text-muted-foreground text-xs">#</span>
        <span className="text-xs font-medium">{pr.number}</span>
        {pr.draft && (
          <span className="px-1 py-0.5 text-[10px] rounded bg-muted text-muted-foreground">
            Draft
          </span>
        )}
      </div>

      <h1 className="text-xs font-medium truncate flex-1">{pr.title}</h1>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <img
            src={pr.user.avatar_url}
            alt={pr.user.login}
            className="w-4 h-4 rounded-full"
          />
          <span>{pr.user.login}</span>
        </div>

        <div className="text-[10px] text-muted-foreground font-mono">
          <span className="px-1 py-0.5 bg-muted rounded">{pr.base.ref}</span>
          <span className="mx-0.5">←</span>
          <span className="px-1 py-0.5 bg-muted rounded">{pr.head.ref}</span>
        </div>

        <a
          href={`https://github.com/${owner}/${repo}/pull/${pr.number}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="View on GitHub"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </header>
  );
});
