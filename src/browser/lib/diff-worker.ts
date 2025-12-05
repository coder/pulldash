/**
 * Diff Worker - Handles CPU-intensive diff parsing and syntax highlighting
 *
 * This worker processes diffs off the main thread to maintain UI responsiveness.
 */

import gitDiffParser, {
  Hunk as _Hunk,
  Change as _Change,
  DeleteChange,
  InsertChange,
} from "gitdiff-parser";
import { diffChars, diffWords } from "diff";
import { refractor } from "refractor/all";

// ============================================================================
// Types
// ============================================================================

export interface LineSegment {
  value: string;
  html: string;
  type: "insert" | "delete" | "normal";
}

interface RawLineSegment {
  value: string;
  type: "insert" | "delete" | "normal";
}

export interface DiffLine {
  type: "insert" | "delete" | "normal";
  lineNumber?: number;
  oldLineNumber?: number;
  newLineNumber?: number;
  content: LineSegment[];
}

export interface DiffHunk {
  type: "hunk";
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export interface DiffSkipBlock {
  type: "skip";
  count: number;
  content: string;
}

export interface ParsedDiff {
  hunks: (DiffHunk | DiffSkipBlock)[];
}

interface ParseOptions {
  maxDiffDistance: number;
  maxChangeRatio: number;
  mergeModifiedLines: boolean;
  inlineMaxCharEdits: number;
}

type ReplaceKey<T, K extends PropertyKey, V> = T extends unknown
  ? Omit<T, K> & Record<K, V>
  : never;

type Line = ReplaceKey<_Change, "content", RawLineSegment[]>;

interface Hunk extends Omit<_Hunk, "changes"> {
  type: "hunk";
  lines: Line[];
}

interface SkipBlock {
  count: number;
  type: "skip";
  content: string;
}

// ============================================================================
// Message Types
// ============================================================================

export type WorkerRequest =
  | {
      type: "parse-diff";
      id: string;
      patch: string;
      filename: string;
      previousFilename?: string;
      /** Full content of the old (base) version of the file for proper highlighting */
      oldContent?: string;
      /** Full content of the new (head) version of the file for proper highlighting */
      newContent?: string;
    }
  | {
      type: "highlight-lines";
      id: string;
      content: string;
      filename: string;
      startLine: number;
      count: number;
    };

export type WorkerResponse =
  | {
      type: "parse-diff-result";
      id: string;
      result: ParsedDiff;
    }
  | {
      type: "highlight-lines-result";
      id: string;
      result: DiffLine[];
    }
  | {
      type: "error";
      id: string;
      error: string;
    };

// ============================================================================
// Language Detection
// ============================================================================

const extToLang: Record<string, string> = {
  js: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  mjs: "javascript",
  cjs: "javascript",
  html: "markup",
  htm: "markup",
  xml: "markup",
  svg: "markup",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  py: "python",
  pyw: "python",
  pyi: "python",
  java: "java",
  kt: "kotlin",
  scala: "scala",
  groovy: "groovy",
  c: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  h: "cpp",
  hpp: "cpp",
  cs: "csharp",
  vb: "vbnet",
  fs: "fsharp",
  rs: "rust",
  go: "go",
  rb: "ruby",
  rake: "ruby",
  php: "php",
  phtml: "php",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  json: "json",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  ini: "ini",
  md: "markdown",
  markdown: "markdown",
  tex: "latex",
  swift: "swift",
  m: "objectivec",
  mm: "objectivec",
  sql: "sql",
  r: "r",
  lua: "lua",
  perl: "perl",
  pl: "perl",
  dart: "dart",
  elm: "elm",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  clj: "clojure",
  cljs: "clojure",
  lisp: "lisp",
  hs: "haskell",
  ml: "ocaml",
  graphql: "graphql",
  proto: "protobuf",
  vim: "vim",
  zig: "zig",
};

function guessLang(filename?: string): string {
  const ext = filename?.split(".").pop()?.toLowerCase() ?? "";
  return extToLang[ext] ?? "tsx";
}

// ============================================================================
// Syntax Highlighting
// ============================================================================

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function hastToHtml(node: any): string {
  if (node.type === "text") {
    return escapeHtml(node.value);
  }
  if (node.type === "element") {
    const { tagName, properties, children } = node;
    const className = (properties.className as string[] | undefined)?.join(" ");
    const attrs = className ? ` class="${className}"` : "";
    const inner = children.map(hastToHtml).join("");
    return `<${tagName}${attrs}>${inner}</${tagName}>`;
  }
  return "";
}

function highlight(code: string, lang: string): string {
  try {
    const tree = refractor.highlight(code, lang);
    return tree.children.map(hastToHtml).join("");
  } catch {
    return escapeHtml(code);
  }
}

/**
 * Highlight an entire file and return an array of HTML strings, one per line.
 * This handles multi-line constructs (strings, comments) correctly by
 * closing and reopening tags at line boundaries.
 */
interface OpenTag {
  tagName: string;
  className?: string;
}

function highlightFileByLines(content: string, lang: string): string[] {
  if (!content) return [];

  try {
    const tree = refractor.highlight(content, lang);
    const lines: string[] = [];
    let currentLine: string[] = [];
    const openTags: OpenTag[] = [];

    function closeAllTags(): string {
      return [...openTags]
        .reverse()
        .map((t) => `</${t.tagName}>`)
        .join("");
    }

    function openAllTags(): string {
      return openTags
        .map((t) => {
          const cls = t.className ? ` class="${t.className}"` : "";
          return `<${t.tagName}${cls}>`;
        })
        .join("");
    }

    function processText(text: string) {
      const parts = text.split("\n");
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) {
          // End current line with closing tags
          currentLine.push(closeAllTags());
          lines.push(currentLine.join(""));
          // Start new line with opening tags
          currentLine = [openAllTags()];
        }
        if (parts[i]) {
          currentLine.push(escapeHtml(parts[i]));
        }
      }
    }

