import { parseHeadingCandidates } from "./headings";

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

export function prepareMemoryDocument(
  text: string | undefined,
  anchorPrefix: string
): PreparedMemoryDocument {
  const markdown = text ? promoteMemoryHeadings(text) : "";
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
