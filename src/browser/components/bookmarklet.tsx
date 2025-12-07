import { useState, useEffect, useMemo } from "react";
import { isElectron } from "../contexts/telemetry";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";
import { cn } from "../cn";
import { ArrowRight, Github } from "lucide-react";

const DISMISSED_KEY = "pulldash-bookmarklet-dismissed";

// Generate bookmarklet code with given origin
function getBookmarkletCode(origin: string): string {
  return `javascript:(function(){var m=location.href.match(/^https:\\/\\/github\\.com\\/([^\\/]+)\\/([^\\/]+)\\/pull\\/(\\d+)/);if(!m){alert('Open a GitHub PR first');return;}location.href='${origin}/'+m[1]+'/'+m[2]+'/pull/'+m[3];})();`;
}

// Animation showing the flow: GitHub → Click → Pulldash
function BookmarkletAnimation() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const steps = [0, 1, 2];
    let currentIndex = 0;

    const interval = setInterval(() => {
      currentIndex = (currentIndex + 1) % steps.length;
      setStep(steps[currentIndex]);
    }, 1200);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative h-24 flex items-center justify-center gap-3">
      {/* GitHub */}
      <div
        className={cn(
          "flex flex-col items-center gap-1.5 transition-all duration-300",
          step >= 0 ? "opacity-100 scale-100" : "opacity-40 scale-95"
        )}
      >
        <div
          className={cn(
            "w-12 h-12 rounded-lg bg-[#24292e] flex items-center justify-center transition-all duration-300",
            step === 0 &&
              "ring-2 ring-white/30 ring-offset-2 ring-offset-background"
          )}
        >
          <svg viewBox="0 0 24 24" className="w-7 h-7 text-white fill-current">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
          </svg>
        </div>
        <span className="text-[10px] text-muted-foreground font-medium">
          GitHub PR
        </span>
      </div>

      {/* Arrow 1 */}
      <ArrowRight
        className={cn(
          "w-4 h-4 transition-all duration-300",
          step >= 1 ? "text-foreground" : "text-muted-foreground/30"
        )}
      />

      {/* Bookmark Click */}
      <div
        className={cn(
          "flex flex-col items-center gap-1.5 transition-all duration-300",
          step >= 1 ? "opacity-100 scale-100" : "opacity-40 scale-95"
        )}
      >
        <div
          className={cn(
            "w-12 h-12 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center transition-all duration-300",
            step === 1 &&
              "ring-2 ring-blue-400/30 ring-offset-2 ring-offset-background scale-110"
          )}
        >
          <svg viewBox="0 0 24 24" className="w-6 h-6 text-white fill-current">
            <path d="M5 4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16l-7-3.5L5 20V4z" />
          </svg>
        </div>
        <span className="text-[10px] text-muted-foreground font-medium">
          Click
        </span>
      </div>

      {/* Arrow 2 */}
      <ArrowRight
        className={cn(
          "w-4 h-4 transition-all duration-300",
          step >= 2 ? "text-foreground" : "text-muted-foreground/30"
        )}
      />

      {/* Pulldash */}
      <div
        className={cn(
          "flex flex-col items-center gap-1.5 transition-all duration-300",
          step >= 2 ? "opacity-100 scale-100" : "opacity-40 scale-95"
        )}
      >
        <div
          className={cn(
            "w-12 h-12 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center transition-all duration-300",
            step >= 2 &&
              "ring-2 ring-blue-400/30 ring-offset-2 ring-offset-background"
          )}
        >
          <img src="/logo.svg" alt="Pulldash" className="w-7 h-7" />
        </div>
        <span className="text-[10px] text-muted-foreground font-medium">
          Pulldash
        </span>
      </div>
    </div>
  );
}

interface BookmarkletDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BookmarkletDialog({
  open,
  onOpenChange,
}: BookmarkletDialogProps) {
  // Generate the bookmarklet HTML - using dangerouslySetInnerHTML to bypass React's sanitization of javascript: URLs
  const bookmarkletHtml = useMemo(() => {
    if (typeof window === "undefined") return "";
    const code = getBookmarkletCode(window.location.origin);
    return `<a 
      href="${code.replace(/"/g, "&quot;")}" 
      draggable="true"
      style="display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; height: 56px; border-radius: 10px; font-weight: 600; background: linear-gradient(135deg, rgb(59 130 246) 0%, rgb(79 70 229) 100%); color: white; text-decoration: none; cursor: grab; user-select: none; transition: all 0.15s;"
      onmouseover="this.style.transform='translateY(-1px)';"
      onmouseout="this.style.transform='translateY(0)';"
      onmousedown="this.style.cursor='grabbing'; this.style.transform='scale(0.98)';"
      onmouseup="this.style.cursor='grab'; this.style.transform='scale(1)';"
      onclick="event.preventDefault(); alert('Drag this button to your bookmarks bar!')"
      alt="Open in Pulldash"
    >
      <span style="display: none;">Open in Pulldash</span>
    </a>`;
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-0 gap-0 bg-background border-border overflow-hidden">
        <DialogTitle className="sr-only">Redirect Bookmark</DialogTitle>
        <DialogDescription className="sr-only">
          Add a bookmark to quickly redirect from any GitHub PR to Pulldash
        </DialogDescription>

        {/* Header */}
        <div className="p-6 pb-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-[#24292e] flex items-center justify-center">
              <Github className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                Redirect Bookmark
              </h2>
              <p className="text-xs text-muted-foreground">
                One click from GitHub to Pulldash
              </p>
            </div>
          </div>
        </div>

        {/* Animation */}
        <div className="px-6 pb-2">
          <BookmarkletAnimation />
        </div>

        {/* Bookmarklet */}
        <div className="mx-6 mb-6 relative h-14">
          <div
            className="absolute inset-0"
            dangerouslySetInnerHTML={{ __html: bookmarkletHtml }}
          />
          <span className="pointer-events-none select-none text-sm font-semibold text-white absolute inset-0 flex items-center justify-center gap-2">
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
              <path d="M5 4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16l-7-3.5L5 20V4z" />
            </svg>
            Drag to Bookmarks Bar
          </span>
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 flex items-center justify-between border-t border-border/50 pt-4">
          <p className="text-xs text-muted-foreground">
            Can't drag? Right-click and copy link.
          </p>
          <button
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 rounded-md text-xs font-medium bg-card hover:bg-muted transition-colors border border-border/50"
          >
            Done
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Hook to check if bookmarklet should be shown (not in Electron, not dismissed)
export function useShowBookmarklet() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const dismissed = localStorage.getItem(DISMISSED_KEY) === "true";
    setShow(!isElectron() && !dismissed);
  }, []);

  return show;
}
