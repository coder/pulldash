import {
  memo,
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  createContext,
  useContext,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeHighlight from "rehype-highlight";
import { cn } from "../cn";
import { isMac } from "./keycap";
import { Popover, PopoverContent, PopoverAnchor } from "./popover";
import { useGitHubStore, useGitHubSelector } from "../contexts/github";
import { UserHoverCard } from "./user-hover-card";
import { Loader2 } from "lucide-react";

interface MarkdownProps {
  children: string;
  className?: string;
}

// Pattern to match @mentions (GitHub-style: @username)
const MENTION_REGEX = /@([a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38})/g;

// GitHub-style markdown rendering with @mention support
export const Markdown = memo(function Markdown({
  children,
  className,
}: MarkdownProps) {
  // Parse the content to find @mentions and wrap them
  const processedContent = useMemo(() => {
    // Split by @mentions but keep the mentions
    const parts: Array<{ type: "text" | "mention"; content: string }> = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    const regex = new RegExp(MENTION_REGEX);
    while ((match = regex.exec(children)) !== null) {
      // Add text before the mention
      if (match.index > lastIndex) {
        parts.push({
          type: "text",
          content: children.slice(lastIndex, match.index),
        });
      }
      // Add the mention
      parts.push({ type: "mention", content: match[1] });
      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < children.length) {
      parts.push({ type: "text", content: children.slice(lastIndex) });
    }

    return parts;
  }, [children]);

  // If there are no mentions, just render normally
  const hasMentions = processedContent.some((p) => p.type === "mention");

  if (!hasMentions) {
    return (
      <div className={cn("markdown-body", className)}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[
            rehypeRaw,
            rehypeSanitize,
            [rehypeHighlight, { detect: true, ignoreMissing: true }],
          ]}
          components={{
            // Custom link handling - open external links in new tab
            a: ({ href, children, ...props }) => {
              const isExternal = href?.startsWith("http");
              return (
                <a
                  href={href}
                  target={isExternal ? "_blank" : undefined}
                  rel={isExternal ? "noopener noreferrer" : undefined}
                  {...props}
                >
                  {children}
                </a>
              );
            },
          }}
        >
          {children}
        </ReactMarkdown>
      </div>
    );
  }

  // Render with mentions wrapped in hover cards
  // We need to process mentions within the markdown, so we'll use a custom component
  return (
    <div className={cn("markdown-body", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          rehypeRaw,
          rehypeSanitize,
          [rehypeHighlight, { detect: true, ignoreMissing: true }],
        ]}
        components={{
          // Custom link handling - open external links in new tab
          a: ({ href, children, ...props }) => {
            const isExternal = href?.startsWith("http");
            return (
              <a
                href={href}
                target={isExternal ? "_blank" : undefined}
                rel={isExternal ? "noopener noreferrer" : undefined}
                {...props}
              >
                {children}
              </a>
            );
          },
          // Process text nodes to find and wrap @mentions
          p: ({ children, ...props }) => {
            return <p {...props}>{processChildren(children)}</p>;
          },
          li: ({ children, ...props }) => {
            return <li {...props}>{processChildren(children)}</li>;
          },
          td: ({ children, ...props }) => {
            return <td {...props}>{processChildren(children)}</td>;
          },
          th: ({ children, ...props }) => {
            return <th {...props}>{processChildren(children)}</th>;
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});

// Helper to process children and wrap @mentions
function processChildren(children: React.ReactNode): React.ReactNode {
  if (!children) return children;

  if (typeof children === "string") {
    return processTextForMentions(children);
  }

  if (Array.isArray(children)) {
    return children.map((child, index) => {
      if (typeof child === "string") {
        return <span key={index}>{processTextForMentions(child)}</span>;
      }
      return child;
    });
  }

  return children;
}

// Process a text string and wrap @mentions with hover cards
function processTextForMentions(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  const regex = new RegExp(MENTION_REGEX);
  while ((match = regex.exec(text)) !== null) {
    // Add text before the mention
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    // Add the mention with hover card
    const username = match[1];
    parts.push(
      <UserHoverCard key={key++} login={username}>
        <a
          href={`https://github.com/${username}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:underline font-medium"
          onClick={(e) => e.stopPropagation()}
        >
          @{username}
        </a>
      </UserHoverCard>
    );
    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length === 1 ? parts[0] : parts;
}

// ============================================================================
// Mention Suggestions Context
// ============================================================================

export interface MentionUser {
  login: string;
  avatar_url: string;
  type?: string;
}

interface MentionSuggestionsContextValue {
  suggestedUsers: MentionUser[];
  owner?: string;
  repo?: string;
}

const MentionSuggestionsContext =
  createContext<MentionSuggestionsContextValue | null>(null);

/**
 * Provider for mention suggestions context.
 * Wrap your comment/review forms with this to provide contextual user suggestions.
 */
export function MentionSuggestionsProvider({
  children,
  suggestedUsers,
  owner,
  repo,
}: {
  children: ReactNode;
  suggestedUsers: MentionUser[];
  owner?: string;
  repo?: string;
}) {
  const value = useMemo(
    () => ({ suggestedUsers, owner, repo }),
    [suggestedUsers, owner, repo]
  );
  return (
    <MentionSuggestionsContext.Provider value={value}>
      {children}
    </MentionSuggestionsContext.Provider>
  );
}

function useMentionSuggestions() {
  return useContext(MentionSuggestionsContext);
}

// ============================================================================
// Markdown Editor with Write/Preview tabs (GitHub-style)
// ============================================================================

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  placeholder?: string;
  minHeight?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}

export const MarkdownEditor = memo(function MarkdownEditor({
  value,
  onChange,
  onKeyDown,
  placeholder = "Leave a comment...",
  minHeight = "100px",
  autoFocus = false,
  disabled = false,
}: MarkdownEditorProps) {
  const [activeTab, setActiveTab] = useState<"write" | "preview">("write");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);

  // Mention autocomplete state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState<number>(0);
  const [mentionUsers, setMentionUsers] = useState<MentionUser[]>([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  const [anchorPosition, setAnchorPosition] = useState({ top: 0, left: 0 });

  const github = useGitHubStore();
  const ready = useGitHubSelector((s) => s.ready);

  // Get contextual suggestions from context (if available)
  const mentionContext = useMentionSuggestions();
  const suggestedUsers = mentionContext?.suggestedUsers ?? [];

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [autoFocus]);

  // Switch back to write mode when content is cleared externally (like after submit)
  const prevValueRef = useRef(value);
  useEffect(() => {
    // Only switch if value was cleared (had content before, empty now)
    if (prevValueRef.current && !value && activeTab === "preview") {
      setActiveTab("write");
    }
    prevValueRef.current = value;
  }, [value, activeTab]);

  // Search for users when mention query changes
  useEffect(() => {
    if (mentionQuery === null || !ready) {
      setMentionUsers([]);
      return;
    }

    const query = mentionQuery.toLowerCase();

    // Filter suggested users first
    const filteredSuggestions = suggestedUsers.filter((u) =>
      u.login.toLowerCase().includes(query)
    );

    // If we have enough local matches or query is empty, use those
    if (filteredSuggestions.length >= 5 || query.length === 0) {
      setMentionUsers(filteredSuggestions.slice(0, 8));
      setMentionLoading(false);
      setSelectedMentionIndex(0);
      return;
    }

    // Show local results immediately while searching
    setMentionUsers(filteredSuggestions);
    setSelectedMentionIndex(0);

    // Only search GitHub if query is at least 1 character
    if (query.length < 1) {
      return;
    }

    const timeout = setTimeout(async () => {
      setMentionLoading(true);
      try {
        const results = await github.searchUsers(mentionQuery);
        const searchResults = results.items.map((u) => ({
          login: u.login,
          avatar_url: u.avatar_url,
          type: u.type,
        }));

        // Merge: suggested users first (filtered), then search results (deduplicated)
        const seen = new Set(
          filteredSuggestions.map((u) => u.login.toLowerCase())
        );
        const merged = [
          ...filteredSuggestions,
          ...searchResults.filter((u) => !seen.has(u.login.toLowerCase())),
        ].slice(0, 8);

        setMentionUsers(merged);
        setSelectedMentionIndex(0);
      } catch (e) {
        console.error("Failed to search users:", e);
        // Keep showing filtered suggestions on error
      } finally {
        setMentionLoading(false);
      }
    }, 150);

    return () => clearTimeout(timeout);
  }, [mentionQuery, ready, github, suggestedUsers]);

  const handleTabChange = useCallback((tab: "write" | "preview") => {
    setActiveTab(tab);
    if (tab === "write") {
      // Focus textarea when switching to write
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, []);

  // Calculate caret position for popover placement
  const updateAnchorPosition = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Create a mirror element to calculate position
    const mirror = document.createElement("div");
    const computed = window.getComputedStyle(textarea);

    // Copy styles
    mirror.style.position = "absolute";
    mirror.style.visibility = "hidden";
    mirror.style.whiteSpace = "pre-wrap";
    mirror.style.wordWrap = "break-word";
    mirror.style.font = computed.font;
    mirror.style.padding = computed.padding;
    mirror.style.width = `${textarea.clientWidth}px`;
    mirror.style.lineHeight = computed.lineHeight;

    // Get text up to cursor
    const textBeforeCursor = value.substring(0, textarea.selectionStart);
    mirror.textContent = textBeforeCursor;

    // Add a span to mark cursor position
    const marker = document.createElement("span");
    marker.textContent = "|";
    mirror.appendChild(marker);

    document.body.appendChild(mirror);

    // Get position relative to textarea
    const textareaRect = textarea.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();
    const mirrorRect = mirror.getBoundingClientRect();

    const left = markerRect.left - mirrorRect.left;
    const top = markerRect.top - mirrorRect.top + parseInt(computed.lineHeight);

    document.body.removeChild(mirror);

    setAnchorPosition({ top, left });
  }, [value]);

  // Detect @ mentions while typing
  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      onChange(newValue);

      const cursorPos = e.target.selectionStart;
      const textBeforeCursor = newValue.substring(0, cursorPos);

      // Look for @ followed by word characters (including empty string right after @)
      const mentionMatch = textBeforeCursor.match(/@([a-zA-Z0-9-]*)$/);

      if (mentionMatch) {
        const query = mentionMatch[1];
        setMentionQuery(query);
        setMentionStart(cursorPos - query.length - 1); // -1 for @
        updateAnchorPosition();
      } else {
        setMentionQuery(null);
      }
    },
    [onChange, updateAnchorPosition]
  );

  const insertMention = useCallback(
    (username: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      // Replace @query with @username
      const before = value.substring(0, mentionStart);
      const after = value.substring(textarea.selectionStart);
      const newValue = `${before}@${username} ${after}`;

      onChange(newValue);
      setMentionQuery(null);

      // Set cursor after the mention
      const newCursorPos = mentionStart + username.length + 2; // +2 for @ and space
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
    },
    [value, mentionStart, onChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Handle mention autocomplete navigation
      if (mentionQuery !== null && mentionUsers.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedMentionIndex((prev) =>
            prev < mentionUsers.length - 1 ? prev + 1 : prev
          );
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedMentionIndex((prev) => (prev > 0 ? prev - 1 : prev));
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          insertMention(mentionUsers[selectedMentionIndex].login);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setMentionQuery(null);
          return;
        }
      }

      // Handle Tab key for indentation
      if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const textarea = textareaRef.current;
        if (textarea) {
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          const newValue =
            value.substring(0, start) + "  " + value.substring(end);
          onChange(newValue);
          // Restore cursor position after the spaces
          setTimeout(() => {
            textarea.selectionStart = textarea.selectionEnd = start + 2;
          }, 0);
        }
      }

      // Pass through other keyboard events
      onKeyDown?.(e);
    },
    [
      value,
      onChange,
      onKeyDown,
      mentionQuery,
      mentionUsers,
      selectedMentionIndex,
      insertMention,
    ]
  );

  // Close mention popup on blur (with delay to allow click)
  const handleBlur = useCallback(() => {
    setTimeout(() => {
      setMentionQuery(null);
    }, 200);
  }, []);

  const showMentionPopover =
    mentionQuery !== null &&
    (mentionUsers.length > 0 || mentionLoading || suggestedUsers.length > 0);

  return (
    <div className="markdown-editor border border-border rounded-md overflow-hidden bg-background font-sans">
      {/* Tab bar */}
      <div className="flex items-center border-b border-border bg-muted/30">
        <button
          type="button"
          onClick={() => handleTabChange("write")}
          className={cn(
            "px-3 py-1.5 text-sm font-medium transition-colors relative",
            activeTab === "write"
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          Write
          {activeTab === "write" && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full" />
          )}
        </button>
        <button
          type="button"
          onClick={() => handleTabChange("preview")}
          className={cn(
            "px-3 py-1.5 text-sm font-medium transition-colors relative",
            activeTab === "preview"
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          Preview
          {activeTab === "preview" && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full" />
          )}
        </button>
      </div>

      {/* Content area */}
      {activeTab === "write" ? (
        <Popover open={showMentionPopover}>
          <div className="relative">
            <PopoverAnchor asChild>
              <span
                ref={anchorRef}
                className="absolute pointer-events-none"
                style={{
                  top: anchorPosition.top,
                  left: anchorPosition.left + 12, // +12 for padding
                }}
              />
            </PopoverAnchor>
            <textarea
              ref={textareaRef}
              value={value}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              onBlur={handleBlur}
              placeholder={placeholder}
              disabled={disabled}
              className={cn(
                "w-full px-3 py-2 text-sm bg-transparent resize-none focus:outline-none",
                "placeholder:text-muted-foreground",
                disabled && "opacity-50 cursor-not-allowed"
              )}
              style={{ minHeight }}
            />
          </div>
          <PopoverContent
            side="bottom"
            align="start"
            className="w-64 p-1"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            {mentionLoading && mentionUsers.length === 0 ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            ) : mentionUsers.length === 0 ? (
              <div className="px-2 py-3 text-sm text-muted-foreground text-center">
                No users found
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto">
                {mentionUsers.map((user, index) => (
                  <button
                    key={user.login}
                    type="button"
                    className={cn(
                      "w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left transition-colors",
                      index === selectedMentionIndex
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-muted"
                    )}
                    onClick={() => insertMention(user.login)}
                    onMouseEnter={() => setSelectedMentionIndex(index)}
                  >
                    <img
                      src={user.avatar_url}
                      alt={user.login}
                      className="w-5 h-5 rounded-full"
                    />
                    <span className="font-medium">{user.login}</span>
                    {user.type === "Organization" && (
                      <span className="text-xs text-muted-foreground">org</span>
                    )}
                  </button>
                ))}
                {mentionLoading && (
                  <div className="flex items-center justify-center py-2">
                    <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                  </div>
                )}
              </div>
            )}
          </PopoverContent>
        </Popover>
      ) : (
        <div className="px-3 py-2 overflow-auto" style={{ minHeight }}>
          {value.trim() ? (
            <Markdown className="text-sm">{value}</Markdown>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              Nothing to preview
            </p>
          )}
        </div>
      )}

      {/* Footer hint */}
      <div className="px-3 py-1.5 border-t border-border bg-muted/20">
        <p className="text-[10px] text-muted-foreground">
          Supports Markdown. Type @ to mention users.{" "}
          <kbd className="px-1 py-0.5 bg-muted rounded text-[9px] font-mono">
            {isMac ? "⌘" : "Ctrl"}
          </kbd>
          +
          <kbd className="px-1 py-0.5 bg-muted rounded text-[9px] font-mono">
            Enter
          </kbd>{" "}
          to submit
        </p>
      </div>
    </div>
  );
});
