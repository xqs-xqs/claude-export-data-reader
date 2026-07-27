import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent
} from "react";
import DOMPurify from "dompurify";
import { Marked, Renderer } from "marked";
import type { Citation } from "./types";
import { addHeadingAnchors } from "./headings";
import { highlightCode } from "./codeHighlight";
import { protectMathInMarkdown, renderMathPlaceholders } from "./math";
import { normalizeSearchText } from "./search";

interface Props {
  text: string;
  anchorPrefix: string;
  searchQuery?: string;
  citations?: Citation[];
}

interface PreparedCitation {
  index: number;
  token?: string;
  url: string;
}

const CITATION_TOKEN_PREFIX = "\uE110claude-citation-";
const CITATION_TOKEN_SUFFIX = "\uE111";

function safeExternalUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function prepareCitationMarkdown(text: string, citations: Citation[] = []) {
  const sources: PreparedCitation[] = [];
  const insertions: Array<{ index: number; token: string }> = [];

  citations.forEach((citation, index) => {
    const url = safeExternalUrl(citation.details?.url);
    if (!url) return;

    const end = citation.end_index;
    const start = citation.start_index;
    const validPosition =
      Number.isInteger(end) &&
      (end as number) >= 0 &&
      (end as number) <= text.length &&
      (start === undefined ||
        (Number.isInteger(start) &&
          start >= 0 &&
          start <= (end as number)));
    const token = validPosition
      ? `${CITATION_TOKEN_PREFIX}${index}${CITATION_TOKEN_SUFFIX}`
      : undefined;
    sources.push({ index, token, url });
    if (token) insertions.push({ index: end as number, token });
  });

  let markdown = text;
  insertions
    .sort(
      (left, right) =>
        right.index - left.index || right.token.localeCompare(left.token)
    )
    .forEach(({ index, token }) => {
      markdown = `${markdown.slice(0, index)}${token}${markdown.slice(index)}`;
    });

  return { markdown, sources };
}

function citationElement(source: PreparedCitation, open: boolean) {
  const anchor = document.createElement("span");
  anchor.className = `citation-anchor ${open ? "is-open" : ""}`;

  const marker = document.createElement("span");
  marker.className = "citation-marker";
  marker.dataset.citationMarker = String(source.index);
  marker.setAttribute("role", "button");
  marker.setAttribute("tabindex", "0");
  marker.setAttribute("aria-label", `查看来源 ${source.index + 1}`);
  marker.setAttribute("aria-expanded", String(open));
  marker.textContent = String(source.index + 1);

  const popover = document.createElement("span");
  popover.className = "citation-popover";
  popover.setAttribute("role", "tooltip");

  const url = document.createElement("span");
  url.className = "citation-url";
  url.dataset.citationUrl = source.url;
  url.setAttribute("role", "link");
  url.setAttribute("tabindex", "0");
  url.setAttribute("title", source.url);
  url.textContent = source.url;

  popover.append(url);
  anchor.append(marker, popover);
  return anchor;
}

function addCitationElements(
  html: string,
  sources: PreparedCitation[],
  activeCitation: number | undefined
) {
  if (!sources.length) return html;

  const template = document.createElement("template");
  template.innerHTML = html;
  const sourcesByIndex = new Map(
    sources.map((source) => [source.index, source])
  );
  const resolved = new Set<number>();
  const walker = document.createTreeWalker(
    template.content,
    NodeFilter.SHOW_TEXT
  );
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
  const tokenPattern = new RegExp(
    `${CITATION_TOKEN_PREFIX}(\\d+)${CITATION_TOKEN_SUFFIX}`,
    "g"
  );

  for (const node of textNodes) {
    tokenPattern.lastIndex = 0;
    if (!tokenPattern.test(node.data)) continue;
    tokenPattern.lastIndex = 0;

    const fragment = document.createDocumentFragment();
    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = tokenPattern.exec(node.data))) {
      if (match.index > cursor) {
        fragment.append(node.data.slice(cursor, match.index));
      }
      const index = Number(match[1]);
      const source = sourcesByIndex.get(index);
      if (source) {
        resolved.add(index);
        fragment.append(citationElement(source, activeCitation === index));
      }
      cursor = match.index + match[0].length;
    }
    if (cursor < node.data.length) fragment.append(node.data.slice(cursor));
    node.replaceWith(fragment);
  }

  const unresolved = sources.filter((source) => !resolved.has(source.index));
  if (unresolved.length) {
    const fallback = document.createElement("span");
    fallback.className = "citation-fallback";
    unresolved.forEach((source) => {
      fallback.append(
        citationElement(source, activeCitation === source.index)
      );
    });
    template.content.append(fallback);
  }

  return template.innerHTML;
}