    function walkNode(node: any) {
      if (node.type === "text") {
        processText(node.value);
      } else if (node.type === "element") {
        const { tagName, properties, children } = node;
        const className = (properties?.className as string[] | undefined)?.join(
          " "
        );
        const tag: OpenTag = { tagName, className };

        // Open tag
        const cls = className ? ` class="${className}"` : "";
        currentLine.push(`<${tagName}${cls}>`);
        openTags.push(tag);

        // Process children
        children.forEach(walkNode);

        // Close tag
        openTags.pop();
        currentLine.push(`</${tagName}>`);
      }
    }

    tree.children.forEach(walkNode);

    // Don't forget the last line
    if (currentLine.length > 0) {
      lines.push(currentLine.join(""));
    }

    return lines;
  } catch {
    // Fallback: escape each line
    return content.split("\n").map(escapeHtml);
  }
}

// ============================================================================
// Diff Parsing
// ============================================================================

const calculateChangeRatio = (a: string, b: string): number => {
  const totalChars = a.length + b.length;
  if (totalChars === 0) return 1;
  const tokens = diffWords(a, b);
  const changedChars = tokens
    .filter((token) => token.added || token.removed)
    .reduce((sum, token) => sum + token.value.length, 0);
  return changedChars / totalChars;
};

const changeToLine = (change: _Change): Line => ({
  ...change,
  content: [{ value: change.content, type: "normal" }],
});

function diffCharsIfWithinEditLimit(a: string, b: string, maxEdits = 4) {
  const diffs = diffChars(a, b);
  let edits = 0;
  for (const part of diffs) {
    if (part.added || part.removed) {
      edits += part.value.length;
      if (edits > maxEdits) return { exceededLimit: true };
    }
  }
  return {
    exceededLimit: false,
    diffs: diffs.map((d) => ({
      value: d.value,
      type: d.added ? "insert" : d.removed ? "delete" : "normal",
    })) as RawLineSegment[],
  };
}

