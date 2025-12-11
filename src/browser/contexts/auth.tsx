import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";

// ============================================================================
// GitHub OAuth App Configuration
// ============================================================================

// OAuth App Client ID - enables simple user authentication like GitHub CLI.
// Users just authorize and get access to their repos based on scopes.
// No app installation required on repos/orgs.
export const GITHUB_CLIENT_ID = "Ov23ct2e5eDCkITh5xlh";

// Storage keys
const TOKEN_STORAGE_KEY = "pulldash_github_token";
const TOKEN_EXPIRY_KEY = "pulldash_github_token_expiry";

// ============================================================================
// Types
// ============================================================================

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  error?: string;
  error_description?: string;
}

interface DeviceAuthState {
  status: "idle" | "polling" | "success" | "error";
  userCode: string | null;
  verificationUri: string | null;
  error: string | null;
}

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  token: string | null;
  deviceAuth: DeviceAuthState;
  // Anonymous mode - user can browse public repos without auth
  isAnonymous: boolean;
  // Rate limit state
  isRateLimited: boolean;
}

interface AuthContextValue extends AuthState {
  startDeviceAuth: () => Promise<void>;
  cancelDeviceAuth: () => void;
  loginWithPAT: (token: string) => Promise<void>;
  logout: () => void;
  // Enable anonymous browsing mode
  enableAnonymousMode: () => void;
  // Check if user can write (authenticated, not anonymous)
  canWrite: boolean;
  // Show the welcome/auth dialog (for re-authenticating from anonymous mode)
  showWelcomeDialog: boolean;
  setShowWelcomeDialog: (show: boolean) => void;
  // Set rate limit state (called by GitHub context when rate limited)
  setRateLimited: (limited: boolean) => void;
}

// ============================================================================
// Context
// ============================================================================

const AuthContext = createContext<AuthContextValue | null>(null);

// ============================================================================
// Helper Functions
// ============================================================================

function getStoredToken(): string | null {
  try {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    const expiry = localStorage.getItem(TOKEN_EXPIRY_KEY);

    // Check if token exists and hasn't expired
    if (token) {
      if (expiry) {
        const expiryDate = new Date(expiry);
        if (expiryDate > new Date()) {
          return token;
        }
        // Token expired, clear it
        clearStoredToken();
        return null;
      }
      // No expiry set, token is valid (GitHub tokens don't expire unless revoked)
      return token;
    }
    return null;
  } catch {
    return null;
  }
}

function storeToken(token: string, expiresIn?: number): void {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    if (expiresIn) {
      const expiryDate = new Date(Date.now() + expiresIn * 1000);
      localStorage.setItem(TOKEN_EXPIRY_KEY, expiryDate.toISOString());
    }
  } catch {
    console.error("Failed to store token in localStorage");
  }
}

function clearStoredToken(): void {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
  } catch {
    // Ignore
  }
}

// ============================================================================
// Provider
// ============================================================================

// Storage key for anonymous mode preference
const ANONYMOUS_MODE_KEY = "pulldash_anonymous_mode";

function getStoredAnonymousMode(): boolean {
  try {
    return localStorage.getItem(ANONYMOUS_MODE_KEY) === "true";
  } catch {
    return false;
  }
}

