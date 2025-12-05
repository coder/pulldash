import { useState, useCallback, useEffect, useMemo } from "react";
import {
  Github,
  Copy,
  Check,
  ExternalLink,
  Loader2,
  AlertCircle,
  LogOut,
  GitPullRequest,
  Eye,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Globe,
  ArrowRight,
  Clock,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Button } from "../ui/button";
import { useAuth } from "../contexts/auth";
import { useCurrentUser } from "../contexts/github";
import { useOpenPRReviewTab } from "../contexts/tabs";
import { cn } from "../cn";
import { isMac } from "../ui/keycap";

// ============================================================================
// Animation Data
// ============================================================================

// Sample PRs for live update animation
const samplePRs = [
  {
    id: 1,
    title: "Fix authentication race condition",
    author: "alice",
    repo: "api",
    additions: 24,
    deletions: 8,
    time: "2m",
  },
  {
    id: 2,
    title: "Add dark mode support",
    author: "bob",
    repo: "frontend",
    additions: 156,
    deletions: 42,
    time: "5m",
  },
  {
    id: 3,
    title: "Optimize database queries",
    author: "carol",
    repo: "backend",
    additions: 89,
    deletions: 234,
    time: "12m",
  },
  {
    id: 4,
    title: "Update dependencies",
    author: "dave",
    repo: "core",
    additions: 12,
    deletions: 8,
    time: "1h",
  },
];

// Files for diff navigation animation
const reviewFiles = [
  {
    name: "api/auth.ts",
    additions: 24,
    deletions: 8,
    viewed: false,
    diff: [
      { type: "context", line: 47, code: "async function refreshToken() {" },
      { type: "delete", line: 48, code: "  await sleep(1000);" },
      { type: "add", line: 48, code: "  const token = await getNewToken();" },
      {
        type: "add",
        line: 49,
        code: "  localStorage.setItem('token', token);",
      },
      { type: "context", line: 50, code: "}" },
    ],
  },
  {
    name: "lib/utils.ts",
    additions: 12,
    deletions: 3,
    viewed: false,
    diff: [
      {
        type: "context",
        line: 12,
        code: "export function formatDate(d: Date) {",
      },
      { type: "delete", line: 13, code: "  return d.toString();" },
      {
        type: "add",
        line: 13,
        code: "  return d.toLocaleDateString('en-US', {",
      },
      { type: "add", line: 14, code: "    month: 'short', day: 'numeric'" },
      { type: "add", line: 15, code: "  });" },
    ],
  },
  {
    name: "components/Button.tsx",
    additions: 45,
    deletions: 0,
    viewed: false,
    diff: [
      {
        type: "context",
        line: 8,
        code: "export function Button({ children }) {",
      },
      {
        type: "add",
        line: 9,
        code: "  const [loading, setLoading] = useState(false);",
      },
      {
        type: "add",
        line: 10,
        code: "  const handleClick = useCallback(() => {",
      },
      { type: "add", line: 11, code: "    setLoading(true);" },
      { type: "context", line: 12, code: "  }, []);" },
    ],
  },
  {
    name: "hooks/useUser.ts",
    additions: 8,
    deletions: 15,
    viewed: false,
    diff: [
      { type: "context", line: 23, code: "export function useUser() {" },
      {
        type: "delete",
        line: 24,
        code: "  const [user, setUser] = useState(null);",
      },
      {
        type: "delete",
        line: 25,
        code: "  const [loading, setLoading] = useState(true);",
      },
      {
        type: "add",
        line: 24,
        code: "  const { data: user } = useSWR('/api/user');",
      },
      { type: "context", line: 25, code: "  return { user };" },
    ],
  },
];

// ============================================================================
// Stage 1: Live PR Updates Animation
// ============================================================================