const buildInlineDiffSegments = (
  current: _Change,
  next: _Change,
  options: ParseOptions
): RawLineSegment[] => {
  const segments: RawLineSegment[] = diffWords(
    current.content,
    next.content
  ).map((token) => ({
    value: token.value,
    type: token.added ? "insert" : token.removed ? "delete" : "normal",
  }));

  const result: RawLineSegment[] = [];
  const mergeIntoResult = (segment: RawLineSegment) => {
    const last = result[result.length - 1];
    if (last && last.type === segment.type) {
      last.value += segment.value;
    } else {
      result.push(segment);
    }
  };

  for (let i = 0; i < segments.length; i++) {
    const current = segments[i];
    const next = segments[i + 1];
    if (current.type === "delete" && next?.type === "insert") {
      const charDiff = diffCharsIfWithinEditLimit(
        current.value,
        next.value,
        options.inlineMaxCharEdits
      );
      if (!charDiff.exceededLimit) {
        charDiff.diffs!.forEach(mergeIntoResult);
        i++;
      } else {
        result.push(current);
      }
    } else {
      mergeIntoResult(current);
    }
  }

  return result;
};

const UNPAIRED = -1;

function buildChangeIndices(changes: _Change[]) {
  const insertIdxs: number[] = [];
  const deleteIdxs: number[] = [];
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    if (c.type === "insert") insertIdxs.push(i);
    else if (c.type === "delete") deleteIdxs.push(i);
  }
  return { insertIdxs, deleteIdxs };
}

function findBestInsertForDelete(
  changes: _Change[],
  delIdx: number,
  insertIdxs: number[],
  pairOfAdd: Int32Array,
  options: ParseOptions
): number {
  const del = changes[delIdx] as DeleteChange;
  const lower = del.lineNumber - options.maxDiffDistance;
  const upper = del.lineNumber + options.maxDiffDistance;

  let bestAddIdx = UNPAIRED;
  let bestRatio = Infinity;

  for (const addIdx of insertIdxs) {
    const add = changes[addIdx] as InsertChange;
    if (pairOfAdd[addIdx] !== UNPAIRED) continue;
    if (add.lineNumber < lower) continue;
    if (add.lineNumber > upper) break;

    const ratio = calculateChangeRatio(del.content, add.content);
    if (ratio > options.maxChangeRatio) continue;
    if (ratio < bestRatio) {
      bestRatio = ratio;
      bestAddIdx = addIdx;
    }
  }

  return bestAddIdx;
}

function buildInitialPairs(
  changes: _Change[],
  insertIdxs: number[],
  deleteIdxs: number[],
  options: ParseOptions
) {
  const n = changes.length;
  const pairOfDel = new Int32Array(n).fill(UNPAIRED);
  const pairOfAdd = new Int32Array(n).fill(UNPAIRED);

  for (const di of deleteIdxs) {
    const bestAddIdx = findBestInsertForDelete(
      changes,
      di,
      insertIdxs,
      pairOfAdd,
      options
    );
    if (bestAddIdx !== UNPAIRED) {
      pairOfDel[di] = bestAddIdx;
      pairOfAdd[bestAddIdx] = di;
    }
  }

  return { pairOfDel, pairOfAdd };
}

function buildUnpairedDeletePrefix(changes: _Change[], pairOfDel: Int32Array) {
  const n = changes.length;
  const prefix = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) {
    const c = changes[i];
    const isInitiallyUnpairedDelete =
      c.type === "delete" && pairOfDel[i] === UNPAIRED;
    prefix[i + 1] = prefix[i] + (isInitiallyUnpairedDelete ? 1 : 0);
  }
  return prefix;
}

function hasUnpairedDeleteBetween(
  unpairedDelPrefix: Int32Array,
  deleteIdx: number,
  insertIdx: number
) {
  const lower = Math.max(0, deleteIdx);
  const upper = Math.max(lower, insertIdx);
  return unpairedDelPrefix[upper] - unpairedDelPrefix[lower] > 0;
}

function emitNormal(out: Line[], c: _Change) {
  out.push(changeToLine(c));
}

function emitModified(
  out: Line[],
  del: DeleteChange,
  add: InsertChange,
  options: ParseOptions
) {
  out.push({
    oldLineNumber: del.lineNumber,
    newLineNumber: add.lineNumber,
    type: "normal",
    isNormal: true,
    content: buildInlineDiffSegments(del, add, options),
  });
}