interface SearchHighlightRange {
  end: number;
  head: boolean;
  matchId: string;
  start: number;
}

function highlightSearchMatches(
  html: string,
  query: string | undefined,
  matchPrefix: string
) {
  const normalizedQuery = normalizeSearchText(query || "");
  if (!normalizedQuery) return html;

  const template = document.createElement("template");
  template.innerHTML = html;
  const walker = document.createTreeWalker(
    template.content,
    NodeFilter.SHOW_TEXT
  );
  const groups = new Map<Element, Text[]>();

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const parent = node.parentElement;
    if (
      !node.data ||
      !parent ||
      parent.closest(
        "button, .code-block-header, .heading-anchor, .katex, .citation-anchor, .citation-fallback, [aria-hidden='true']"
      )
    ) {
      continue;
    }
    const block =
      parent.closest(
        "p, li, h1, h2, h3, h4, h5, h6, td, th, pre, figcaption"
      ) || parent;
    const nodes = groups.get(block) || [];
    nodes.push(node);
    groups.set(block, nodes);
  }

  const rangesByNode = new Map<Text, SearchHighlightRange[]>();
  let matchSequence = 0;

  for (const nodes of groups.values()) {
    const positions: Array<{
      end: number;
      node: Text;
      start: number;
    }> = [];
    let normalizedText = "";
    let previousWasWhitespace = false;
    let previousNode: Text | undefined;

    for (const node of nodes) {
      if (previousNode && !previousWasWhitespace) {
        const boundary = document.createRange();
        boundary.setStartAfter(previousNode);
        boundary.setEndBefore(node);
        if (boundary.cloneContents().querySelector("br")) {
          normalizedText += " ";
          positions.push({ node, start: 0, end: 0 });
          previousWasWhitespace = true;
        }
      }
      for (let offset = 0; offset < node.data.length; ) {
        const codePoint = node.data.codePointAt(offset);
        if (codePoint === undefined) break;
        const character = String.fromCodePoint(codePoint);
        const end = offset + character.length;
        if (/\s/u.test(character)) {
          if (!previousWasWhitespace) {
            normalizedText += " ";
            positions.push({ node, start: offset, end });
          }
          previousWasWhitespace = true;
          offset = end;
          continue;
        }

        const normalizedCharacter = character.toLocaleLowerCase();
        normalizedText += normalizedCharacter;
        for (
          let characterIndex = 0;
          characterIndex < normalizedCharacter.length;
          characterIndex += 1
        ) {
          positions.push({ node, start: offset, end });
        }
        previousWasWhitespace = false;
        offset = end;
      }
      previousNode = node;
    }

    let matchIndex = normalizedText.indexOf(normalizedQuery);
    while (matchIndex >= 0) {
      const matchEnd = matchIndex + normalizedQuery.length;
      const matchId = `${matchPrefix}-${matchSequence}`;
      matchSequence += 1;
      const segments = new Map<Text, { end: number; start: number }>();
      for (let index = matchIndex; index < matchEnd; index += 1) {
        const position = positions[index];
        if (!position) continue;
        const segment = segments.get(position.node);
        if (segment) {
          segment.start = Math.min(segment.start, position.start);
          segment.end = Math.max(segment.end, position.end);
        } else {
          segments.set(position.node, {
            start: position.start,
            end: position.end
          });
        }
      }

      let firstSegment = true;
      for (const [node, segment] of segments) {
        const ranges = rangesByNode.get(node) || [];
        ranges.push({
          ...segment,
          head: firstSegment,
          matchId
        });
        rangesByNode.set(node, ranges);
        firstSegment = false;
      }
      matchIndex = normalizedText.indexOf(normalizedQuery, matchEnd);
    }
  }

  for (const [node, ranges] of rangesByNode) {
    ranges.sort((left, right) => left.start - right.start);
    const mergedRanges: SearchHighlightRange[] = [];
    for (const range of ranges) {
      const previous = mergedRanges.at(-1);
      if (
        previous &&
        previous.matchId === range.matchId &&
        range.start <= previous.end
      ) {
        previous.end = Math.max(previous.end, range.end);
        previous.head ||= range.head;
      } else {
        mergedRanges.push({ ...range });
      }
    }

    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const range of mergedRanges) {
      if (range.start > cursor) {
        fragment.append(node.data.slice(cursor, range.start));
      }
      const mark = document.createElement("mark");
      mark.className = "search-highlight";
      mark.dataset.searchMatch = "true";
      mark.dataset.searchMatchId = range.matchId;
      if (range.head) mark.dataset.searchMatchHead = "true";
      mark.textContent = node.data.slice(range.start, range.end);
      fragment.append(mark);
      cursor = range.end;
    }
    if (cursor < node.data.length) fragment.append(node.data.slice(cursor));
    node.replaceWith(fragment);
  }

  return template.innerHTML;
}

