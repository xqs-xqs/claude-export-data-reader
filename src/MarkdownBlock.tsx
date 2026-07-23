import { useMemo } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { addHeadingAnchors } from "./headings";

interface Props {
  text: string;
  anchorPrefix: string;
}

marked.setOptions({
  gfm: true,
  breaks: true
});

export default function MarkdownBlock({ text, anchorPrefix }: Props) {
  const html = useMemo(() => {
    const rendered = marked.parse(addHeadingAnchors(text, anchorPrefix)) as string;
    return DOMPurify.sanitize(rendered, {
      ADD_ATTR: ["target", "rel", "id"],
      ADD_TAGS: ["span"]
    });
  }, [anchorPrefix, text]);

  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