function emitLines(
  changes: _Change[],
  pairOfDel: Int32Array,
  pairOfAdd: Int32Array,
  unpairedDelPrefix: Int32Array,
  options: ParseOptions
): Line[] {
  const out: Line[] = [];
  const processed = new Uint8Array(changes.length);

  for (let i = 0; i < changes.length; i++) {
    if (processed[i]) continue;
    const c = changes[i];

    if (c.type === "normal") {
      processed[i] = 1;
      emitNormal(out, c);
    } else if (c.type === "delete") {
      const pairedAddIdx = pairOfDel[i];
      if (pairedAddIdx === UNPAIRED) {
        processed[i] = 1;
        emitNormal(out, c);
      } else if (pairedAddIdx > i) {
        const shouldUnpair = hasUnpairedDeleteBetween(
          unpairedDelPrefix,
          i + 1,
          pairedAddIdx
        );
        if (shouldUnpair) {
          pairOfAdd[pairedAddIdx] = UNPAIRED;
          processed[i] = 1;
          emitNormal(out, c);
        } else {
          processed[i] = 1;
        }
      } else {
        const add = changes[pairedAddIdx] as InsertChange;
        emitModified(out, c, add, options);
        processed[i] = 1;
        processed[pairedAddIdx] = 1;
      }
    } else {
      const pairedDelIdx = pairOfAdd[i];
      if (pairedDelIdx === UNPAIRED) {
        processed[i] = 1;
        emitNormal(out, c);
      } else {
        const del = changes[pairedDelIdx] as DeleteChange;
        emitModified(out, del, c, options);
        processed[i] = 1;
        processed[pairedDelIdx] = 1;
      }
    }
  }

  return out;
}

function mergeModifiedLines(changes: _Change[], options: ParseOptions): Line[] {
  const { insertIdxs, deleteIdxs } = buildChangeIndices(changes);
  const { pairOfDel, pairOfAdd } = buildInitialPairs(
    changes,
    insertIdxs,
    deleteIdxs,
    options
  );
  const unpairedDelPrefix = buildUnpairedDeletePrefix(changes, pairOfDel);
  return emitLines(changes, pairOfDel, pairOfAdd, unpairedDelPrefix, options);
}

const parseHunk = (hunk: _Hunk, options: ParseOptions): Hunk => {
  return {
    ...hunk,
    type: "hunk",
    lines: options.mergeModifiedLines
      ? mergeModifiedLines(hunk.changes, options)
      : hunk.changes.map(changeToLine),
  };
};

const HUNK_HEADER_REGEX = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/;

const extractHunkContext = (header: string): string =>
  HUNK_HEADER_REGEX.exec(header)?.[5]?.trim() ?? "";

const insertSkipBlocks = (hunks: Hunk[]): (Hunk | SkipBlock)[] => {
  const result: (Hunk | SkipBlock)[] = [];
  let lastHunkLine = 1;

  for (const hunk of hunks) {
    const distanceToLastHunk = hunk.oldStart - lastHunkLine;
    const context = extractHunkContext(hunk.content);
    if (distanceToLastHunk > 0) {
      result.push({
        count: distanceToLastHunk,
        type: "skip",
        content: context ?? hunk.content,
      });
    }
    lastHunkLine = Math.max(hunk.oldStart + hunk.oldLines, lastHunkLine);
    result.push(hunk);
  }

  return result;
};

const defaultOptions: ParseOptions = {
  maxDiffDistance: 30,
  maxChangeRatio: 0.45,
  mergeModifiedLines: true,
  inlineMaxCharEdits: 4,
};

// ============================================================================
// Main Functions
// ============================================================================

