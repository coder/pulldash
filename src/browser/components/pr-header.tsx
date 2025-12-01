import { GitPullRequest, GitMerge, ExternalLink } from "lucide-react";
import { memo } from "react";
import type { PullRequest } from "@/api/github";

interface PRHeaderProps {
  pr: PullRequest;
  owner: string;
  repo: string;
  showTabs?: boolean;
}

export const PRHeader = memo(function PRHeader({ pr, owner, repo }: PRHeaderProps) {
  const stateIcon =
    pr.state === "open" && !pr.draft ? (
      <GitPullRequest className="w-4 h-4 text-green-500" />
    ) : pr.merged ? (
      <GitMerge className="w-4 h-4 text-purple-500" />
    ) : pr.draft ? (
      <GitPullRequest className="w-4 h-4 text-muted-foreground" />
    ) : (
      <GitPullRequest className="w-4 h-4 text-red-500" />
    );

  return (
    <header className="border-b border-border px-4 py-3 flex items-center gap-4 shrink-0 bg-background">
      <div className="flex items-center gap-2">
        {stateIcon}
        <a 
          href={`https://github.com/${owner}/${repo}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {owner}/{repo}
        </a>
        <span className="text-muted-foreground">#</span>
        <span className="font-medium">{pr.number}</span>
        {pr.draft && (
          <span className="px-1.5 py-0.5 text-xs rounded bg-muted text-muted-foreground">
            Draft
          </span>
        )}
      </div>

      <h1 className="text-sm font-medium truncate flex-1">{pr.title}</h1>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <img
            src={pr.user.avatar_url}
            alt={pr.user.login}
            className="w-5 h-5 rounded-full"
          />
          <span>{pr.user.login}</span>
        </div>

        <div className="text-xs text-muted-foreground font-mono">
          <span className="px-1.5 py-0.5 bg-muted rounded">{pr.base.ref}</span>
          <span className="mx-1">←</span>
          <span className="px-1.5 py-0.5 bg-muted rounded">{pr.head.ref}</span>
        </div>

        <a
          href={`https://github.com/${owner}/${repo}/pull/${pr.number}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="View on GitHub"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    </header>
  );
});

