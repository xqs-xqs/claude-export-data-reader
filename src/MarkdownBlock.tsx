import { useMemo } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";

interface Props {
  text: string;
  anchorPrefix: string;
}

marked.setOptions({
  gfm: true,
  breaks: true
});

function withHeadingAnchors(text: string, prefix: string) {
  let index = 0;
  let fence: string | undefined;
  return text
    .split(/\r?\n/)
    .map((line) => {
      const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
      if (fenceMatch) {
        const marker = fenceMatch[1][0];
        fence = fence === marker ? undefined : fence || marker;
        return line;
      }
      if (fence) return line;
      if (!/^(#{1,4})\s+/.test(line)) return line;
      const anchor = `<span id="${prefix}-${index}" class="heading-anchor"></span>`;
      index += 1;
      return `${anchor}\n${line}`;
    })
    .join("\n");
}

export default function MarkdownBlock({ text, anchorPrefix }: Props) {
  const html = useMemo(() => {
    const rendered = marked.parse(withHeadingAnchors(text, anchorPrefix)) as string;
    return DOMPurify.sanitize(rendered, {
      ADD_ATTR: ["target", "rel", "id"],
      ADD_TAGS: ["span"]
    });
  }, [anchorPrefix, text]);

  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
