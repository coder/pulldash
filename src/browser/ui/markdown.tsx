import {
  memo,
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  createContext,
  useContext,
  createElement,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkGemoji from "remark-gemoji";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeHighlight from "rehype-highlight";
import { cn } from "../cn";
import { isMac } from "./keycap";
import { Popover, PopoverContent, PopoverAnchor } from "./popover";
import { useGitHubStore, useGitHubSelector } from "../contexts/github";
import { UserHoverCard } from "./user-hover-card";
import {
  Loader2,
  Bold,
  Italic,
  Code,
  Link,
  List,
  ListOrdered,
  Quote,
  Heading2,
  Smile,
  X,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";
import { Dialog, DialogContent, DialogTitle } from "./dialog";

interface MarkdownProps {
  children: string;
  className?: string;
  emptyState?: React.ReactNode;
  /**
   * Pre-rendered HTML from GitHub's API (via Accept: application/vnd.github.full+json).
   * When provided, this will be rendered instead of parsing markdown.
   * This is needed for private user-attachments which have signed URLs in the HTML.
   */
  html?: string;
}

// Pattern to match @mentions (GitHub-style: @username)
const MENTION_REGEX = /@([a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38})/g;

// ============================================================================
// Image Preview Context & Modal
// ============================================================================

interface ImagePreviewContextValue {
  openPreview: (src: string, alt?: string) => void;
}

const ImagePreviewContext = createContext<ImagePreviewContextValue | null>(
  null
);

function useImagePreview() {
  return useContext(ImagePreviewContext);
}

function ImagePreviewProvider({ children }: { children: ReactNode }) {
  const [previewImage, setPreviewImage] = useState<{
    src: string;
    alt?: string;
  } | null>(null);
  const [zoom, setZoom] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [scrollStart, setScrollStart] = useState({ x: 0, y: 0 });

  const openPreview = useCallback((src: string, alt?: string) => {
    setPreviewImage({ src, alt });
    setZoom(1);
  }, []);

  const closePreview = useCallback(() => {
    setPreviewImage(null);
    setZoom(1);
  }, []);

  // Pan/drag handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (zoom <= 1 || !containerRef.current) return;
      e.preventDefault();
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
      setScrollStart({
        x: containerRef.current.scrollLeft,
        y: containerRef.current.scrollTop,
      });
    },
    [zoom]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging || !containerRef.current) return;
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      containerRef.current.scrollLeft = scrollStart.x - dx;
      containerRef.current.scrollTop = scrollStart.y - dy;
    },
    [isDragging, dragStart, scrollStart]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleZoomIn = useCallback(() => {
    setZoom((z) => Math.min(z + 0.25, 4));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((z) => Math.max(z - 0.25, 0.25));
  }, []);

  const handleResetZoom = useCallback(() => {
    setZoom(1);
  }, []);

  // Handle keyboard shortcuts
  useEffect(() => {
    if (!previewImage) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closePreview();
      } else if (e.key === "+" || e.key === "=") {
        handleZoomIn();
      } else if (e.key === "-") {
        handleZoomOut();
      } else if (e.key === "0") {
        handleResetZoom();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    previewImage,
    closePreview,
    handleZoomIn,
    handleZoomOut,
    handleResetZoom,
  ]);

  const contextValue = useMemo(() => ({ openPreview }), [openPreview]);

  return (
    <ImagePreviewContext.Provider value={contextValue}>
      {children}
      <Dialog open={!!previewImage} onOpenChange={() => closePreview()}>
        <DialogContent
          className="!max-w-[90vw] max-h-[90vh] w-auto h-auto p-0 bg-black/95 border-border/50 overflow-hidden flex flex-col gap-0 sm:!max-w-[90vw]"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">
            {previewImage?.alt || "Image preview"}
          </DialogTitle>
          {previewImage && (
            <>
              {/* Toolbar */}
              <div className="flex items-center justify-between px-3 py-2 bg-black/50 border-b border-white/10">
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleZoomOut}
                    className="p-1.5 rounded bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors"
                    title="Zoom out (-)"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </button>
                  <span className="text-xs text-white/70 font-mono min-w-[4ch] text-center px-1">
                    {Math.round(zoom * 100)}%
                  </span>
                  <button
                    onClick={handleZoomIn}
                    className="p-1.5 rounded bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors"
                    title="Zoom in (+)"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </button>
                  <button
                    onClick={handleResetZoom}
                    className="p-1.5 rounded bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors ml-1"
                    title="Reset zoom (0)"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </div>
                {previewImage.alt && (
                  <span className="text-xs text-white/60 truncate max-w-[40%] px-2">
                    {previewImage.alt}
                  </span>
                )}
                <button
                  onClick={closePreview}
                  className="p-1.5 rounded bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors"
                  title="Close (Esc)"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Image container */}
              <div
                ref={containerRef}
                className={cn(
                  "overflow-auto flex-1 flex items-center justify-center p-4 min-h-0",
                  zoom > 1 && (isDragging ? "cursor-grabbing" : "cursor-grab")
                )}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              >
                <img
                  src={previewImage.src}
                  alt={previewImage.alt || "Preview"}
                  className={cn(
                    "max-w-[85vw] max-h-[80vh] object-contain transition-transform duration-150 select-none",
                    zoom > 1 && "pointer-events-none"
                  )}
                  style={{
                    transform: `scale(${zoom})`,
                    transformOrigin: "center center",
                  }}
                  draggable={false}
                />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </ImagePreviewContext.Provider>
  );
}

