import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import posthog from "posthog-js";
import { useCurrentUser } from "./github";
import { version } from "../../../package.json";

// ============================================================================
// Configuration
// ============================================================================

const POSTHOG_KEY = "phc_vvticSI4cYwo89gWzSwHeLIMC8jgNy5TeYq2THJX3X5";
const POSTHOG_HOST = "https://us.i.posthog.com";

// App version from package.json (injected at build time or read from meta tag)
const APP_VERSION = version;

// ============================================================================
// Platform Detection
// ============================================================================

export function isElectron(): boolean {
  // Check for Electron-specific globals
  if (typeof window !== "undefined") {
    // Check userAgent for Electron
    if (navigator.userAgent.toLowerCase().includes("electron")) {
      return true;
    }
    // Check for Electron's process object
    if (
      typeof (
        window as unknown as { process?: { versions?: { electron?: string } } }
      ).process?.versions?.electron === "string"
    ) {
      return true;
    }
  }
  return false;
}

function getPlatform(): string {
  if (isElectron()) {
    // Try to get more specific platform info
    const userAgent = navigator.userAgent.toLowerCase();
    if (userAgent.includes("mac")) return "electron-mac";
    if (userAgent.includes("win")) return "electron-windows";
    if (userAgent.includes("linux")) return "electron-linux";
    return "electron";
  }
  return "web";
}

// ============================================================================
// Event Types
// ============================================================================

export type TelemetryEvent =
  | "review_submitted"
  | "pr_viewed"
  | "pr_merged"
  | "comment_added"
  | "file_viewed"
  | "app_opened";

export interface ReviewSubmittedProperties {
  pr_number: number;
  owner: string;
  repo: string;
  review_type: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
  comment_count: number;
  files_reviewed: number;
}

export interface PRViewedProperties {
  pr_number: number;
  owner: string;
  repo: string;
  file_count: number;
  additions: number;
  deletions: number;
}

export interface CommentAddedProperties {
  pr_number: number;
  owner: string;
  repo: string;
  is_pending: boolean;
  has_range: boolean;
}

export interface FileViewedProperties {
  pr_number: number;
  owner: string;
  repo: string;
  file_path: string;
}

export type TelemetryProperties =
  | ReviewSubmittedProperties
  | PRViewedProperties
  | CommentAddedProperties
  | FileViewedProperties
  | Record<string, unknown>;

// ============================================================================
// Context
// ============================================================================

interface TelemetryContextValue {
  track: (event: TelemetryEvent, properties?: TelemetryProperties) => void;
}

const TelemetryContext = createContext<TelemetryContextValue | null>(null);

// ============================================================================
// Provider
// ============================================================================

export function TelemetryProvider({ children }: { children: ReactNode }) {
  const currentUser = useCurrentUser();
  const initializedRef = useRef(false);
  const identifiedUserIdRef = useRef<number | null>(null);

  // Initialize PostHog once
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      // Don't capture page views automatically - we'll do it manually
      capture_pageview: false,
      // Respect user's Do Not Track setting
      respect_dnt: true,
      // Don't persist across sessions if user clears storage
      persistence: "localStorage",
      // Add default properties to all events
      loaded: (ph) => {
        ph.register({
          app_version: APP_VERSION,
          platform: getPlatform(),
          is_electron: isElectron(),
        });
      },
    });

    // Track app opened
    posthog.capture("app_opened");
  }, []);

  // Identify user when GitHub user is available
  useEffect(() => {
    if (currentUser && currentUser.id !== identifiedUserIdRef.current) {
      identifiedUserIdRef.current = currentUser.id;
      // Use GitHub user ID as the stable identifier
      posthog.identify(String(currentUser.id), {
        github_id: currentUser.id,
        github_username: currentUser.login,
        github_name: currentUser.name,
        github_email: currentUser.email,
        github_avatar_url: currentUser.avatar_url,
        github_profile_url: currentUser.html_url,
        github_bio: currentUser.bio,
        github_company: currentUser.company,
        github_location: currentUser.location,
      });
    }
  }, [currentUser]);

  const track = (event: TelemetryEvent, properties?: TelemetryProperties) => {
    posthog.capture(event, properties);
  };

  return (
    <TelemetryContext.Provider value={{ track }}>
      {children}
    </TelemetryContext.Provider>
  );
}

// ============================================================================
// Hooks
// ============================================================================

export function useTelemetry(): TelemetryContextValue {
  const context = useContext(TelemetryContext);
  if (!context) {
    throw new Error("useTelemetry must be used within TelemetryProvider");
  }
  return context;
}
