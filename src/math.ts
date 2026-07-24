import katex from "katex";
import "katex/dist/katex.min.css";

interface MathPlaceholder {
  displayMode: boolean;
  source: string;
  token: string;
}

export interface ProtectedMarkdownMath {
  formulas: MathPlaceholder[];
  markdown: string;
}

function isEscaped(source: string, index: number) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor--) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function lineEndAfter(source: string, index: number) {
  const lineEnd = source.indexOf("\n", index);
  return lineEnd === -1 ? source.length : lineEnd + 1;
}

function contentStartAfterBlockquotes(source: string, lineStart: number) {
  let cursor = lineStart;

  while (cursor < source.length) {
    let marker = cursor;
    let spaces = 0;
    while (spaces < 3 && source[marker] === " ") {
      marker += 1;
      spaces += 1;
    }
    if (source[marker] !== ">") break;

    cursor = marker + 1;
    if (source[cursor] === " ") cursor += 1;
  }

  return cursor;
}

function fencedCodeEnd(source: string, index: number) {
  if (index > 0 && source[index - 1] !== "\n") return undefined;

  const opening = /^( {0,3})(`{3,}|~{3,})[^\n]*(?:\n|$)/.exec(
    source.slice(index)
  );
  if (!opening) return undefined;

  const marker = opening[2][0];
  const minimumLength = opening[2].length;
  let cursor = index + opening[0].length;

  while (cursor < source.length) {
    const end = lineEndAfter(source, cursor);
    const line = source.slice(cursor, end).replace(/\r?\n$/, "");
    const leadingSpaces = line.match(/^ {0,3}/)?.[0].length ?? 0;
    let markerCount = 0;
    while (line[leadingSpaces + markerCount] === marker) markerCount += 1;

    if (
      markerCount >= minimumLength &&
      line.slice(leadingSpaces + markerCount).trim() === ""
    ) {
      return end;
    }
    cursor = end;
  }

  return source.length;
}

function inlineCodeEnd(source: string, index: number) {
  if (source[index] !== "`" || isEscaped(source, index)) return undefined;

  let markerLength = 1;
  while (source[index + markerLength] === "`") markerLength += 1;
  const marker = "`".repeat(markerLength);
  let cursor = index + markerLength;

  while (cursor < source.length) {
    const closing = source.indexOf(marker, cursor);
    if (closing === -1) return undefined;
    const hasAdjacentBacktick =
      source[closing - 1] === "`" ||
      source[closing + markerLength] === "`";
    if (!hasAdjacentBacktick) return closing + markerLength;
    cursor = closing + markerLength;
  }

  return undefined;
}

function rawCodeEnd(source: string, index: number) {
  const opening = /^<(pre|code)\b[^>]*>/i.exec(source.slice(index));
  if (!opening) return undefined;

  const closingTag = `</${opening[1].toLowerCase()}>`;
  const closing = source.toLowerCase().indexOf(
    closingTag,
    index + opening[0].length
  );
  return closing === -1 ? source.length : closing + closingTag.length;
}

function closingDelimiter(
  source: string,
  start: number,
  delimiter: string,
  allowNewline: boolean
) {
  let cursor = start;
  while (cursor < source.length) {
    if (!allowNewline && (source[cursor] === "\n" || source[cursor] === "\r")) {
      return -1;
    }
    const closing = source.indexOf(delimiter, cursor);
    if (closing === -1) return -1;
    if (!allowNewline) {
      const newline = source.slice(cursor, closing).search(/[\r\n]/);
      if (newline !== -1) return -1;
    }
    if (!isEscaped(source, closing)) return closing;
    cursor = closing + delimiter.length;
  }
  return -1;
}

function closingSingleDollar(source: string, start: number) {
  for (let cursor = start; cursor < source.length; cursor++) {
    const character = source[cursor];
    if (character === "\n" || character === "\r") return -1;
    if (
      character === "$" &&
      source[cursor - 1] !== "$" &&
      source[cursor + 1] !== "$" &&
      !isEscaped(source, cursor)
    ) {
      return cursor;
    }
  }
  return -1;
}

function literalDollarTokenEnd(source: string, index: number) {
  const remaining = source.slice(index);
  const templateVariable = /^\$\{\{[^\r\n]*?\}\}/.exec(remaining);
  if (templateVariable) return index + templateVariable[0].length;

  const bracedVariable = /^\$\{[A-Z_][A-Z0-9_]*\}/.exec(remaining);
  if (bracedVariable) return index + bracedVariable[0].length;

  const identifier = new RegExp(
    "^\\$(?:[A-Z_][A-Z0-9_]{1,}|and|or|eq|ne|gt|gte|lt|lte|in|nin|not|nor|exists|regex|all|elemMatch|size|type)\\b"
  ).exec(remaining);
  if (identifier) {
    const end = index + identifier[0].length;
    if (source[end] !== "$") {
      const closing = closingSingleDollar(source, end);
      if (closing !== -1) {
        const candidate = source.slice(index + 1, closing);
        if (isLikelyInlineMath(candidate, source[closing + 1])) {
          return undefined;
        }
      }
      return end;
    }
  }

  const amount =
    /^\$\s?\d+(?:,\d{3})*(?:\.\d+)?(?:\s*[-–—~～]\s*\$?\s?\d+(?:,\d{3})*(?:\.\d+)?)?/.exec(
      remaining
    );
  if (!amount) return undefined;

  const end = index + amount[0].length;
  if (/[-–—~～]/.test(amount[0])) return end;
  if (source[end] === "$") return end + 1;
  if (source[end] && /[\\_^{}=+\-*/<>|()[\]]/.test(source[end])) {
    return undefined;
  }

  const closing = closingSingleDollar(source, end);
  if (closing !== -1) {
    const expression = source.slice(index + 1, closing).trim();
    const containsTexCommand = /\\[A-Za-z]+/.test(expression);
    const containsWord = /[\p{L}]{2,}/u.test(expression);
    const containsMathStructure = /[_^{}=+\-*/<>|()[\]]/.test(expression);
    if (
      containsTexCommand ||
      (containsMathStructure && !containsWord)
    ) {
      return undefined;
    }
  }

  return end;
}

function isLikelyInlineMath(source: string, characterAfter: string | undefined) {
  const expression = source.trim();
  if (!expression) return false;

  if (
    /^\d[\d,.\s]*(?:[-–—~～]|到|至)?$/.test(expression) ||
    (/^\d/.test(expression) && characterAfter && /\d/.test(characterAfter))
  ) {
    return false;
  }

  const variableAtom =
    "[A-Za-z][A-Za-z0-9']*(?:_(?:\\{[^{}]+\\}|[A-Za-z0-9]+))?";
  const isVariableList = new RegExp(
    `^${variableAtom}(?:\\s*,\\s*${variableAtom})+$`
  ).test(expression);
  if (isVariableList) return true;

  const startsLikeJsonOperator =
    /^[A-Za-z_][A-Za-z0-9_]*['"]\s*:/.test(expression);
  if (startsLikeJsonOperator) return false;

  const bridgesDollarIdentifiers =
    Boolean(characterAfter && /[A-Za-z_{]/.test(characterAfter)) &&
    /^[A-Za-z_][A-Za-z0-9_]*\s*[/\\:;,.=+\-*]?\s*$/.test(expression);
  if (bridgesDollarIdentifiers) return false;

  const containsWord = /[\p{L}]{2,}/u.test(expression);
  const containsTexCommand = /\\[A-Za-z]+/.test(expression);
  if (/^\d/.test(expression) && containsWord && !containsTexCommand) {
    return false;
  }

  const hasWhitespace = /\s/.test(expression);
  const hasMathSignal = /[\\_^{}=+*/<>|()[\]]/.test(expression);
  if (hasWhitespace && !hasMathSignal) return false;

  return true;
}

function placeholderPrefix(source: string) {
  let prefix = "CLAUDEMATHPLACEHOLDER";
  while (source.includes(prefix)) prefix += "X";
  return prefix;
}

export function protectMathInMarkdown(source: string): ProtectedMarkdownMath {
  const formulas: MathPlaceholder[] = [];
  const prefix = placeholderPrefix(source);
  let markdown = "";
  let cursor = 0;

  const addFormula = (
    formulaSource: string,
    displayMode: boolean,
    nextCursor: number
  ) => {
    const token = `${prefix}${formulas.length}END`;
    formulas.push({ displayMode, source: formulaSource.trim(), token });
    markdown += token;
    cursor = nextCursor;
  };

  while (cursor < source.length) {
    const atLineStart = cursor === 0 || source[cursor - 1] === "\n";
    if (atLineStart) {
      const fenceEnd = fencedCodeEnd(source, cursor);
      if (fenceEnd !== undefined) {
        markdown += source.slice(cursor, fenceEnd);
        cursor = fenceEnd;
        continue;
      }

      const contentStart = contentStartAfterBlockquotes(source, cursor);
      if (/^(?: {4}|\t)/.test(source.slice(contentStart))) {
        const end = lineEndAfter(source, cursor);
        markdown += source.slice(cursor, end);
        cursor = end;
        continue;
      }
    }

    const codeEnd = inlineCodeEnd(source, cursor);
    if (codeEnd !== undefined) {
      markdown += source.slice(cursor, codeEnd);
      cursor = codeEnd;
      continue;
    }

    const htmlCodeEnd = rawCodeEnd(source, cursor);
    if (htmlCodeEnd !== undefined) {
      markdown += source.slice(cursor, htmlCodeEnd);
      cursor = htmlCodeEnd;
      continue;
    }

    if (source.startsWith("$$", cursor) && !isEscaped(source, cursor)) {
      const closing = closingDelimiter(source, cursor + 2, "$$", true);
      if (closing !== -1) {
        addFormula(source.slice(cursor + 2, closing), true, closing + 2);
        continue;
      }
    }

    if (source.startsWith("\\[", cursor) && !isEscaped(source, cursor)) {
      const closing = closingDelimiter(source, cursor + 2, "\\]", true);
      if (closing !== -1) {
        addFormula(source.slice(cursor + 2, closing), true, closing + 2);
        continue;
      }
    }

    if (source.startsWith("\\(", cursor) && !isEscaped(source, cursor)) {
      const closing = closingDelimiter(source, cursor + 2, "\\)", false);
      if (closing !== -1) {
        addFormula(source.slice(cursor + 2, closing), false, closing + 2);
        continue;
      }
    }

    if (
      source[cursor] === "$" &&
      source[cursor - 1] !== "$" &&
      source[cursor + 1] !== "$" &&
      !isEscaped(source, cursor)
    ) {
      const literalEnd = literalDollarTokenEnd(source, cursor);
      if (literalEnd !== undefined) {
        markdown += source.slice(cursor, literalEnd);
        cursor = literalEnd;
        continue;
      }

      const closing = closingSingleDollar(source, cursor + 1);
      if (closing !== -1) {
        const formulaSource = source.slice(cursor + 1, closing);
        if (isLikelyInlineMath(formulaSource, source[closing + 1])) {
          addFormula(formulaSource, false, closing + 1);
          continue;
        }

        markdown += source.slice(cursor, closing + 1);
        cursor = closing + 1;
        continue;
      }
    }

    markdown += source[cursor];
    cursor += 1;
  }

  return { formulas, markdown };
}

export function renderMathPlaceholders(
  html: string,
  formulas: MathPlaceholder[]
) {
  let rendered = html;

  for (const formula of formulas) {
    const mathHtml = katex.renderToString(formula.source, {
      displayMode: formula.displayMode,
      maxExpand: 1000,
      maxSize: 20,
      output: "htmlAndMathml",
      strict: "ignore",
      throwOnError: false,
      trust: false
    });
    rendered = rendered.replaceAll(formula.token, mathHtml);
  }

  return rendered;
}
