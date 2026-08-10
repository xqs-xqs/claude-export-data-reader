import { parseHeadingCandidates } from "./headings";
import type { MemoryFile } from "./types";

export type MemoryScope = "account" | "project";

export interface MemoryHeading {
  id: string;
  level: number;
  text: string;
}

export interface PreparedMemoryDocument {
  anchorPrefix: string;
  headings: MemoryHeading[];
  markdown: string;
}

export interface MemoryProjectOption {
  name: string;
  uuid: string;
}

export type StructuredMemoryGroupKey =
  | "you"
  | "topics"
  | "areas"
  | "people"
  | "other";

export interface StructuredMemoryEntry {
  path: string;
  title: string;
  description: string;
  details: string;
  updatedAt?: string;
  group: StructuredMemoryGroupKey;
}

export interface StructuredMemoryGroup {
  key: StructuredMemoryGroupKey;
  label: string;
  entries: StructuredMemoryEntry[];
}

export interface PreparedStructuredMemory {
  entries: StructuredMemoryEntry[];
  groups: StructuredMemoryGroup[];
}

interface Fence {
  length: number;
  marker: "`" | "~";
}

function promoteMemoryHeadings(text: string) {
  let fence: Fence | undefined;
  return text
    .split(/\r?\n/)
    .map((line) => {
      const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (fenceMatch) {
        const marker = fenceMatch[1][0] as Fence["marker"];
        const length = fenceMatch[1].length;
        if (!fence) {
          fence = { marker, length };
        } else if (
          fence.marker === marker &&
          length >= fence.length &&
          !fenceMatch[2].trim()
        ) {
          fence = undefined;
        }
        return line;
      }
      if (fence || /^(?: {4}|\t| {0,3}>)/.test(line)) return line;

      const bold =
        /^ {0,3}(?:\*\*(.+?)\*\*|__(.+?)__)\s*$/.exec(line);
      if (bold) {
        const title = (bold[1] || bold[2]).trim();
        return title ? `## ${title}` : line;
      }

      const italic = /^ {0,3}(?:\*([^*]+)\*|_([^_]+)_)\s*$/.exec(line);
      if (italic) {
        const title = (italic[1] || italic[2]).trim();
        return title ? `### ${title}` : line;
      }
      return line;
    })
    .join("\n");
}

function splitMemoryFile(file: MemoryFile) {
  const content = file.content.trim();
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(
    content
  );
  const metadata = new Map<string, string>();

  for (const line of (frontmatter?.[1] || "").split(/\r?\n/)) {
    const field = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!field) continue;
    const value = field[2].trim();
    metadata.set(
      field[1],
      /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value
    );
  }

  return {
    body: (frontmatter?.[2] || content).trim(),
    description: metadata.get("description") || "",
    name: metadata.get("name") || ""
  };
}

function humanizeMemoryName(value: string) {
  return value
    .replace(/\.md$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function memoryGroup(path: string): StructuredMemoryGroupKey {
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  if (normalized === "/profile.md" || normalized.endsWith("/profile.md")) {
    return "you";
  }
  if (normalized.includes("/topics/")) return "topics";
  if (normalized.includes("/areas/")) return "areas";
  if (normalized.includes("/people/")) return "people";
  return "other";
}

function cleanMemoryDetails(body: string) {
  return body
    .split(/\r?\n/)
    .map((line) =>
      line.replace(
        /^(\s*(?:[-+*]|\d+[.)])\s+)\[(?:stated|inferred|derived|observed)\]\s*/i,
        "$1"
      )
    )
    .join("\n")
    .trim();
}

export function prepareStructuredMemoryFiles(
  files: MemoryFile[] | undefined
): PreparedStructuredMemory {
  const entries = (files || [])
    .filter((file) => file.content.trim())
    .map((file) => {
      const parsed = splitMemoryFile(file);
      const fallbackName = file.path.split(/[\\/]/).filter(Boolean).at(-1) || file.path;
      return {
        path: file.path,
        title: humanizeMemoryName(parsed.name || fallbackName),
        description: parsed.description,
        details: cleanMemoryDetails(parsed.body),
        updatedAt: file.updated_at,
        group: memoryGroup(file.path)
      } satisfies StructuredMemoryEntry;
    });
  const definitions: Array<[StructuredMemoryGroupKey, string]> = [
    ["you", "You"],
    ["topics", "Topics"],
    ["areas", "Areas"],
    ["people", "People"],
    ["other", "Other"]
  ];
  const groups = definitions
    .map(([key, label]) => ({
      key,
      label,
      entries: entries.filter((entry) => entry.group === key)
    }))
    .filter((group) => group.entries.length > 0);

  return { entries, groups };
}

export function prepareMemoryDocument(
  text: string | undefined,
  anchorPrefix: string
): PreparedMemoryDocument {
  const source = text?.trim() || "";
  const markdown = source ? promoteMemoryHeadings(source) : "";
  const candidates = parseHeadingCandidates(markdown);
  const headings = candidates
    .map((heading, index) => ({ heading, index }))
    .filter(({ heading }) => heading.source === "formal")
    .map(({ heading, index }) => ({
      id: `${anchorPrefix}-${index}`,
      level: heading.level,
      text: heading.text
    }));
  return {
    anchorPrefix,
    headings,
    markdown
  };
}