function LivePRListAnimation({ isActive }: { isActive: boolean }) {
  const [visiblePRs, setVisiblePRs] = useState<typeof samplePRs>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<"review" | "authored">(
    "review"
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pressedKey, setPressedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!isActive) {
      setVisiblePRs([]);
      setSelectedIndex(0);
      setPressedKey(null);
      return;
    }

    // Stagger in PRs
    const timers: ReturnType<typeof setTimeout>[] = [];
    samplePRs.forEach((pr, i) => {
      timers.push(
        setTimeout(
          () => {
            setVisiblePRs((prev) => [...prev, pr]);
          },
          300 + i * 200
        )
      );
    });

    // Navigate down with arrow keys
    timers.push(setTimeout(() => setPressedKey("↓"), 1400));
    timers.push(
      setTimeout(() => {
        setPressedKey(null);
        setSelectedIndex(1);
      }, 1550)
    );

    timers.push(setTimeout(() => setPressedKey("↓"), 1800));
    timers.push(
      setTimeout(() => {
        setPressedKey(null);
        setSelectedIndex(2);
      }, 1950)
    );

    // Simulate filter change
    timers.push(
      setTimeout(() => {
        setActiveFilter("authored");
        setSelectedIndex(0);
      }, 2400)
    );

    // Simulate refresh
    timers.push(
      setTimeout(() => {
        setIsRefreshing(true);
      }, 3000)
    );

    timers.push(
      setTimeout(() => {
        setIsRefreshing(false);
      }, 3400)
    );

    // Press enter to open
    timers.push(setTimeout(() => setPressedKey("Enter"), 3600));
    timers.push(setTimeout(() => setPressedKey(null), 3750));

    return () => timers.forEach(clearTimeout);
  }, [isActive]);

  return (
    <div className="relative w-full h-52 bg-card rounded-lg border border-border overflow-hidden shadow-lg">
      {/* Header with filters */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/20">
        <div className="flex items-center gap-2">
          <div className="flex rounded-md overflow-hidden border border-border">
            <button
              className={cn(
                "px-2 py-0.5 text-[10px] font-medium transition-colors",
                activeFilter === "review"
                  ? "bg-blue-500/20 text-blue-400"
                  : "text-muted-foreground"
              )}
            >
              <Eye className="w-3 h-3 inline mr-1" />
              Review
            </button>
            <button
              className={cn(
                "px-2 py-0.5 text-[10px] font-medium border-l border-border transition-colors",
                activeFilter === "authored"
                  ? "bg-blue-500/20 text-blue-400"
                  : "text-muted-foreground"
              )}
            >
              Authored
            </button>
          </div>
        </div>
        <RefreshCw
          className={cn(
            "w-3.5 h-3.5 text-muted-foreground transition-all",
            isRefreshing && "animate-spin text-blue-400"
          )}
        />
      </div>

      {/* PR List */}
      <div className="p-1.5 space-y-1">
        {visiblePRs.map((pr, i) => (
          <div
            key={pr.id}
            className={cn(
              "flex items-center gap-2 px-2 py-1.5 rounded-md transition-all duration-150",
              "hover:bg-muted/30 cursor-pointer",
              i === selectedIndex && "bg-blue-500/10 border border-blue-500/20"
            )}
            style={{
              animation: "slideInFade 0.3s ease-out forwards",
              opacity: 0,
              transform: "translateY(-8px)",
              animationDelay: `${i * 50}ms`,
            }}
          >
            <GitPullRequest className="w-3.5 h-3.5 text-green-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-medium text-foreground truncate">
                {pr.title}
              </div>
              <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
                <span className="font-mono">{pr.repo}</span>
                <span>•</span>
                <span>{pr.author}</span>
                <span>•</span>
                <span>{pr.time}</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-[9px] font-mono shrink-0">
              <span className="text-green-400">+{pr.additions}</span>
              <span className="text-red-400">−{pr.deletions}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Keyboard hint */}
      <div className="absolute bottom-2 left-0 right-0 flex justify-center">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-muted/50 text-[9px] text-muted-foreground">
          <kbd
            className={cn(
              "px-1 py-0.5 font-mono rounded text-[8px] transition-all duration-100",
              pressedKey === "↑"
                ? "bg-foreground text-background scale-110 shadow-sm"
                : "bg-background/50"
            )}
          >
            ↑
          </kbd>
          <kbd
            className={cn(
              "px-1 py-0.5 font-mono rounded text-[8px] transition-all duration-100",
              pressedKey === "↓"
                ? "bg-foreground text-background scale-110 shadow-sm"
                : "bg-background/50"
            )}
          >
            ↓
          </kbd>
          <span>navigate</span>
          <span className="mx-1 opacity-40">•</span>
          <kbd
            className={cn(
              "px-1 py-0.5 font-mono rounded text-[8px] transition-all duration-100",
              pressedKey === "Enter"
                ? "bg-foreground text-background scale-110 shadow-sm"
                : "bg-background/50"
            )}
          >
            Enter
          </kbd>
          <span>open</span>
        </div>
      </div>

      <style>{`
        @keyframes slideInFade {
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}

// ============================================================================
// Stage 2: Fast File Navigation Animation
// ============================================================================

function FileNavigationAnimation({ isActive }: { isActive: boolean }) {
  const [activeFile, setActiveFile] = useState(0);
  const [viewedFiles, setViewedFiles] = useState<Set<number>>(new Set());
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [showKeyHint, setShowKeyHint] = useState<string | null>(null);

  useEffect(() => {
    if (!isActive) {
      setActiveFile(0);
      setViewedFiles(new Set());
      return;
    }

    const sequence = [
      // Navigate and mark viewed
      { delay: 500, action: () => setShowKeyHint("j") },
      {
        delay: 700,
        action: () => {
          setShowKeyHint(null);
          setIsTransitioning(true);
        },
      },
      {
        delay: 800,
        action: () => {
          setActiveFile(1);
          setIsTransitioning(false);
        },
      },
      { delay: 1200, action: () => setShowKeyHint("v") },
      {
        delay: 1400,
        action: () => {
          setShowKeyHint(null);
          setViewedFiles(new Set([1]));
        },
      },
      { delay: 1800, action: () => setShowKeyHint("j") },
      {
        delay: 2000,
        action: () => {
          setShowKeyHint(null);
          setIsTransitioning(true);
        },
      },
      {
        delay: 2100,
        action: () => {
          setActiveFile(2);
          setIsTransitioning(false);
        },
      },
      { delay: 2500, action: () => setShowKeyHint("v") },
      {
        delay: 2700,
        action: () => {
          setShowKeyHint(null);
          setViewedFiles(new Set([1, 2]));
        },
      },
      { delay: 3100, action: () => setShowKeyHint("j") },
      {
        delay: 3300,
        action: () => {
          setShowKeyHint(null);
          setIsTransitioning(true);
        },
      },
      {
        delay: 3400,
        action: () => {
          setActiveFile(3);
          setIsTransitioning(false);
        },
      },
      { delay: 3800, action: () => setShowKeyHint("v") },
      {
        delay: 4000,
        action: () => {
          setShowKeyHint(null);
          setViewedFiles(new Set([1, 2, 3]));
        },
      },
    ];

    const timers = sequence.map(({ delay, action }) =>
      setTimeout(action, delay)
    );
    return () => timers.forEach(clearTimeout);
  }, [isActive]);

  const file = reviewFiles[activeFile];
  const viewedCount = viewedFiles.size;

  return (
    <div className="relative w-full h-52 bg-card rounded-lg border border-border overflow-hidden shadow-lg">
      {/* File tree sidebar */}
      <div className="absolute left-0 top-0 bottom-0 w-[140px] border-r border-border bg-muted/20">
        <div className="px-2 py-1.5 border-b border-border bg-muted/30">
          <div className="text-[10px] font-medium text-muted-foreground">
            {viewedCount}/4 files reviewed
          </div>
          <div className="mt-1 h-1 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 transition-all duration-300"
              style={{ width: `${(viewedCount / 4) * 100}%` }}
            />
          </div>
        </div>
        <div className="p-1.5 space-y-0.5">
          {reviewFiles.map((f, i) => (
            <div
              key={f.name}
              className={cn(
                "flex items-center gap-1.5 px-1.5 py-1 rounded text-[10px] transition-all duration-150",
                i === activeFile
                  ? "bg-blue-500/15 text-foreground border-l-2 border-blue-500 -ml-0.5 pl-[7px]"
                  : "text-muted-foreground"
              )}
            >
              {viewedFiles.has(i) ? (
                <Check className="w-3 h-3 text-green-500 shrink-0" />
              ) : (
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full shrink-0",
                    f.deletions > f.additions ? "bg-red-400" : "bg-green-400"
                  )}
                />
              )}
              <span
                className={cn(
                  "truncate font-mono",
                  viewedFiles.has(i) && "opacity-50"
                )}
              >
                {f.name.split("/").pop()}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Main diff area */}
      <div className="ml-[140px] h-full flex flex-col">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-muted/30">
          <span
            className={cn(
              "font-mono text-xs text-foreground transition-opacity duration-100",
              isTransitioning ? "opacity-0" : "opacity-100"
            )}
          >
            {file.name}
          </span>
          <div
            className={cn(
              "flex items-center gap-2 text-[10px] font-medium transition-opacity duration-100",
              isTransitioning ? "opacity-0" : "opacity-100"
            )}
          >
            <span className="text-green-400">+{file.additions}</span>
            <span className="text-red-400">−{file.deletions}</span>
          </div>
        </div>

        <div
          className={cn(
            "flex-1 py-1 font-mono text-[10px] leading-[1.5] overflow-hidden transition-opacity duration-100",
            isTransitioning ? "opacity-0" : "opacity-100"
          )}
        >
          {file.diff.map((line, i) => (
            <div
              key={i}
              className={cn(
                "flex px-2",
                line.type === "delete" && "bg-red-500/10",
                line.type === "add" && "bg-green-500/10"
              )}
            >
              <span className="w-7 text-right pr-2 text-muted-foreground/40 select-none shrink-0">
                {line.line}
              </span>
              <span
                className={cn(
                  line.type === "delete" && "text-red-400",
                  line.type === "add" && "text-green-400",
                  line.type === "context" && "text-muted-foreground"
                )}
              >
                {line.type === "delete" && "−"}
                {line.type === "add" && "+"}
                {line.type === "context" && " "} {line.code}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Keyboard hints */}
      <div className="absolute bottom-2 left-[140px] right-0 flex justify-center">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-muted/50 text-[9px] text-muted-foreground">
          <kbd
            className={cn(
              "px-1 py-0.5 font-mono rounded text-[8px] transition-all duration-100",
              showKeyHint === "j"
                ? "bg-foreground text-background scale-110 shadow-sm"
                : "bg-background/50"
            )}
          >
            j
          </kbd>
          <kbd
            className={cn(
              "px-1 py-0.5 font-mono rounded text-[8px] transition-all duration-100",
              showKeyHint === "k"
                ? "bg-foreground text-background scale-110 shadow-sm"
                : "bg-background/50"
            )}
          >
            k
          </kbd>
          <span>files</span>
          <span className="mx-1 opacity-40">•</span>
          <kbd
            className={cn(
              "px-1 py-0.5 font-mono rounded text-[8px] transition-all duration-100",
              showKeyHint === "v"
                ? "bg-foreground text-background scale-110 shadow-sm"
                : "bg-background/50"
            )}
          >
            v
          </kbd>
          <span>mark viewed</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Stage 3: Approve/Reject Animation
// ============================================================================

function ReviewSubmitAnimation({ isActive }: { isActive: boolean }) {
  const [step, setStep] = useState<
    "idle" | "selecting" | "submitting" | "success"
  >("idle");
  const [selectedAction, setSelectedAction] = useState<
    "approve" | "changes" | null
  >(null);
  const [keysPressed, setKeysPressed] = useState(false);

  useEffect(() => {
    if (!isActive) {
      setStep("idle");
      setSelectedAction(null);
      setKeysPressed(false);
      return;
    }

    const timers: ReturnType<typeof setTimeout>[] = [];

    timers.push(setTimeout(() => setStep("selecting"), 400));
    timers.push(setTimeout(() => setSelectedAction("approve"), 1000));
    timers.push(setTimeout(() => setKeysPressed(true), 1500));
    timers.push(setTimeout(() => setStep("submitting"), 1600));
    timers.push(setTimeout(() => setKeysPressed(false), 1700));
    timers.push(setTimeout(() => setStep("success"), 2200));

    return () => timers.forEach(clearTimeout);
  }, [isActive]);

  return (
    <div className="relative w-full h-52 bg-card rounded-lg border border-border overflow-hidden shadow-lg flex flex-col">
      {/* Header showing PR context */}
      <div className="px-3 py-2 border-b border-border bg-muted/20">
        <div className="flex items-center gap-2">
          <GitPullRequest className="w-4 h-4 text-green-500" />
          <span className="text-xs font-medium">
            Fix authentication race condition
          </span>
          <span className="text-[10px] text-muted-foreground font-mono">
            api
          </span>
        </div>
      </div>

      {/* Review summary */}
      <div className="flex-1 flex flex-col items-center justify-center p-4">
        {step === "success" ? (
          <div className="flex flex-col items-center gap-3 animate-in fade-in zoom-in-95 duration-300">
            <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
              <CheckCircle2 className="w-10 h-10 text-green-500 animate-in zoom-in-50 duration-500" />
            </div>
            <div className="text-center">
              <div className="text-sm font-medium text-green-400">
                Approved!
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                Review submitted successfully
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* File summary */}
            <div className="flex items-center gap-3 mb-4 text-[11px] text-muted-foreground">
              <div className="flex items-center gap-1">
                <Check className="w-3.5 h-3.5 text-green-500" />
                <span>4 files reviewed</span>
              </div>
              <span>•</span>
              <div className="flex items-center gap-1">
                <span className="text-green-400">+89</span>
                <span className="text-red-400">−260</span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2">
              <button
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium transition-all duration-200",
                  selectedAction === "approve"
                    ? "bg-green-500 text-white scale-105 shadow-lg shadow-green-500/25"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted"
                )}
              >
                {step === "submitting" && selectedAction === "approve" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                )}
                Approve
              </button>
              <button
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium transition-all duration-200",
                  selectedAction === "changes"
                    ? "bg-orange-500 text-white scale-105 shadow-lg shadow-orange-500/25"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted"
                )}
              >
                <XCircle className="w-3.5 h-3.5" />
                Request changes
              </button>
            </div>
          </>
        )}
      </div>

      {/* Keyboard hints */}
      {step !== "success" && (
        <div className="absolute bottom-2 left-0 right-0 flex justify-center">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-muted/50 text-[9px] text-muted-foreground">
            <kbd
              className={cn(
                "px-1 py-0.5 font-mono rounded text-[8px] transition-all duration-100",
                keysPressed
                  ? "bg-foreground text-background scale-110 shadow-sm"
                  : "bg-background/50"
              )}
            >
              {isMac ? "⌘" : "Ctrl"}
            </kbd>
            <span>+</span>
            <kbd
              className={cn(
                "px-1 py-0.5 font-mono rounded text-[8px] transition-all duration-100",
                keysPressed
                  ? "bg-foreground text-background scale-110 shadow-sm"
                  : "bg-background/50"
              )}
            >
              Enter
            </kbd>
            <span>submit review</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Animation Component - Cycles through stages
// ============================================================================

type AnimationStage = "pr-list" | "file-nav" | "review-submit";

const stageInfo: Record<
  AnimationStage,
  { title: string; description: string }
> = {
  "pr-list": {
    title: "Live PR updates",
    description: "Filter and find PRs instantly",
  },
  "file-nav": {
    title: "Lightning fast reviews",
    description: "Navigate files with keyboard shortcuts",
  },
  "review-submit": {
    title: "Submit your review",
    description: "Approve or request changes",
  },
};

function PRReviewAnimation() {
  const [stage, setStage] = useState<AnimationStage>("pr-list");
  const [stageIndex, setStageIndex] = useState(0);
  const stages: AnimationStage[] = ["pr-list", "file-nav", "review-submit"];

  useEffect(() => {
    const durations: Record<AnimationStage, number> = {
      "pr-list": 4000,
      "file-nav": 5000,
      "review-submit": 3500,
    };

    const timer = setTimeout(() => {
      const nextIndex = (stageIndex + 1) % stages.length;
      setStageIndex(nextIndex);
      setStage(stages[nextIndex]);
    }, durations[stage]);

    return () => clearTimeout(timer);
  }, [stage, stageIndex]);

  const currentInfo = stageInfo[stage];

  return (
    <div className="space-y-3">
      {/* Stage indicators */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-medium text-foreground">
            {currentInfo.title}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {currentInfo.description}
          </div>
        </div>
        <div className="flex gap-1">
          {stages.map((s, i) => (
            <div
              key={s}
              className={cn(
                "w-1.5 h-1.5 rounded-full transition-all duration-300",
                i === stageIndex
                  ? "bg-foreground w-4"
                  : "bg-muted-foreground/30"
              )}
            />
          ))}
        </div>
      </div>

      {/* Animation content */}
      <div className="relative h-52">
        {stage === "pr-list" && <LivePRListAnimation isActive={true} />}
        {stage === "file-nav" && <FileNavigationAnimation isActive={true} />}
        {stage === "review-submit" && <ReviewSubmitAnimation isActive={true} />}
      </div>
    </div>
  );
}

// ============================================================================
// Welcome Dialog - Handles unauthenticated state
// ============================================================================

// Featured PRs from popular open source projects for read-only browsing
// These are real, substantial PRs that showcase the review experience
const FEATURED_PRS = [
  {
    owner: "ghostty-org",
    repo: "ghostty",
    number: 9803,
    title: "terminal/tmux: a lot more control mode parsing, functionality",
    files: 5,
    additions: 1563,
    deletions: 448,
  },
  {
    owner: "oven-sh",
    repo: "bun",
    number: 25168,
    title: "feat(url): implement URLPattern API",
    files: 38,
    additions: 7339,
    deletions: 2,
  },
  {
    owner: "facebook",
    repo: "react",
    number: 35277,
    title: "Patch FlightReplyServer with fixes from ReactFlightClient",
    files: 9,
    additions: 712,
    deletions: 278,
  },
];

export function WelcomeDialog() {
  const {
    isAuthenticated,
    isAnonymous,
    isLoading,
    isRateLimited,
    deviceAuth,
    startDeviceAuth,
    cancelDeviceAuth,
    enableAnonymousMode,
    showWelcomeDialog,
    setShowWelcomeDialog,
  } = useAuth();
  const openPRReviewTab = useOpenPRReviewTab();

  const [copied, setCopied] = useState(false);

  // Copy user code to clipboard
  const copyCode = useCallback(async () => {
    if (deviceAuth.userCode) {
      await navigator.clipboard.writeText(deviceAuth.userCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [deviceAuth.userCode]);

  // Open GitHub after user has copied the code
  const openGitHub = useCallback(() => {
    if (deviceAuth.verificationUri) {
      window.open(deviceAuth.verificationUri, "_blank");
    }
  }, [deviceAuth.verificationUri]);

  // Copy and open GitHub
  const copyAndOpen = useCallback(async () => {
    if (deviceAuth.userCode) {
      await navigator.clipboard.writeText(deviceAuth.userCode);
      setCopied(true);
    }
    openGitHub();
  }, [deviceAuth.userCode, openGitHub]);

  // Open a featured PR
  const handleOpenFeaturedPR = useCallback(
    (pr: (typeof FEATURED_PRS)[0]) => {
      enableAnonymousMode();
      setShowWelcomeDialog(false);
      openPRReviewTab(pr.owner, pr.repo, pr.number);
    },
    [enableAnonymousMode, setShowWelcomeDialog, openPRReviewTab]
  );

  // Handle close dialog
  const handleClose = useCallback(() => {
    setShowWelcomeDialog(false);
    cancelDeviceAuth();
  }, [setShowWelcomeDialog, cancelDeviceAuth]);

  // Show if: not authenticated and not anonymous, OR explicitly requested via showWelcomeDialog (only when not authenticated), OR rate limited
  const shouldShow =
    (!isAuthenticated && !isAnonymous) ||
    (showWelcomeDialog && !isAuthenticated) ||
    isRateLimited;

  if (!shouldShow) {
    return null;
  }

  const isPending = isLoading || deviceAuth.status === "polling";
  const hasCode = !!deviceAuth.userCode;
  const hasError = deviceAuth.status === "error";

  // Show close button when user is anonymous and explicitly opened the dialog (but not if rate limited)
  const showCloseButton = isAnonymous && showWelcomeDialog && !isRateLimited;

  // Disable sample PRs when rate limited and not authenticated
  const samplePRsDisabled = isRateLimited && !isAuthenticated;

  return (
    <Dialog open={true} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent
        showCloseButton={showCloseButton}
        className="sm:max-w-3xl p-0 gap-0 bg-background border-border overflow-hidden"
      >
        <DialogTitle className="sr-only">Welcome to Pulldash</DialogTitle>
        <DialogDescription className="sr-only">
          Sign in with GitHub to access your pull requests, or browse sample PRs
          anonymously.
        </DialogDescription>
        <div className="flex">
          {/* Left Side - Sign In */}
          <div className="flex-1 p-6 border-r border-border">
            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
              <img src={"/logo.svg"} alt="Pulldash" className="w-10 h-10" />
              <div>
                <h2 className="text-lg font-semibold text-foreground">
                  Pulldash
                </h2>
                <p className="text-sm text-muted-foreground">Fast PR reviews</p>
              </div>
            </div>

            {/* Rate Limit State - Authenticated Users */}
            {isRateLimited && isAuthenticated && (
              <div className="flex items-start gap-3 p-3 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-400 mb-4">
                <Clock className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium">Rate limit reached</p>
                  <p className="opacity-80 mt-0.5">
                    GitHub API rate limit exceeded. This should resolve
                    automatically in a few minutes.
                  </p>
                </div>
              </div>
            )}

            {/* Rate Limit State - Anonymous Users */}
            {isRateLimited && !isAuthenticated && (
              <div className="flex items-start gap-3 p-3 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-400 mb-4">
                <Clock className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium">Rate limit reached</p>
                  <p className="opacity-80 mt-0.5">
                    Anonymous users are limited to 60 requests per hour. Sign in
                    with GitHub for 5,000 requests per hour.
                  </p>
                </div>
              </div>
            )}

            {/* Error State */}
            {hasError && (
              <div className="flex items-start gap-3 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive mb-4">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium">Authentication failed</p>
                  <p className="opacity-80 mt-0.5">{deviceAuth.error}</p>
                </div>
              </div>
            )}

            {/* Device Code Flow */}
            {hasCode ? (
              <div className="space-y-4">
                <div className="text-center py-4">
                  <p className="text-sm text-muted-foreground mb-3">
                    Enter this code on GitHub
                  </p>
                  <button
                    onClick={copyCode}
                    className={cn(
                      "group inline-flex items-center gap-3 px-5 py-3 rounded-md transition-all",
                      "bg-card border border-border hover:border-foreground/20"
                    )}
                  >
                    <span className="font-mono text-2xl font-bold tracking-[0.25em] text-foreground">
                      {deviceAuth.userCode}
                    </span>
                    <span className="p-1 rounded bg-muted group-hover:bg-muted/80 transition-colors">
                      {copied ? (
                        <Check className="w-4 h-4 text-green-500" />
                      ) : (
                        <Copy className="w-4 h-4 text-muted-foreground" />
                      )}
                    </span>
                  </button>
                  <p className="text-xs text-muted-foreground mt-2">
                    {copied ? "Copied!" : "Click to copy"}
                  </p>
                </div>

                <Button onClick={copyAndOpen} className="w-full h-10 gap-2">
                  <ExternalLink className="w-4 h-4" />
                  {copied ? "Open GitHub" : "Copy & Open GitHub"}
                </Button>

                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground pt-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Waiting for authorization...</span>
                </div>

                <Button
                  onClick={cancelDeviceAuth}
                  variant="ghost"
                  className="w-full h-9 text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </Button>
              </div>
            ) : (
              /* Sign In State */
              <div className="space-y-4">
                <Button
                  onClick={startDeviceAuth}
                  disabled={isPending}
                  className="w-full h-10 gap-2"
                >
                  {isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    <>
                      <Github className="w-4 h-4" />
                      Sign in with GitHub
                    </>
                  )}
                </Button>

                <p className="text-xs text-center text-muted-foreground">
                  All GitHub API calls are made directly from your device.
                  Pulldash does not store your GitHub token.
                </p>

                {/* Animation preview */}
                <div className="pt-4">
                  <PRReviewAnimation />
                </div>
              </div>
            )}
          </div>

          {/* Right Side - Try Without Signing In */}
          <div className="w-[320px] p-6 bg-card/30">
            <div className="mb-4">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Globe className="w-4 h-4 text-muted-foreground" />
                Try without signing in
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                Explore real PRs from popular open source projects
              </p>
            </div>

            <div
              className={cn(
                "space-y-2",
                samplePRsDisabled && "opacity-50 pointer-events-none"
              )}
            >
              {FEATURED_PRS.map((pr) => (
                <button
                  key={`${pr.owner}/${pr.repo}/${pr.number}`}
                  onClick={() => handleOpenFeaturedPR(pr)}
                  disabled={samplePRsDisabled}
                  className={cn(
                    "w-full flex items-start gap-2.5 p-3 rounded-lg border border-border/50",
                    "bg-background/50 hover:bg-background hover:border-border transition-all text-left",
                    "group",
                    samplePRsDisabled && "cursor-not-allowed"
                  )}
                >
                  <GitPullRequest className="w-4 h-4 mt-0.5 text-green-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {pr.owner}/{pr.repo}
                    </div>
                    <div className="text-sm font-medium text-foreground truncate mt-0.5 group-hover:text-blue-400 transition-colors">
                      {pr.title}
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 text-[11px] text-muted-foreground">
                      <span>{pr.files} files</span>
                      <span className="text-green-500">+{pr.additions}</span>
                      <span className="text-red-500">−{pr.deletions}</span>
                    </div>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors mt-1" />
                </button>
              ))}
            </div>

            <p className="text-[11px] text-muted-foreground/70 mt-4 text-center">
              {samplePRsDisabled
                ? "Sign in to continue browsing"
                : "Read-only access to public repositories"}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// User Menu Button - Shows logout option when authenticated, or sign-in for anonymous
// ============================================================================

export function UserMenuButton({ className }: { className?: string }) {
  const { isAuthenticated, isAnonymous, logout, setShowWelcomeDialog } =
    useAuth();
  const currentUser = useCurrentUser()?.login ?? null;

  // Anonymous mode - show read-only indicator with sign-in option
  if (isAnonymous && !isAuthenticated) {
    return (
      <button
        onClick={() => setShowWelcomeDialog(true)}
        className={cn(
          "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors",
          "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/30",
          className
        )}
        title="Sign in with GitHub"
      >
        <Eye className="w-3 h-3" />
        <span>Read-only</span>
      </button>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "flex items-center gap-1.5 p-1 rounded-md hover:bg-muted/50 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
            className
          )}
          title={currentUser ? `Signed in as ${currentUser}` : "Account"}
        >
          {currentUser ? (
            <img
              src={`https://github.com/${currentUser}.png`}
              alt={currentUser}
              className="w-5 h-5 rounded-full ring-1 ring-border"
            />
          ) : (
            <LogOut className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {currentUser && (
          <>
            <DropdownMenuLabel className="font-normal">
              <div className="flex items-center gap-2">
                <img
                  src={`https://github.com/${currentUser}.png`}
                  alt={currentUser}
                  className="w-8 h-8 rounded-full"
                />
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{currentUser}</span>
                  <span className="text-xs text-muted-foreground">
                    Signed in with GitHub
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          variant="destructive"
          onClick={logout}
          className="cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
