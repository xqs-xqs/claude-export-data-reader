import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import latex from "highlight.js/lib/languages/latex";
import markdown from "highlight.js/lib/languages/markdown";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const languages = {
  bash,
  css,
  java,
  javascript,
  json,
  latex,
  markdown,
  powershell,
  python,
  typescript,
  xml,
  yaml
};

for (const [name, definition] of Object.entries(languages)) {
  if (!hljs.getLanguage(name)) {
    hljs.registerLanguage(name, definition);
  }
}

const LANGUAGE_ALIASES: Record<string, string> = {
  bash: "bash",
  shell: "bash",
  sh: "bash",
  zsh: "bash",
  css: "css",
  java: "java",
  javascript: "javascript",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  latex: "latex",
  tex: "latex",
  markdown: "markdown",
  md: "markdown",
  powershell: "powershell",
  ps1: "powershell",
  python: "python",
  py: "python",
  typescript: "typescript",
  ts: "typescript",
  tsx: "typescript",
  html: "xml",
  svg: "xml",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml"
};

const LANGUAGE_LABELS: Record<string, string> = {
  javascript: "JavaScript",
  typescript: "TypeScript",
  powershell: "PowerShell",
  markdown: "Markdown",
  python: "Python",
  java: "Java",
  bash: "Bash",
  json: "JSON",
  html: "HTML",
  xml: "XML",
  css: "CSS",
  yaml: "YAML",
  latex: "LaTeX"
};

export interface HighlightedCode {
  className: string;
  html: string;
  language: string;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function languageToken(info?: string) {
  return info
    ?.trim()
    .split(/\s+/, 1)[0]
    ?.replace(/^\{\./, "")
    .replace(/\}$/, "")
    .toLowerCase();
}

export function highlightCode(source: string, info?: string): HighlightedCode {
  const token = languageToken(info);
  const canonicalLanguage = token ? LANGUAGE_ALIASES[token] : undefined;
  const displayLanguage =
    (token && LANGUAGE_LABELS[token]) ||
    (canonicalLanguage && LANGUAGE_LABELS[canonicalLanguage]) ||
    (token ? token.slice(0, 32) : "text");

  if (!canonicalLanguage || source.length > 50_000) {
    return {
      className: "hljs",
      html: escapeHtml(source),
      language: escapeHtml(displayLanguage)
    };
  }

  try {
    return {
      className: `hljs language-${canonicalLanguage}`,
      html: hljs.highlight(source, {
        language: canonicalLanguage,
        ignoreIllegals: true
      }).value,
      language: escapeHtml(displayLanguage)
    };
  } catch {
    return {
      className: "hljs",
      html: escapeHtml(source),
      language: escapeHtml(displayLanguage)
    };
  }
}
