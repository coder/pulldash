import { memo } from "react";
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

export const Markdown = memo(function Markdown({
  children,
  className,
}: MarkdownProps) {
  return (
    <div
      className={cn(
        "prose prose-sm prose-invert max-w-none",
        // Paragraphs
        "prose-p:my-2 prose-p:leading-relaxed",
        // Code blocks
        "prose-pre:bg-muted prose-pre:rounded-md prose-pre:p-4 prose-pre:overflow-x-auto",
        // Inline code
        "prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none prose-code:font-mono",
        // Links
        "prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline",
        // Lists
        "prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5",
        // Blockquotes
        "prose-blockquote:border-l-4 prose-blockquote:border-muted-foreground/30 prose-blockquote:pl-4 prose-blockquote:italic prose-blockquote:text-muted-foreground prose-blockquote:my-3",
        // Headings
        "prose-headings:my-3 prose-headings:font-semibold prose-h1:text-xl prose-h2:text-lg prose-h3:text-base",
        // Horizontal rule
        "prose-hr:border-border prose-hr:my-4",
        // Images
        "prose-img:rounded-md prose-img:my-2",
        // Tables
        "prose-table:text-sm prose-table:border-collapse prose-table:w-full",
        "prose-th:border prose-th:border-border prose-th:px-3 prose-th:py-2 prose-th:bg-muted prose-th:text-left prose-th:font-medium",
        "prose-td:border prose-td:border-border prose-td:px-3 prose-td:py-2",
        // Task lists (GFM)
        "[&_input[type=checkbox]]:mr-2 [&_input[type=checkbox]]:accent-primary",
        // Strikethrough
        "prose-del:text-muted-foreground",
        className
      )}
    >
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
          // Better code block rendering
          pre: ({ children, ...props }) => (
            <pre
              className="not-prose bg-muted rounded-md p-4 overflow-x-auto text-sm"
              {...props}
            >
              {children}
            </pre>
          ),
          code: ({ className, children, ...props }) => {
            // Check if it's inline code (no className means inline)
            const isInline = !className;
            if (isInline) {
              return (
                <code
                  className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code className={cn("font-mono text-sm", className)} {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});