function parseDiffWithHighlighting(
  patch: string,
  filename: string,
  previousFilename?: string,
  oldContent?: string,
  newContent?: string
): ParsedDiff {
  const diffHeader = `diff --git a/${filename} b/${filename}
--- a/${previousFilename || filename}
+++ b/${filename}
${patch}`;

  const opts = defaultOptions;
  const files = gitDiffParser.parse(diffHeader);
  const file = files[0];

  if (!file) {
    return { hunks: [] };
  }

  const language = guessLang(filename);
  const prevLanguage = previousFilename
    ? guessLang(previousFilename)
    : language;

  // Pre-highlight full files if content is provided
  // This ensures proper highlighting for multi-line constructs (strings, comments, etc.)
  const oldHighlightedLines = oldContent
    ? highlightFileByLines(oldContent, prevLanguage)
    : null;
  const newHighlightedLines = newContent
    ? highlightFileByLines(newContent, language)
    : null;

  const rawHunks = insertSkipBlocks(
    file.hunks.map((hunk) => parseHunk(hunk, opts))
  );

  const hunks: (DiffHunk | DiffSkipBlock)[] = rawHunks.map((hunk) => {
    if (hunk.type === "skip") {
      return hunk as DiffSkipBlock;
    }

    return {
      type: "hunk" as const,
      oldStart: hunk.oldStart,
      newStart: hunk.newStart,
      lines: hunk.lines.map((line): DiffLine => {
        const isNormal = line.type === "normal";
        const oldNum = isNormal
          ? (line as any).oldLineNumber
          : line.type === "delete"
            ? (line as any).lineNumber
            : undefined;
        const newNum = isNormal
          ? (line as any).newLineNumber
          : line.type === "insert"
            ? (line as any).lineNumber
            : undefined;

        // For lines with a single segment (no inline diff), use pre-highlighted content
        // For lines with multiple segments (inline diff), highlight each segment
        const hasSingleSegment = line.content.length === 1;
        const singleSegmentIsNormal =
          hasSingleSegment && line.content[0].type === "normal";

        return {
          type: line.type,
          oldLineNumber: oldNum,
          newLineNumber: newNum,
          content: line.content.map((seg) => {
            let html: string;

            // Try to use pre-highlighted content for better context
            if (singleSegmentIsNormal) {
              // Use pre-highlighted line if available
              if (
                line.type === "delete" &&
                oldHighlightedLines &&
                oldNum !== undefined
              ) {
                html =
                  oldHighlightedLines[oldNum - 1] ??
                  highlight(seg.value, prevLanguage);
              } else if (
                line.type === "insert" &&
                newHighlightedLines &&
                newNum !== undefined
              ) {
                html =
                  newHighlightedLines[newNum - 1] ??
                  highlight(seg.value, language);
              } else if (
                line.type === "normal" &&
                newHighlightedLines &&
                newNum !== undefined
              ) {
                // For normal lines, prefer new file highlighting (same content in both)
                html =
                  newHighlightedLines[newNum - 1] ??
                  highlight(seg.value, language);
              } else {
                html = highlight(seg.value, language);
              }
            } else {
              // Multiple segments (inline diff) - highlight each segment individually
              // This is acceptable since inline diffs are usually small
              const segLang = seg.type === "delete" ? prevLanguage : language;
              html = highlight(seg.value, segLang);
            }

            return {
              value: seg.value,
              html,
              type: seg.type,
            };
          }),
        };
      }),
    };
  });

  return { hunks };
}

function highlightFileLines(
  content: string,
  filename: string,
  startLine: number,
  count: number
): DiffLine[] {
  const language = guessLang(filename);
  const allLines = content.split("\n");

  // Pre-highlight the entire file for proper context
  const highlightedLines = highlightFileByLines(content, language);

  const result: DiffLine[] = [];

  for (let i = 0; i < count; i++) {
    const lineNum = startLine + i;
    const lineContent = allLines[lineNum - 1] ?? "";
    // Use pre-highlighted HTML, fallback to individual highlighting
    const highlighted =
      highlightedLines[lineNum - 1] ?? highlight(lineContent, language);

    result.push({
      type: "normal",
      oldLineNumber: lineNum,
      newLineNumber: lineNum,
      content: [{ value: lineContent, html: highlighted, type: "normal" }],
    });
  }

  return result;
}

// ============================================================================
// Worker Message Handler
// ============================================================================

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  try {
    switch (request.type) {
      case "parse-diff": {
        const result = parseDiffWithHighlighting(
          request.patch,
          request.filename,
          request.previousFilename,
          request.oldContent,
          request.newContent
        );
        self.postMessage({
          type: "parse-diff-result",
          id: request.id,
          result,
        } as WorkerResponse);
        break;
      }

      case "highlight-lines": {
        const result = highlightFileLines(
          request.content,
          request.filename,
          request.startLine,
          request.count
        );
        self.postMessage({
          type: "highlight-lines-result",
          id: request.id,
          result,
        } as WorkerResponse);
        break;
      }
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      id: request.id,
      error: error instanceof Error ? error.message : "Unknown error",
    } as WorkerResponse);
  }
};
