import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import logoUrl from "../logo.svg";

export function Home() {
  const navigate = useNavigate();
  const [prUrl, setPrUrl] = useState("");
  const [error, setError] = useState("");
  const [isFocused, setIsFocused] = useState(false);

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
    <div className="flex min-h-screen flex-col items-center justify-center p-8 relative overflow-hidden">
      {/* Background gradient effect */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-[#408AC3]/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/4 left-1/3 w-[400px] h-[400px] bg-[#9ED8F7]/5 rounded-full blur-[100px]" />
      </div>

      <main className="flex w-full max-w-md flex-col items-center gap-10">
        {/* Logo and branding */}
        <div className="flex flex-col items-center gap-5">
          <div className="relative group">
            <div className="absolute inset-0 bg-[#408AC3]/20 rounded-3xl blur-xl group-hover:bg-[#408AC3]/30 transition-colors duration-500" />
            <img
              src={logoUrl}
              alt="PullPal"
              className="relative w-24 h-24 drop-shadow-2xl transition-transform duration-300 group-hover:scale-105"
            />
          </div>
          <div className="text-center space-y-2">
            <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-white via-white to-[#9ED8F7] bg-clip-text text-transparent">
              PullPal
            </h1>
            <p className="text-muted-foreground text-sm">
              Lightning-fast GitHub PR reviews
            </p>
          </div>
        </div>

        {/* Input form */}
        <form onSubmit={handleSubmit} className="w-full space-y-4">
          <div className="relative">
            <div
              className={`absolute -inset-0.5 bg-gradient-to-r from-[#408AC3] to-[#9ED8F7] rounded-xl opacity-0 blur transition-opacity duration-300 ${
                isFocused ? "opacity-50" : ""
              }`}
            />
            <input
              type="text"
              value={prUrl}
              onChange={(e) => {
                setPrUrl(e.target.value);
                setError("");
              }}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              placeholder="Paste a GitHub PR URL..."
              className="relative w-full h-12 px-4 rounded-xl border border-white/10 bg-black/50 backdrop-blur-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-[#408AC3]/50 font-mono text-sm transition-colors"
              autoFocus
            />
          </div>

          {error && (
            <p className="text-sm text-red-400 text-center animate-in fade-in slide-in-from-top-1 duration-200">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="w-full h-12 rounded-xl bg-gradient-to-r from-[#408AC3] to-[#3a7db0] text-white font-medium hover:from-[#4a9ad3] hover:to-[#408AC3] transition-all duration-300 shadow-lg shadow-[#408AC3]/20 hover:shadow-[#408AC3]/30 hover:scale-[1.02] active:scale-[0.98]"
          >
            Review PR
          </button>
        </form>

        {/* Hash URL hint */}
        <div className="text-center space-y-3 pt-4 border-t border-white/5 w-full">
          <p className="text-xs text-muted-foreground/70">
            Quick access via hash URL
          </p>
          <code className="block px-4 py-2.5 rounded-lg bg-white/5 border border-white/5 font-mono text-xs text-muted-foreground/80 select-all">
            localhost:3000#github.com/owner/repo/pull/123
          </code>
        </div>
      </main>

      {/* Footer attribution */}
      <footer className="absolute bottom-6 text-xs text-muted-foreground/40">
        Fast. Local. Private.
      </footer>
    </div>
  );
}
