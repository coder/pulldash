import { useMemo, useState, useRef, useEffect, useCallback } from "react";
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
  Copy,
  Eye,
  EyeOff,
  GitBranch,
  FolderCheck,
} from "lucide-react";
import { cn } from "../cn";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../ui/context-menu";
import type { PullRequestFile } from "@/api/github";

interface FileTreeProps {
  files: PullRequestFile[];
  selectedFile: string | null;
  selectedFiles: Set<string>;
  viewedFiles: Set<string>;
  hideViewed: boolean;
  commentCounts: Record<string, number>;
  pendingCommentCounts?: Record<string, number>;
  onSelectFile: (filename: string) => void;
  onToggleFileSelection: (filename: string, isShiftClick: boolean) => void;
  onToggleViewed: (filename: string) => void;
  onToggleViewedMultiple: (filenames: string[]) => void;
  onMarkFolderViewed: (folderPath: string, filenames: string[], markAsViewed: boolean) => void;
  onCopyDiff: (filename: string) => void;
  onCopyFile: (filename: string) => void;
  onCopyMainVersion: (filename: string) => void;
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

// Helper to collect all file paths under a folder
function collectFilesInFolder(node: TreeNode): string[] {
  if (node.type === "file") {
    return [node.path];
  }
  if (node.children) {
    return node.children.flatMap(collectFilesInFolder);
  }
  return [];
}

// Filter tree to only show non-viewed files
function filterTree(nodes: TreeNode[], viewedFiles: Set<string>): TreeNode[] {
  return nodes
    .map((node) => {
      if (node.type === "file") {
        return viewedFiles.has(node.path) ? null : node;
      }
      // For folders, recursively filter children
      const filteredChildren = node.children
        ? filterTree(node.children, viewedFiles)
        : [];
      // Only include folder if it has non-viewed children
      if (filteredChildren.length === 0) {
        return null;
      }
      return { ...node, children: filteredChildren };
    })
    .filter((node): node is TreeNode => node !== null);
}

function TreeNodeComponent({
  node,
  depth,
  selectedFile,
  selectedFiles,
  viewedFiles,
  commentCounts,
  pendingCommentCounts,
  onSelectFile,
  onToggleFileSelection,
  onToggleViewed,
  onToggleViewedMultiple,
  onMarkFolderViewed,
  onCopyDiff,
  onCopyFile,
  onCopyMainVersion,
  expandedFolders,
  toggleFolder,
}: {
  node: TreeNode;
  depth: number;
  selectedFile: string | null;
  selectedFiles: Set<string>;
  viewedFiles: Set<string>;
  commentCounts: Record<string, number>;
  pendingCommentCounts: Record<string, number>;
  onSelectFile: (filename: string) => void;
  onToggleFileSelection: (filename: string, isShiftClick: boolean) => void;
  onToggleViewed: (filename: string) => void;
  onToggleViewedMultiple: (filenames: string[]) => void;
  onMarkFolderViewed: (folderPath: string, filenames: string[], markAsViewed: boolean) => void;
  onCopyDiff: (filename: string) => void;
  onCopyFile: (filename: string) => void;
  onCopyMainVersion: (filename: string) => void;
  expandedFolders: Set<string>;
  toggleFolder: (path: string) => void;
}) {
  const isExpanded = expandedFolders.has(node.path);
  const isSelected = node.type === "file" && selectedFile === node.path;
  const isMultiSelected = node.type === "file" && selectedFiles.has(node.path);
  const isViewed = node.type === "file" && viewedFiles.has(node.path);
  const commentCount =
    node.type === "file" ? commentCounts[node.path] || 0 : 0;
  const pendingCount =
    node.type === "file" ? pendingCommentCounts[node.path] || 0 : 0;

  const buttonRef = useRef<HTMLButtonElement>(null);

  // Scroll selected file into view (instant to avoid janky animation)
  useEffect(() => {
    if (isSelected && buttonRef.current) {
      buttonRef.current.scrollIntoView({ block: "nearest", behavior: "auto" });
    }
  }, [isSelected]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (node.type === "file") {
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          // Shift/Cmd/Ctrl-click adds to selection
          e.preventDefault();
          onToggleFileSelection(node.path, e.shiftKey);
        } else {
          onSelectFile(node.path);
        }
      } else {
        toggleFolder(node.path);
      }
    },
    [node.type, node.path, onSelectFile, onToggleFileSelection, toggleFolder]
  );

  // For context menu on multi-selected files
  const handleToggleViewedSelected = useCallback(() => {
    if (selectedFiles.size > 0) {
      onToggleViewedMultiple([...selectedFiles]);
    } else {
      onToggleViewed(node.path);
    }
  }, [selectedFiles, onToggleViewedMultiple, onToggleViewed, node.path]);

  if (node.type === "folder") {
    // Calculate folder stats
    const filesInFolder = collectFilesInFolder(node);
    const viewedCount = filesInFolder.filter(f => viewedFiles.has(f)).length;
    const allViewed = viewedCount === filesInFolder.length;

    const handleFolderViewedToggle = () => {
      onMarkFolderViewed(node.path, filesInFolder, !allViewed);
    };

    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div>
            <button
              onClick={handleClick}
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
              <span className="truncate flex-1">{node.name}</span>
              {allViewed && (
                <Check className="w-3 h-3 text-green-500 shrink-0" />
              )}
            </button>
            {isExpanded && node.children && (
              <div>
                {node.children.map((child) => (
                  <TreeNodeComponent
                    key={child.path}
                    node={child}
                    depth={depth + 1}
                    selectedFile={selectedFile}
                    selectedFiles={selectedFiles}
                    viewedFiles={viewedFiles}
                    commentCounts={commentCounts}
                    pendingCommentCounts={pendingCommentCounts}
                    onSelectFile={onSelectFile}
                    onToggleFileSelection={onToggleFileSelection}
                    onToggleViewed={onToggleViewed}
                    onToggleViewedMultiple={onToggleViewedMultiple}
                    onMarkFolderViewed={onMarkFolderViewed}
                    onCopyDiff={onCopyDiff}
                    onCopyFile={onCopyFile}
                    onCopyMainVersion={onCopyMainVersion}
                    expandedFolders={expandedFolders}
                    toggleFolder={toggleFolder}
                  />
                ))}
              </div>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={handleFolderViewedToggle}>
            {allViewed ? (
              <>
                <EyeOff className="w-4 h-4 mr-2" />
                Mark all as unviewed ({filesInFolder.length} files)
              </>
            ) : (
              <>
                <FolderCheck className="w-4 h-4 mr-2" />
                Mark all as viewed ({filesInFolder.length} files)
              </>
            )}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  // Check if this file is part of a multi-selection for context menu
  const showMultiSelectMenu = selectedFiles.size > 1 && selectedFiles.has(node.path);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          ref={buttonRef}
          onClick={handleClick}
          className={cn(
            "w-full flex items-center gap-2 px-2 py-1.5 text-sm transition-colors",
            "text-left hover:bg-muted/50",
            isSelected && "bg-muted",
            isMultiSelected && !isSelected && "bg-blue-500/20",
            isViewed && !isMultiSelected && "opacity-60"
          )}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {node.file && getFileIcon(node.file)}
          <span className="truncate flex-1">{node.name}</span>
          <div className="flex items-center gap-1 shrink-0">
            {pendingCount > 0 && (
              <span className="flex items-center gap-0.5 text-xs text-yellow-500 bg-yellow-500/20 px-1.5 py-0.5 rounded">
                {pendingCount}
              </span>
            )}
            {commentCount > 0 && (
              <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                <MessageSquare className="w-3 h-3" />
                {commentCount}
              </span>
            )}
            {isViewed && <Check className="w-3 h-3 text-green-500" />}
          </div>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {showMultiSelectMenu ? (
          // Multi-select context menu
          <>
            <ContextMenuItem onClick={handleToggleViewedSelected}>
              <Eye className="w-4 h-4 mr-2" />
              Toggle viewed ({selectedFiles.size} files)
            </ContextMenuItem>
          </>
        ) : (
          // Single file context menu
          <>
            <ContextMenuItem onClick={() => onToggleViewed(node.path)}>
              {isViewed ? (
                <>
                  <EyeOff className="w-4 h-4 mr-2" />
                  Mark as unviewed
                </>
              ) : (
                <>
                  <Eye className="w-4 h-4 mr-2" />
                  Mark as viewed
                </>
              )}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => onCopyDiff(node.path)}>
              <Copy className="w-4 h-4 mr-2" />
              Copy diff
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onCopyFile(node.path)}>
              <FileCode className="w-4 h-4 mr-2" />
              Copy file (PR version)
            </ContextMenuItem>
            {node.file?.status !== "added" && (
              <ContextMenuItem onClick={() => onCopyMainVersion(node.path)}>
                <GitBranch className="w-4 h-4 mr-2" />
                Copy file (base version)
              </ContextMenuItem>
            )}
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function FileTree({
  files,
  selectedFile,
  selectedFiles,
  viewedFiles,
  hideViewed,
  commentCounts,
  pendingCommentCounts = {},
  onSelectFile,
  onToggleFileSelection,
  onToggleViewed,
  onToggleViewedMultiple,
  onMarkFolderViewed,
  onCopyDiff,
  onCopyFile,
  onCopyMainVersion,
}: FileTreeProps) {
  const tree = useMemo(() => buildTree(files), [files]);
  const filteredTree = useMemo(
    () => (hideViewed ? filterTree(tree, viewedFiles) : tree),
    [tree, hideViewed, viewedFiles]
  );

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
    <nav className="flex-1 overflow-auto py-2 themed-scrollbar">
      {filteredTree.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          {hideViewed ? "All files reviewed!" : "No files"}
        </div>
      ) : (
        filteredTree.map((node) => (
          <TreeNodeComponent
            key={node.path}
            node={node}
            depth={0}
            selectedFile={selectedFile}
            selectedFiles={selectedFiles}
            viewedFiles={viewedFiles}
            commentCounts={commentCounts}
            pendingCommentCounts={pendingCommentCounts}
            onSelectFile={onSelectFile}
            onToggleFileSelection={onToggleFileSelection}
            onToggleViewed={onToggleViewed}
            onToggleViewedMultiple={onToggleViewedMultiple}
            onMarkFolderViewed={onMarkFolderViewed}
            onCopyDiff={onCopyDiff}
            onCopyFile={onCopyFile}
            onCopyMainVersion={onCopyMainVersion}
            expandedFolders={expandedFolders}
            toggleFolder={toggleFolder}
          />
        ))
      )}
    </nav>
  );
}