// ============================================================================
// HTML with Mentions Component
// ============================================================================
// Parses GitHub's pre-rendered HTML and replaces user-mention links with our
// UserHoverCard component for a rich hover experience.

interface HtmlNode {
  type: "text" | "element" | "mention";
  content?: string;
  tag?: string;
  attributes?: Record<string, string>;
  children?: HtmlNode[];
  login?: string;
}

// Convert CSS string like "color: red; margin-top: 10px" to React style object
function parseStyleString(styleStr: string): Record<string, string> {
  const style: Record<string, string> = {};
  if (!styleStr) return style;

  styleStr.split(";").forEach((declaration) => {
    const [property, value] = declaration.split(":").map((s) => s.trim());
    if (property && value) {
      // Convert kebab-case to camelCase (e.g., margin-top -> marginTop)
      const camelCase = property.replace(/-([a-z])/g, (_, letter) =>
        letter.toUpperCase()
      );
      style[camelCase] = value;
    }
  });

  return style;
}

function parseHtmlToNodes(html: string): HtmlNode[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  return parseNodeList(doc.body.childNodes);
}

function parseNodeList(nodes: NodeListOf<ChildNode>): HtmlNode[] {
  const result: HtmlNode[] = [];
  nodes.forEach((node) => {
    const parsed = parseNode(node);
    if (parsed) result.push(parsed);
  });
  return result;
}

function parseNode(node: Node): HtmlNode | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent || "";
    if (!text) return null;
    return { type: "text", content: text };
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element;
    const tag = el.tagName.toLowerCase();

    // Check if this is a GitHub user-mention link
    if (tag === "a" && el.classList.contains("user-mention")) {
      const href = el.getAttribute("href") || "";
      // Extract username from href like "https://github.com/username"
      const match = href.match(/github\.com\/([a-zA-Z0-9-]+)$/);
      if (match) {
        return {
          type: "mention",
          login: match[1],
          content: el.textContent || `@${match[1]}`,
        };
      }
    }

    // Build attributes map
    const attributes: Record<string, string> = {};
    for (const attr of Array.from(el.attributes)) {
      attributes[attr.name] = attr.value;
    }

    return {
      type: "element",
      tag,
      attributes,
      children: parseNodeList(el.childNodes),
    };
  }

  return null;
}

function HtmlWithMentions({ html }: { html: string }) {
  const nodes = useMemo(() => parseHtmlToNodes(html), [html]);
  const imagePreview = useImagePreview();

  const rendered = useMemo(
    () => renderNodes(nodes, imagePreview?.openPreview),
    [nodes, imagePreview]
  );

  return <>{rendered}</>;
}

function renderNodes(
  nodes: HtmlNode[],
  openPreview?: (src: string, alt?: string) => void
): React.ReactNode {
  return nodes.map((node, index) => renderNode(node, index, openPreview));
}

