import { memo, useState, useCallback, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeHighlight from "rehype-highlight";
import { cn } from "../cn";

interface MarkdownProps {
  children: string;
  className?: string;
}

// GitHub-style markdown rendering
export const Markdown = memo(function Markdown({
  children,
  className,
}: MarkdownProps) {
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
});

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

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [autoFocus]);

  // Switch back to write mode when content changes externally (like clearing)
  useEffect(() => {
    if (!value && activeTab === "preview") {
      setActiveTab("write");
    }
  }, [value, activeTab]);

  const handleTabChange = useCallback((tab: "write" | "preview") => {
    setActiveTab(tab);
    if (tab === "write") {
      // Focus textarea when switching to write
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
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
    [value, onChange, onKeyDown]
  );

  return (
    <div className="markdown-editor border border-border rounded-md overflow-hidden bg-background">
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
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(
            "w-full px-3 py-2 text-sm bg-transparent resize-none focus:outline-none",
            "placeholder:text-muted-foreground",
            disabled && "opacity-50 cursor-not-allowed"
          )}
          style={{ minHeight }}
        />
      ) : (
        <div
          className="px-3 py-2 overflow-auto"
          style={{ minHeight }}
        >
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
          Supports Markdown. <kbd className="px-1 py-0.5 bg-muted rounded text-[9px] font-mono">⌘</kbd>+<kbd className="px-1 py-0.5 bg-muted rounded text-[9px] font-mono">Enter</kbd> to submit
        </p>
      </div>
    </div>
  );
});
