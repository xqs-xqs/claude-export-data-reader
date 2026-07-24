import { useMemo, type MouseEvent } from "react";
import DOMPurify from "dompurify";
import { Marked, Renderer } from "marked";
import { addHeadingAnchors } from "./headings";
import { highlightCode } from "./codeHighlight";
import { protectMathInMarkdown, renderMathPlaceholders } from "./math";
import { normalizeSearchText } from "./search";

interface Props {
  text: string;
  anchorPrefix: string;
  searchQuery?: string;
}

function highlightSearchMatches(html: string, query?: string) {
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
        "button, .code-block-header, .heading-anchor, .katex, [aria-hidden='true']"
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

  const rangesByNode = new Map<Text, Array<{ end: number; start: number }>>();

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

      for (const [node, segment] of segments) {
        const ranges = rangesByNode.get(node) || [];
        ranges.push(segment);
        rangesByNode.set(node, ranges);
      }
      matchIndex = normalizedText.indexOf(normalizedQuery, matchEnd);
    }
  }

  for (const [node, ranges] of rangesByNode) {
    ranges.sort((left, right) => left.start - right.start);
    const mergedRanges: Array<{ end: number; start: number }> = [];
    for (const range of ranges) {
      const previous = mergedRanges.at(-1);
      if (previous && range.start <= previous.end) {
        previous.end = Math.max(previous.end, range.end);
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
  searchQuery
}: Props) {
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

    const protectedMath = protectMathInMarkdown(
      addHeadingAnchors(text, anchorPrefix)
    );
    const rendered = markdownParser.parse(
      protectedMath.markdown
    ) as string;
    const renderedWithMath = renderMathPlaceholders(
      rendered,
      protectedMath.formulas
    );

    const html = DOMPurify.sanitize(renderedWithMath, {
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
      ADD_TAGS: ["span", "figure", "header", "button"]
    });

    return {
      codeTexts,
      html: highlightSearchMatches(html, searchQuery)
    };
  }, [anchorPrefix, searchQuery, text]);

  const handleClick = async (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

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

  return (
    <div
      className="markdown"
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: renderedMarkdown.html }}
    />
  );
}
