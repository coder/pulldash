import { useMemo, useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  File,
  FileCode,
  FilePlus,
  FileMinus,
  FileEdit,
  Check,
  MessageSquare,
} from "lucide-react";
import { cn } from "../cn";
import type { PullRequestFile } from "@/api/github";

interface FileTreeProps {
  files: PullRequestFile[];
  selectedFile: string | null;
  viewedFiles: Set<string>;
  commentCounts: Record<string, number>;
  onSelectFile: (filename: string) => void;
}

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: TreeNode[];
  file?: PullRequestFile;
}

function buildTree(files: PullRequestFile[]): TreeNode[] {
  const root: Record<string, TreeNode> = {};

  for (const file of files) {
    const parts = file.filename.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join("/");

      if (!current[part]) {
        current[part] = {
          name: part,
          path,
          type: isLast ? "file" : "folder",
          children: isLast ? undefined : {},
          file: isLast ? file : undefined,
        } as TreeNode & { children: Record<string, TreeNode> };
      }

      if (!isLast) {
        current = (
          current[part] as TreeNode & { children: Record<string, TreeNode> }
        ).children!;
      }
    }
  }

  function convertToArray(obj: Record<string, TreeNode>): TreeNode[] {
    return Object.values(obj)
      .map((node) => ({
        ...node,
        children: node.children
          ? convertToArray(node.children as unknown as Record<string, TreeNode>)
          : undefined,
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }

  return convertToArray(root);
}

function getFileIcon(file: PullRequestFile) {
  switch (file.status) {
    case "added":
      return <FilePlus className="w-4 h-4 text-green-500" />;
    case "removed":
      return <FileMinus className="w-4 h-4 text-red-500" />;
    case "modified":
    case "changed":
      return <FileEdit className="w-4 h-4 text-yellow-500" />;
    case "renamed":
      return <FileCode className="w-4 h-4 text-blue-500" />;
    default:
      return <File className="w-4 h-4 text-muted-foreground" />;
  }
}

function TreeNodeComponent({
  node,
  depth,
  selectedFile,
  viewedFiles,
  commentCounts,
  onSelectFile,
  expandedFolders,
  toggleFolder,
}: {
  node: TreeNode;
  depth: number;
  selectedFile: string | null;
  viewedFiles: Set<string>;
  commentCounts: Record<string, number>;
  onSelectFile: (filename: string) => void;
  expandedFolders: Set<string>;
  toggleFolder: (path: string) => void;
}) {
  const isExpanded = expandedFolders.has(node.path);
  const isSelected = node.type === "file" && selectedFile === node.path;
  const isViewed = node.type === "file" && viewedFiles.has(node.path);
  const commentCount =
    node.type === "file" ? commentCounts[node.path] || 0 : 0;

  if (node.type === "folder") {
    return (
      <div>
        <button
          onClick={() => toggleFolder(node.path)}
          className={cn(
            "w-full flex items-center gap-1 px-2 py-1 text-sm hover:bg-muted/50 transition-colors",
            "text-left"
          )}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {isExpanded && node.children && (
          <div>
            {node.children.map((child) => (
              <TreeNodeComponent
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedFile={selectedFile}
                viewedFiles={viewedFiles}
                commentCounts={commentCounts}
                onSelectFile={onSelectFile}
                expandedFolders={expandedFolders}
                toggleFolder={toggleFolder}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelectFile(node.path)}
      className={cn(
        "w-full flex items-center gap-2 px-2 py-1.5 text-sm transition-colors",
        "text-left hover:bg-muted/50",
        isSelected && "bg-muted",
        isViewed && "opacity-60"
      )}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      {node.file && getFileIcon(node.file)}
      <span className="truncate flex-1">{node.name}</span>
      <div className="flex items-center gap-1 shrink-0">
        {commentCount > 0 && (
          <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
            <MessageSquare className="w-3 h-3" />
            {commentCount}
          </span>
        )}
        {isViewed && <Check className="w-3 h-3 text-green-500" />}
      </div>
    </button>
  );
}

export function FileTree({
  files,
  selectedFile,
  viewedFiles,
  commentCounts,
  onSelectFile,
}: FileTreeProps) {
  const tree = useMemo(() => buildTree(files), [files]);

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => {
    const folders = new Set<string>();
    for (const file of files) {
      const parts = file.filename.split("/");
      for (let i = 1; i < parts.length; i++) {
        folders.add(parts.slice(0, i).join("/"));
      }
    }
    return folders;
  });

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  return (
    <nav className="flex-1 overflow-auto py-2">
      {tree.map((node) => (
        <TreeNodeComponent
          key={node.path}
          node={node}
          depth={0}
          selectedFile={selectedFile}
          viewedFiles={viewedFiles}
          commentCounts={commentCounts}
          onSelectFile={onSelectFile}
          expandedFolders={expandedFolders}
          toggleFolder={toggleFolder}
        />
      ))}
    </nav>
  );
}