async function writeClipboard(text: string) {
  if (window.readerAPI?.copyText) {
    try {
      await window.readerAPI.copyText(text);
      return true;
    } catch {
      // Fall through for the web preview.
    }
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Electron file:// pages may not expose the Clipboard API.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return document.execCommand("copy");
  } finally {
    textarea.remove();
  }
}

export default function MarkdownBlock({
  text,
  anchorPrefix,
  searchQuery,
  citations
}: Props) {
  const [activeCitation, setActiveCitation] = useState<number>();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeCitation === undefined) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (
        !(target instanceof Node) ||
        !containerRef.current?.contains(target)
      ) {
        setActiveCitation(undefined);
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setActiveCitation(undefined);
    };

    window.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [activeCitation]);

  const renderedMarkdown = useMemo(() => {
    const codeTexts: string[] = [];
    const renderer = new Renderer();

    renderer.code = ({ text: codeText, lang }) => {
      const codeIndex = codeTexts.push(codeText) - 1;
      const highlighted = highlightCode(codeText, lang);

      return `
        <figure class="code-block">
          <header class="code-block-header">
            <span class="code-block-language">${highlighted.language}</span>
            <button class="code-copy-button" type="button" data-code-copy data-code-index="${codeIndex}" aria-label="复制代码" title="复制代码">
              <span class="code-copy-icon" aria-hidden="true"></span>
              <span class="code-copy-label">复制</span>
            </button>
          </header>
          <pre><code class="${highlighted.className}">${highlighted.html}</code></pre>
        </figure>
      `;
    };

    renderer.table = function (token) {
      const table = Renderer.prototype.table.call(this, token);
      return `<div class="table-scroll">${table}</div>`;
    };

    const markdownParser = new Marked({
      gfm: true,
      breaks: true,
      renderer
    });

    const preparedCitations = prepareCitationMarkdown(text, citations);
    const protectedMath = protectMathInMarkdown(
      addHeadingAnchors(preparedCitations.markdown, anchorPrefix)
    );
    const rendered = markdownParser.parse(
      protectedMath.markdown
    ) as string;
    const sanitizationOptions = {
      ADD_ATTR: [
        "target",
        "rel",
        "id",
        "class",
        "type",
        "title",
        "aria-label",
        "data-code-copy",
        "data-code-index"
      ],
      ADD_TAGS: ["span", "figure", "header", "button"],
      FORBID_TAGS: [
        "base",
        "embed",
        "form",
        "iframe",
        "input",
        "link",
        "meta",
        "object",
        "option",
        "select",
        "source",
        "style",
        "textarea",
        "track",
        "video",
        "audio"
      ]
    };
    const sanitizedMarkdown = DOMPurify.sanitize(rendered, {
      ...sanitizationOptions,
      FORBID_ATTR: ["srcset", "style"]
    });
    const renderedWithMath = renderMathPlaceholders(
      sanitizedMarkdown,
      protectedMath.formulas
    );

    const html = DOMPurify.sanitize(renderedWithMath, {
      ...sanitizationOptions,
      FORBID_ATTR: ["srcset"]
    });

    return {
      codeTexts,
      html,
      citations: preparedCitations.sources
    };
  }, [anchorPrefix, citations, text]);

  const citationHtml = useMemo(
    () =>
      addCitationElements(
        renderedMarkdown.html,
        renderedMarkdown.citations,
        activeCitation
      ),
    [activeCitation, renderedMarkdown.citations, renderedMarkdown.html]
  );

  const highlightedHtml = useMemo(
    () =>
      highlightSearchMatches(
        citationHtml,
        searchQuery,
        anchorPrefix
      ),
    [anchorPrefix, citationHtml, searchQuery]
  );

  const handleClick = async (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const citationUrl = target.closest<HTMLElement>("[data-citation-url]");
    if (citationUrl?.dataset.citationUrl) {
      event.preventDefault();
      event.stopPropagation();
      window.open(citationUrl.dataset.citationUrl, "_blank", "noopener,noreferrer");
      setActiveCitation(undefined);
      return;
    }

    const citationMarker = target.closest<HTMLElement>(
      "[data-citation-marker]"
    );
    if (citationMarker) {
      event.preventDefault();
      event.stopPropagation();
      const index = Number(citationMarker.dataset.citationMarker);
      if (Number.isInteger(index)) {
        setActiveCitation((current) =>
          current === index ? undefined : index
        );
      }
      return;
    }

    if (!target.closest(".citation-popover")) {
      setActiveCitation(undefined);
    }

    const button = target.closest<HTMLButtonElement>("[data-code-copy]");
    if (!button) return;

    const codeIndex = Number(button.dataset.codeIndex);
    const codeText = renderedMarkdown.codeTexts[codeIndex];
    if (!Number.isInteger(codeIndex) || codeText === undefined) return;

    button.disabled = true;
    const copied = await writeClipboard(codeText);
    const label = button.querySelector<HTMLElement>(".code-copy-label");

    button.classList.toggle("is-copied", copied);
    button.classList.toggle("is-copy-error", !copied);
    button.setAttribute("aria-label", copied ? "代码已复制" : "复制失败");
    if (label) label.textContent = copied ? "已复制" : "复制失败";

    window.setTimeout(() => {
      if (!button.isConnected) return;
      button.disabled = false;
      button.classList.remove("is-copied", "is-copy-error");
      button.setAttribute("aria-label", "复制代码");
      if (label) label.textContent = "复制";
    }, 1600);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (event.key !== "Enter" && event.key !== " ") return;

    const citationUrl = target.closest<HTMLElement>("[data-citation-url]");
    if (citationUrl?.dataset.citationUrl) {
      event.preventDefault();
      window.open(citationUrl.dataset.citationUrl, "_blank", "noopener,noreferrer");
      setActiveCitation(undefined);
      return;
    }

    const citationMarker = target.closest<HTMLElement>(
      "[data-citation-marker]"
    );
    if (!citationMarker) return;
    event.preventDefault();
    const index = Number(citationMarker.dataset.citationMarker);
    if (Number.isInteger(index)) {
      setActiveCitation((current) =>
        current === index ? undefined : index
      );
    }
  };

  return (
    <div
      ref={containerRef}
      className="markdown"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      dangerouslySetInnerHTML={{ __html: highlightedHtml }}
    />
  );
}
