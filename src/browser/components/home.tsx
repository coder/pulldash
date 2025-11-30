import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

export function Home() {
  const navigate = useNavigate();
  const [prUrl, setPrUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    // Check for hash URL and redirect
    const hash = window.location.hash;
    if (hash && hash.startsWith("#")) {
      const url = hash.slice(1);
      handleRedirect(url);
    }
  }, []);

  const handleRedirect = (url: string) => {
    // Parse: https://github.com/owner/repo/pull/123
    const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (match) {
      const [, owner, repo, number] = match;
      navigate(`/${owner}/${repo}/pull/${number}`);
    } else {
      setError("Invalid GitHub PR URL");
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (prUrl.trim()) {
      handleRedirect(prUrl.trim());
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-8">
      <main className="flex w-full max-w-xl flex-col items-center gap-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight mb-2">PRDash</h1>
          <p className="text-muted-foreground">
            Fast GitHub PR review with syntax highlighting
          </p>
        </div>

        <form onSubmit={handleSubmit} className="w-full space-y-4">
          <div className="relative">
            <input
              type="text"
              value={prUrl}
              onChange={(e) => {
                setPrUrl(e.target.value);
                setError("");
              }}
              placeholder="https://github.com/owner/repo/pull/123"
              className="w-full h-12 px-4 rounded-lg border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono text-sm"
              autoFocus
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <button
            type="submit"
            className="w-full h-12 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
          >
            Review PR
          </button>
        </form>

        <div className="text-sm text-muted-foreground text-center space-y-2">
          <p>Or use the hash URL shortcut:</p>
          <code className="block px-3 py-2 rounded bg-muted font-mono text-xs">
            localhost:3000#https://github.com/owner/repo/pull/123
          </code>
        </div>
      </main>
    </div>
  );
}
