import { GitPullRequest, GitMerge, ExternalLink } from "lucide-react";
import type { PullRequest } from "@/api/github";

interface PRHeaderProps {
  pr: PullRequest;
  owner: string;
  repo: string;
}

export function PRHeader({ pr, owner, repo }: PRHeaderProps) {
  const stateIcon =
    pr.state === "open" ? (
      <GitPullRequest className="w-4 h-4 text-green-500" />
    ) : pr.state === "merged" ? (
      <GitMerge className="w-4 h-4 text-purple-500" />
    ) : (
      <GitPullRequest className="w-4 h-4 text-red-500" />
    );

  return (
    <header className="border-b border-border px-4 py-3 flex items-center gap-4">
      <div className="flex items-center gap-2">
        {stateIcon}
        <span className="text-sm text-muted-foreground">
          {owner}/{repo}
        </span>
        <span className="text-muted-foreground">#</span>
        <span className="font-medium">{pr.number}</span>
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

        <div className="text-xs text-muted-foreground">
          {pr.base.ref} ← {pr.head.ref}
        </div>

        <a
          href={`https://github.com/${owner}/${repo}/pull/${pr.number}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    </header>
  );
}