function renderNode(
  node: HtmlNode,
  key: number,
  openPreview?: (src: string, alt?: string) => void
): React.ReactNode {
  if (node.type === "text") {
    return node.content;
  }

  if (node.type === "mention" && node.login) {
    return (
      <UserHoverCard key={key} login={node.login}>
        <a
          href={`https://github.com/${node.login}`}
          target="_blank"
          rel="noopener noreferrer"
          className="user-mention text-blue-400 hover:underline font-medium"
          onClick={(e) => e.stopPropagation()}
        >
          {node.content}
        </a>
      </UserHoverCard>
    );
  }

  if (node.type === "element" && node.tag) {
    // Filter out problematic attributes that React doesn't like
    const safeAttributes: Record<string, unknown> = {};
    if (node.attributes) {
      for (const [attrName, attrValue] of Object.entries(node.attributes)) {
        // Skip data-* attributes that GitHub adds for their hovercard system
        if (
          attrName.startsWith("data-hovercard") ||
          attrName.startsWith("data-octo")
        ) {
          continue;
        }
        // Convert class to className
        if (attrName === "class") {
          safeAttributes.className = attrValue;
        } else if (attrName === "for") {
          safeAttributes.htmlFor = attrValue;
        } else if (attrName === "style") {
          // Convert CSS string to React style object
          safeAttributes.style = parseStyleString(attrValue);
        } else {
          safeAttributes[attrName] = attrValue;
        }
      }
    }

    // Handle void elements (self-closing) - they cannot have children
    const voidElements = new Set([
      "area",
      "base",
      "br",
      "col",
      "embed",
      "hr",
      "img",
      "input",
      "link",
      "meta",
      "param",
      "source",
      "track",
      "wbr",
    ]);

    // Special handling for images - make them clickable for preview
    if (node.tag === "img" && openPreview) {
      const src = node.attributes?.src;
      const alt = node.attributes?.alt;
      if (src) {
        return (
          <img
            key={key}
            {...(safeAttributes as React.ImgHTMLAttributes<HTMLImageElement>)}
            className={cn(
              safeAttributes.className as string,
              "cursor-pointer hover:opacity-90 transition-opacity"
            )}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              openPreview(src, alt);
            }}
          />
        );
      }
    }

    if (voidElements.has(node.tag)) {
      return createElement(node.tag, { key, ...safeAttributes });
    }

    const children = node.children
      ? renderNodes(node.children, openPreview)
      : null;
    return createElement(node.tag, { key, ...safeAttributes }, children);
  }

  return null;
}

// GitHub-style markdown rendering with @mention support
export const Markdown = memo(function Markdown({
  children,
  className,
  emptyState,
  html,
}: MarkdownProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isEmpty, setIsEmpty] = useState(false);

  // Check if rendered content is empty after mount
  useEffect(() => {
    if (containerRef.current && emptyState) {
      const text = containerRef.current.textContent?.trim() || "";
      setIsEmpty(text.length === 0);
    }
  }, [children, html, emptyState]);

  // If pre-rendered HTML is provided (from GitHub's API with signed attachment URLs), use it
  if (html) {
    return (
      <ImagePreviewProvider>
        {isEmpty && emptyState}
        <div
          ref={containerRef}
          className={cn("markdown-body", className, isEmpty && "hidden")}
        >
          <HtmlWithMentions html={html} />
        </div>
      </ImagePreviewProvider>
    );
  }
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
      <>
        {isEmpty && emptyState}
        <div
          ref={containerRef}
          className={cn("markdown-body", className, isEmpty && "hidden")}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkGemoji]}
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
      </>
    );
  }

  // Render with mentions wrapped in hover cards
  // We need to process mentions within the markdown, so we'll use a custom component
  return (
    <>
      {isEmpty && emptyState}
      <div
        ref={containerRef}
        className={cn("markdown-body", className, isEmpty && "hidden")}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkGemoji]}
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
    </>
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

