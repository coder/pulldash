import { useState, useCallback, type ReactNode } from "react";
import {
  MapPin,
  Clock,
  Building2,
  Link as LinkIcon,
  GitPullRequest,
} from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./hover-card";
import { useGitHubSafe, type UserProfile } from "../contexts/github";
import { Skeleton } from "./skeleton";
import { cn } from "../cn";

// ============================================================================
// User Hover Card Component
// ============================================================================

interface UserHoverCardProps {
  /** The GitHub username */
  login: string;
  /** The trigger element (what the user hovers over) */
  children: ReactNode;
  /** Additional context like "Opened this pull request" */
  context?: string;
  /** Side to show the hover card */
  side?: "top" | "right" | "bottom" | "left";
  /** Alignment of the hover card */
  align?: "start" | "center" | "end";
}

export function UserHoverCard({
  login,
  children,
  context,
  side = "bottom",
  align = "start",
}: UserHoverCardProps) {
  const github = useGitHubSafe();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    if (!github || profile || loading) return;

    setLoading(true);
    setError(null);
    try {
      const data = await github.getUserProfile(login);
      setProfile(data);
    } catch (e) {
      setError("Failed to load profile");
      console.error("Failed to fetch user profile:", e);
    } finally {
      setLoading(false);
    }
  }, [github, login, profile, loading]);

  return (
    <HoverCard openDelay={300} closeDelay={100}>
      <HoverCardTrigger asChild onMouseEnter={fetchProfile}>
        {children}
      </HoverCardTrigger>
      <HoverCardContent side={side} align={align} className="w-80">
        {loading ? (
          <UserHoverCardSkeleton />
        ) : error ? (
          <div className="text-sm text-muted-foreground">{error}</div>
        ) : profile ? (
          <UserHoverCardContent profile={profile} context={context} />
        ) : (
          <UserHoverCardSkeleton />
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

// ============================================================================
// Content Component
// ============================================================================

function UserHoverCardContent({
  profile,
  context,
}: {
  profile: UserProfile;
  context?: string;
}) {
  // Calculate timezone offset if location suggests a timezone
  const timezoneInfo = getTimezoneDisplay();

  return (
    <div className="space-y-3">
      {/* Header - Avatar and Name */}
      <div className="flex items-start gap-3">
        <img
          src={profile.avatar_url}
          alt={profile.login}
          className="w-12 h-12 rounded-full ring-1 ring-border"
        />
        <div className="flex-1 min-w-0">
          <a
            href={profile.html_url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-foreground hover:text-blue-400 hover:underline"
          >
            {profile.name || profile.login}
          </a>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span>{profile.login}</span>
            {profile.pronouns && (
              <>
                <span>·</span>
                <span>{profile.pronouns}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Bio */}
      {profile.bio && (
        <p className="text-sm text-foreground leading-relaxed">{profile.bio}</p>
      )}

      {/* Context - like "Opened this pull request" */}
      {context && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <GitPullRequest className="w-4 h-4" />
          <span>{context}</span>
        </div>
      )}

      {/* Metadata */}
      <div className="space-y-1.5">
        {profile.company && (
          <div className="flex items-center gap-2 text-sm">
            <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="truncate">
              {profile.company.startsWith("@") ? (
                <a
                  href={`https://github.com/${profile.company.slice(1)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:underline"
                >
                  {profile.company}
                </a>
              ) : (
                profile.company
              )}
            </span>
          </div>
        )}

        {profile.location && (
          <div className="flex items-center gap-2 text-sm">
            <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="truncate">{profile.location}</span>
          </div>
        )}

        {timezoneInfo && (
          <div className="flex items-center gap-2 text-sm">
            <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
            <span>{timezoneInfo}</span>
          </div>
        )}

        {profile.blog && (
          <div className="flex items-center gap-2 text-sm">
            <LinkIcon className="w-4 h-4 text-muted-foreground shrink-0" />
            <a
              href={
                profile.blog.startsWith("http")
                  ? profile.blog
                  : `https://${profile.blog}`
              }
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:underline truncate"
            >
              {profile.blog.replace(/^https?:\/\//, "")}
            </a>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 text-sm text-muted-foreground pt-1">
        <span>
          <span className="font-medium text-foreground">
            {formatNumber(profile.followers)}
          </span>{" "}
          followers
        </span>
        <span>
          <span className="font-medium text-foreground">
            {formatNumber(profile.following)}
          </span>{" "}
          following
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// Skeleton Component
// ============================================================================

function UserHoverCardSkeleton() {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <Skeleton className="w-12 h-12 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
      <div className="space-y-1.5 pt-1">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-32" />
      </div>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toString();
}

function getTimezoneDisplay(): string | null {
  // For now, just show the user's local time
  // In a real implementation, you'd try to infer timezone from location
  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${timeStr} local time`;
}

// ============================================================================
// Simple User Link with Hover Card
// ============================================================================

interface UserLinkProps {
  login: string;
  avatarUrl?: string;
  showAvatar?: boolean;
  context?: string;
  className?: string;
}

export function UserLink({
  login,
  avatarUrl,
  showAvatar = false,
  context,
  className,
}: UserLinkProps) {
  return (
    <UserHoverCard login={login} context={context}>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 cursor-pointer",
          className
        )}
      >
        {showAvatar && avatarUrl && (
          <img src={avatarUrl} alt={login} className="w-5 h-5 rounded-full" />
        )}
        <span className="font-semibold hover:text-blue-400 hover:underline">
          {login}
        </span>
      </span>
    </UserHoverCard>
  );
}

// ============================================================================
// User Avatar with Hover Card
// ============================================================================

interface UserAvatarProps {
  login: string;
  avatarUrl: string;
  size?: "sm" | "md" | "lg";
  context?: string;
  className?: string;
}

const sizeClasses = {
  sm: "w-5 h-5",
  md: "w-8 h-8",
  lg: "w-10 h-10",
};

export function UserAvatar({
  login,
  avatarUrl,
  size = "md",
  context,
  className,
}: UserAvatarProps) {
  return (
    <UserHoverCard login={login} context={context}>
      <img
        src={avatarUrl}
        alt={login}
        className={cn(
          "rounded-full cursor-pointer ring-1 ring-transparent hover:ring-border transition-all",
          sizeClasses[size],
          className
        )}
      />
    </UserHoverCard>
  );
}
