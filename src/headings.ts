export interface ParsedHeading {
  lineIndex: number;
  level: number;
  text: string;
  source: "formal" | "structured" | "bold";
}

interface Fence {
  marker: "`" | "~";
  length: number;
}

function cleanHeading(text: string) {
  return text
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .trim();
}

function boldOnlyHeading(line: string) {
  if (/^(?: {4}|\t)/.test(line)) return undefined;
  const match = /^ {0,3}(?:\*\*(.+?)\*\*|__(.+?)__)\s*$/.exec(line);
  if (!match) return undefined;
  const text = cleanHeading(match[1] || match[2]);
  if (
    text.length < 2 ||
    text.length > 80 ||
    /[。！？.!?；;]$/.test(text)
  ) {
    return undefined;
  }
  return text;
}

function structuredHeading(line: string) {
  if (/^(?: {4}|\t| {0,3}>)/.test(line)) return undefined;
  const text = cleanHeading(line);
  if (
    text.length < 2 ||
    text.length > 80 ||
    /[。！？.!?；;]$/.test(text)
  ) {
    return undefined;
  }
  const hasSectionPrefix =
    /^(?:第[一二三四五六七八九十百\d]+[章节部分篇]|[一二三四五六七八九十\d]+、)\s*\S+/.test(
      text
    );
  const hasNumberedLabel =
    /^(?:阶段|步骤|提交|任务|方案|部分)\s*[一二三四五六七八九十\d]+\s*(?:[:：—–-])\s*\S+/.test(
      text
    );
  return hasSectionPrefix || hasNumberedLabel ? text : undefined;
}

export function parseHeadingCandidates(text: string): ParsedHeading[] {
  const lines = text.split(/\r?\n/);
  const formalHeadings: ParsedHeading[] = [];
  const structuredHeadings: ParsedHeading[] = [];
  const boldCandidates: ParsedHeading[] = [];
  let fence: Fence | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0] as Fence["marker"];
      const markerLength = fenceMatch[1].length;
      if (!fence) {
        fence = { marker, length: markerLength };
      } else if (
        fence.marker === marker &&
        markerLength >= fence.length &&
        !fenceMatch[2].trim()
      ) {
        fence = undefined;
      }
      continue;
    }
    if (fence) continue;
    if (/^(?: {4}|\t| {0,3}>)/.test(line)) continue;

    const atx =
      /^ {0,3}(#{1,6})(?:[ \t]+|$)(.*?)(?:[ \t]+#+[ \t]*)?$/.exec(line);
    if (atx) {
      formalHeadings.push({
        lineIndex: index,
        level: atx[1].length,
        text: cleanHeading(atx[2]),
        source: "formal"
      });
      continue;
    }

    const underline = /^ {0,3}(=+|-+)[ \t]*$/.exec(lines[index + 1] || "");
    if (line.trim() && underline) {
      formalHeadings.push({
        lineIndex: index,
        level: underline[1][0] === "=" ? 1 : 2,
        text: cleanHeading(line),
        source: "formal"
      });
      continue;
    }

    const bold = boldOnlyHeading(line);
    if (bold) {
      const target = structuredHeading(bold)
        ? structuredHeadings
        : boldCandidates;
      target.push({
        lineIndex: index,
        level: 2,
        text: bold,
        source: target === structuredHeadings ? "structured" : "bold"
      });
      continue;
    }

    const structured = structuredHeading(line);
    if (structured) {
      structuredHeadings.push({
        lineIndex: index,
        level: 2,
        text: structured,
        source: "structured"
      });
    }
  }

  return [
    ...formalHeadings,
    ...structuredHeadings,
    ...boldCandidates
  ]
    .filter((heading) => heading.text)
    .sort((left, right) => left.lineIndex - right.lineIndex);
}

export function parseHeadingLines(text: string): ParsedHeading[] {
  const candidates = parseHeadingCandidates(text);
  const formal = candidates.filter((heading) => heading.source === "formal");
  if (formal.length) return formal;
  const structured = candidates.filter(
    (heading) => heading.source === "structured"
  );
  if (structured.length) return structured;
  const bold = candidates.filter((heading) => heading.source === "bold");
  return bold.length >= 2 ? bold : [];
}

export function addHeadingAnchors(text: string, prefix: string) {
  const lines = text.split(/\r?\n/);
  const headings = new Map(
    parseHeadingCandidates(text).map((heading, index) => [
      heading.lineIndex,
      `${prefix}-${index}`
    ])
  );

  return lines
    .map((line, index) => {
      const id = headings.get(index);
      return id
        ? `<span id="${id}" class="heading-anchor"></span>\n${line}`
        : line;
    })
    .join("\n");
}