function setStoredAnonymousMode(enabled: boolean): void {
  try {
    if (enabled) {
      localStorage.setItem(ANONYMOUS_MODE_KEY, "true");
    } else {
      localStorage.removeItem(ANONYMOUS_MODE_KEY);
    }
  } catch {
    // Ignore
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => {
    const token = getStoredToken();
    const isAnonymous = !token && getStoredAnonymousMode();
    return {
      isAuthenticated: !!token,
      isLoading: false,
      token,
      deviceAuth: {
        status: "idle",
        userCode: null,
        verificationUri: null,
        error: null,
      },
      isAnonymous,
      isRateLimited: false,
    };
  });

  // Track polling abort controller
  const [abortController, setAbortController] =
    useState<AbortController | null>(null);

  // Track whether to show the welcome dialog (for re-authenticating from anonymous mode)
  const [showWelcomeDialog, setShowWelcomeDialog] = useState(false);

  // Set rate limit state
  const setRateLimited = useCallback(
    (limited: boolean) => {
      setState((prev) => ({ ...prev, isRateLimited: limited }));
      // If rate limited and anonymous, force show the welcome dialog
      if (limited && !state.isAuthenticated) {
        setShowWelcomeDialog(true);
      }
    },
    [state.isAuthenticated]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortController?.abort();
    };
  }, [abortController]);

  const startDeviceAuth = useCallback(async () => {
    // Cancel any existing auth flow
    abortController?.abort();
    const newController = new AbortController();
    setAbortController(newController);

    setState((prev) => ({
      ...prev,
      isLoading: true,
      deviceAuth: {
        status: "polling",
        userCode: null,
        verificationUri: null,
        error: null,
      },
    }));

    try {
      // Step 1: Request device code via our API (GitHub doesn't support CORS)
      const deviceCodeRes = await fetch("/api/auth/device/code", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        signal: newController.signal,
      });

      if (!deviceCodeRes.ok) {
        const errorData = await deviceCodeRes.json().catch(() => ({}));
        throw new Error(
          errorData.error || "Failed to initiate device authorization"
        );
      }

      const deviceCode: DeviceCodeResponse = await deviceCodeRes.json();

      setState((prev) => ({
        ...prev,
        deviceAuth: {
          ...prev.deviceAuth,
          userCode: deviceCode.user_code,
          verificationUri: deviceCode.verification_uri,
        },
      }));

      // Step 2: Poll for token
      const pollInterval = (deviceCode.interval || 5) * 1000;
      const expiresAt = Date.now() + deviceCode.expires_in * 1000;

      while (Date.now() < expiresAt) {
        // Check if cancelled
        if (newController.signal.aborted) {
          return;
        }

        // Wait before polling
        await new Promise((resolve) => setTimeout(resolve, pollInterval));

        // Check again after waiting
        if (newController.signal.aborted) {
          return;
        }

        try {
          // Poll for token via our API (GitHub doesn't support CORS)
          const tokenRes = await fetch("/api/auth/device/token", {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              device_code: deviceCode.device_code,
            }),
            signal: newController.signal,
          });

          const tokenData: TokenResponse = await tokenRes.json();

          if (tokenData.error) {
            if (tokenData.error === "authorization_pending") {
              // User hasn't completed auth yet, keep polling
              continue;
            } else if (tokenData.error === "slow_down") {
              // We're polling too fast, increase interval
              await new Promise((resolve) => setTimeout(resolve, 5000));
              continue;
            } else if (tokenData.error === "expired_token") {
              throw new Error("Authorization expired. Please try again.");
            } else if (tokenData.error === "access_denied") {
              throw new Error("Authorization was denied.");
            } else {
              throw new Error(tokenData.error_description || tokenData.error);
            }
          }

          if (tokenData.access_token) {
            // Success! Store the token and disable anonymous mode
            storeToken(tokenData.access_token);
            setStoredAnonymousMode(false);
            setState({
              isAuthenticated: true,
              isLoading: false,
              token: tokenData.access_token,
              deviceAuth: {
                status: "success",
                userCode: null,
                verificationUri: null,
                error: null,
              },
              isAnonymous: false,
              isRateLimited: false,
            });
            return;
          }
        } catch (err) {
          if ((err as Error).name === "AbortError") {
            return;
          }
          throw err;
        }
      }

      // Expired
      throw new Error("Authorization expired. Please try again.");
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          deviceAuth: {
            status: "idle",
            userCode: null,
            verificationUri: null,
            error: null,
          },
        }));
        return;
      }

      setState((prev) => ({
        ...prev,
        isLoading: false,
        deviceAuth: {
          status: "error",
          userCode: null,
          verificationUri: null,
          error: (err as Error).message,
        },
      }));
    }
  }, [abortController]);

  const cancelDeviceAuth = useCallback(() => {
    abortController?.abort();
    setState((prev) => ({
      ...prev,
      isLoading: false,
      deviceAuth: {
        status: "idle",
        userCode: null,
        verificationUri: null,
        error: null,
      },
    }));
  }, [abortController]);

  const loginWithPAT = useCallback(async (token: string): Promise<void> => {
    // Basic format validation
    const trimmedToken = token.trim();
    if (!trimmedToken) {
      throw new Error("Token cannot be empty");
    }

    // Validate token format (GitHub PAT prefixes)
    if (
      !trimmedToken.startsWith("ghp_") &&
      !trimmedToken.startsWith("github_pat_")
    ) {
      throw new Error(
        'Invalid token format. GitHub tokens should start with "ghp_" or "github_pat_"'
      );
    }

    // Validate token with backend
    const response = await fetch("/api/auth/validate-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: trimmedToken }),
    });

    const result = await response.json();

    if (!result.valid) {
      throw new Error(result.error || "Token validation failed");
    }

    // Warn if token doesn't have required scopes
    if (!result.hasRequiredScopes) {
      console.warn('Token may not have required "repo" scope');
    }

    // Store token (same mechanism as device flow)
    storeToken(trimmedToken);
    setStoredAnonymousMode(false);
    setState({
      isAuthenticated: true,
      isLoading: false,
      token: trimmedToken,
      deviceAuth: {
        status: "idle",
        userCode: null,
        verificationUri: null,
        error: null,
      },
      isAnonymous: false,
      isRateLimited: false,
    });

    console.log("Successfully authenticated with PAT as user:", result.user);
  }, []);

  const logout = useCallback(() => {
    clearStoredToken();
    setStoredAnonymousMode(false);
    setState({
      isAuthenticated: false,
      isLoading: false,
      token: null,
      deviceAuth: {
        status: "idle",
        userCode: null,
        verificationUri: null,
        error: null,
      },
      isAnonymous: false,
      isRateLimited: false,
    });
  }, []);

  const enableAnonymousMode = useCallback(() => {
    setStoredAnonymousMode(true);
    setState((prev) => ({
      ...prev,
      isAnonymous: true,
    }));
  }, []);

  const value: AuthContextValue = {
    ...state,
    startDeviceAuth,
    cancelDeviceAuth,
    loginWithPAT,
    logout,
    enableAnonymousMode,
    canWrite: state.isAuthenticated && !state.isAnonymous,
    showWelcomeDialog,
    setShowWelcomeDialog,
    setRateLimited,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ============================================================================
// Hooks
// ============================================================================

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}

export function useToken(): string | null {
  const { token } = useAuth();
  return token;
}

export function useIsAuthenticated(): boolean {
  const { isAuthenticated } = useAuth();
  return isAuthenticated;
}

export function useIsAnonymous(): boolean {
  const { isAnonymous } = useAuth();
  return isAnonymous;
}

export function useCanWrite(): boolean {
  const { canWrite } = useAuth();
  return canWrite;
}