// GitHub-supported emoji reactions
const EMOJI_LIST = [
  { emoji: "😄", name: "smile" },
  { emoji: "😕", name: "confused" },
  { emoji: "❤️", name: "heart" },
  { emoji: "👀", name: "eyes" },
  { emoji: "🚀", name: "rocket" },
  { emoji: "👍", name: "+1" },
  { emoji: "👎", name: "-1" },
  { emoji: "🎉", name: "hooray" },
  { emoji: "🔥", name: "fire" },
  { emoji: "💯", name: "100" },
  { emoji: "✨", name: "sparkles" },
  { emoji: "⚡", name: "zap" },
  { emoji: "🐛", name: "bug" },
  { emoji: "🔧", name: "wrench" },
  { emoji: "📝", name: "memo" },
  { emoji: "✅", name: "check" },
];

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

  // Emoji picker state
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const [emojiPickerPosition, setEmojiPickerPosition] = useState({
    top: 0,
    left: 0,
  });

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

  // Formatting toolbar actions
  const wrapSelection = useCallback(
    (before: string, after: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selectedText = value.substring(start, end);

      const newValue =
        value.substring(0, start) +
        before +
        selectedText +
        after +
        value.substring(end);

      onChange(newValue);

      // Set cursor position after the inserted text
      setTimeout(() => {
        const newCursorPos = selectedText
          ? start + before.length + selectedText.length + after.length
          : start + before.length;
        textarea.focus();
        textarea.setSelectionRange(
          selectedText ? start + before.length : newCursorPos,
          selectedText
            ? start + before.length + selectedText.length
            : newCursorPos
        );
      }, 0);
    },
    [value, onChange]
  );

  const insertAtLineStart = useCallback(
    (prefix: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      // Find the start of the current line
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;

      const newValue =
        value.substring(0, lineStart) + prefix + value.substring(lineStart);

      onChange(newValue);

      setTimeout(() => {
        const newCursorPos = start + prefix.length;
        textarea.focus();
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
    },
    [value, onChange]
  );

  const insertLink = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = value.substring(start, end);

    if (selectedText) {
      // Wrap selected text as link text
      const newValue =
        value.substring(0, start) +
        `[${selectedText}](url)` +
        value.substring(end);
      onChange(newValue);
      setTimeout(() => {
        textarea.focus();
        // Select "url" for easy replacement
        const urlStart = start + selectedText.length + 3;
        textarea.setSelectionRange(urlStart, urlStart + 3);
      }, 0);
    } else {
      // Insert placeholder
      const newValue =
        value.substring(0, start) + "[text](url)" + value.substring(end);
      onChange(newValue);
      setTimeout(() => {
        textarea.focus();
        // Select "text" for easy replacement
        textarea.setSelectionRange(start + 1, start + 5);
      }, 0);
    }
  }, [value, onChange]);

  // Insert emoji at cursor position
  const insertEmoji = useCallback(
    (emoji: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;

      const newValue = value.substring(0, start) + emoji + value.substring(end);
      onChange(newValue);

      setShowEmojiPicker(false);

      setTimeout(() => {
        const newCursorPos = start + emoji.length;
        textarea.focus();
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
    },
    [value, onChange]
  );

  const handleToggleEmojiPicker = useCallback(() => {
    if (!showEmojiPicker && emojiButtonRef.current) {
      const rect = emojiButtonRef.current.getBoundingClientRect();
      setEmojiPickerPosition({
        top: rect.bottom + 4,
        left: Math.max(8, rect.right - 200), // Align right edge, with min left margin
      });
    }
    setShowEmojiPicker(!showEmojiPicker);
  }, [showEmojiPicker]);

  const toolbarButtons = [
    {
      icon: Heading2,
      label: "Heading",
      shortcut: undefined,
      action: () => insertAtLineStart("## "),
    },
    {
      icon: Bold,
      label: "Bold",
      shortcut: `${isMac ? "⌘" : "Ctrl"}+B`,
      action: () => wrapSelection("**", "**"),
    },
    {
      icon: Italic,
      label: "Italic",
      shortcut: `${isMac ? "⌘" : "Ctrl"}+I`,
      action: () => wrapSelection("_", "_"),
    },
    { type: "separator" as const },
    {
      icon: Code,
      label: "Code",
      shortcut: undefined,
      action: () => wrapSelection("`", "`"),
    },
    {
      icon: Link,
      label: "Link",
      shortcut: `${isMac ? "⌘" : "Ctrl"}+K`,
      action: insertLink,
    },
    { type: "separator" as const },
    {
      icon: List,
      label: "Bulleted list",
      shortcut: undefined,
      action: () => insertAtLineStart("- "),
    },
    {
      icon: ListOrdered,
      label: "Numbered list",
      shortcut: undefined,
      action: () => insertAtLineStart("1. "),
    },
    {
      icon: Quote,
      label: "Quote",
      shortcut: undefined,
      action: () => insertAtLineStart("> "),
    },
  ];

  return (
    <div
      className="markdown-editor rounded-lg overflow-hidden bg-background border border-border focus-within:border-blue-500/50 focus-within:ring-1 focus-within:ring-blue-500/30 transition-all"
      style={{ fontFamily: "var(--font-sans)" }}
    >
      {/* Tab bar with toolbar */}
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-1">
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => handleTabChange("write")}
            className={cn(
              "px-3 py-2 text-sm font-medium transition-colors relative",
              activeTab === "write"
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
            style={{ fontFamily: "var(--font-sans)" }}
          >
            Write
            {activeTab === "write" && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500 rounded-t-full" />
            )}
          </button>
          <button
            type="button"
            onClick={() => handleTabChange("preview")}
            className={cn(
              "px-3 py-2 text-sm font-medium transition-colors relative",
              activeTab === "preview"
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
            style={{ fontFamily: "var(--font-sans)" }}
          >
            Preview
            {activeTab === "preview" && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500 rounded-t-full" />
            )}
          </button>
        </div>

        {/* Formatting toolbar - only visible in write mode */}
        {activeTab === "write" && (
          <div className="flex items-center gap-0.5 pr-1">
            {toolbarButtons.map((btn, idx) =>
              btn.type === "separator" ? (
                <div key={idx} className="w-px h-4 bg-border mx-1" />
              ) : (
                <Tooltip key={idx}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={btn.action}
                      className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                    >
                      <btn.icon className="w-4 h-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    {btn.label}
                    {btn.shortcut && (
                      <span className="ml-2 text-muted-foreground">
                        {btn.shortcut}
                      </span>
                    )}
                  </TooltipContent>
                </Tooltip>
              )
            )}
            {/* Emoji picker button */}
            <div className="w-px h-4 bg-border mx-1" />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  ref={emojiButtonRef}
                  type="button"
                  onClick={handleToggleEmojiPicker}
                  className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                >
                  <Smile className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                Insert emoji
              </TooltipContent>
            </Tooltip>

            {/* Emoji picker dropdown */}
            {showEmojiPicker && (
              <>
                <div
                  className="fixed inset-0 z-[100]"
                  onClick={() => setShowEmojiPicker(false)}
                />
                <div
                  className="fixed p-2 bg-card border border-border rounded-lg shadow-xl z-[101] grid grid-cols-8 gap-1"
                  style={{
                    top: emojiPickerPosition.top,
                    left: emojiPickerPosition.left,
                  }}
                >
                  {EMOJI_LIST.map(({ emoji, name }) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => insertEmoji(emoji)}
                      className="w-8 h-8 flex items-center justify-center text-lg rounded hover:bg-muted transition-colors"
                      title={name}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
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
      <div
        className="px-3 py-2 border-t border-border bg-muted/20"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <span>Supports Markdown</span>
          <span className="text-border">·</span>
          <span>
            Type <span className="text-foreground/70">@</span> to mention
          </span>
          <span className="text-border">·</span>
          <span className="inline-flex items-center gap-0.5">
            <kbd
              className="px-1 py-0.5 bg-muted border border-border/50 rounded text-[10px]"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {isMac ? "⌘" : "Ctrl"}
            </kbd>
            <kbd
              className="px-1 py-0.5 bg-muted border border-border/50 rounded text-[10px]"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              ↵
            </kbd>
            <span className="ml-0.5">to submit</span>
          </span>
        </p>
      </div>
    </div>
  );
});
