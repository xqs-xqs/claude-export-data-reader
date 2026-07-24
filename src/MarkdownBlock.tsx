import { useMemo, type MouseEvent } from "react";
import DOMPurify from "dompurify";
import { Marked, Renderer } from "marked";
import { addHeadingAnchors } from "./headings";
import { highlightCode } from "./codeHighlight";
import { protectMathInMarkdown, renderMathPlaceholders } from "./math";

interface Props {
  text: string;
  anchorPrefix: string;
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

export default function MarkdownBlock({ text, anchorPrefix }: Props) {
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

    return { codeTexts, html };
  }, [anchorPrefix, text]);

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
