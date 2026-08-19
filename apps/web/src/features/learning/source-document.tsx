import { createElement, type ReactNode } from "react";

const SOURCE_IMAGE_URLS = import.meta.glob(
  "../../../../../content/curriculum-v2/sources/rust-book/src/img/**/*.{png,svg}",
  { eager: true, import: "default", query: "?url" },
) as Record<string, string>;

export type ResolvedTarget =
  | {
      kind: "bookPage";
      pageId: string;
      sourcePath: string;
      canonicalUrl: string;
      anchor?: string;
    }
  | {
      kind: "sourceDocument";
      documentId: string;
      sourcePath: string;
      canonicalUrl: string;
      anchor?: string;
      compatibilityAlias?: string;
    }
  | { kind: "external"; url: string };

type EmptyNodeType =
  | "blockquote"
  | "emphasis"
  | "hardBreak"
  | "listItem"
  | "paragraph"
  | "softBreak"
  | "strong"
  | "strikethrough"
  | "tableCell"
  | "tableHead"
  | "tableRow";

type BookElementAttributes =
  | { element: "a"; id: string }
  | { element: "code" | "em" | "figcaption" | "figure" | "kbd" | "pre" | "sup" }
  | { element: "span"; class?: "caption" | "filename"; id?: string };

type BookImageAttributes = {
  element: "img";
  src: string;
  alt: string;
  class?: "center" | "ferris-explain";
  widthPercent?: 50;
};

export type SourceNode =
  | { type: EmptyNodeType; attributes?: never; text?: never; children?: SourceNode[] }
  | {
      type: "text" | "inlineCode" | "inlineMath";
      text: string;
      attributes?: never;
      children?: never;
    }
  | {
      type: "heading";
      attributes: { id: string; level: 1 | 2 | 3 | 4 | 5 | 6 };
      children: SourceNode[];
    }
  | {
      type: "footnoteDefinition" | "footnoteReference";
      text?: string;
      attributes: { label: string };
      children?: SourceNode[];
    }
  | {
      type: "codeBlock";
      attributes: {
        info: string;
        classification: "display" | "runnable" | "compile_fail" | "panic" | "context_fragment";
        runnable: false;
        ordinal: number;
        byteLength: number;
        textSha256: string;
      };
      children: SourceNode[];
    }
  | {
      type: "link";
      attributes: { sourceTarget: string; title: string; target: ResolvedTarget };
      children: SourceNode[];
    }
  | { type: "list"; attributes: { ordered: boolean; start?: number }; children: SourceNode[] }
  | {
      type: "listing";
      attributes:
        | {
            sourcePreprocessor: "trpl-listing";
            number: string;
            id: string;
            fileName?: string;
          }
        | { sourcePreprocessor: "trpl-listing"; fileName?: string };
      children: SourceNode[];
    }
  | {
      type: "listingCaption";
      attributes?: never;
      children: SourceNode[];
    }
  | {
      type: "noteCallout";
      attributes: { sourcePreprocessor: "trpl-note"; variant: "label" | "heading" };
      children: SourceNode[];
    }
  | {
      type: "table";
      attributes: { alignments: Array<"none" | "left" | "center" | "right"> };
      children: SourceNode[];
    }
  | { type: "typedElement"; attributes: BookElementAttributes; children?: SourceNode[] }
  | { type: "typedElement"; attributes: BookImageAttributes; children?: never }
  | {
      type: "warningCallout";
      attributes: { element: "div"; class: "warning" };
      children: SourceNode[];
    };

const INTENTIONAL_OUTCOME: Record<string, string> = {
  compile_fail: "This example does not compile — that failure is the point.",
  panic: "This example panics when it runs — that failure is the point.",
  context_fragment: "Fragment for context; it is not a complete runnable program.",
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[] = allowed,
): Record<string, unknown> {
  const attributes = value === undefined ? {} : record(value, "source node attributes");
  const unexpected = Object.keys(attributes).find((key) => !allowed.includes(key));
  if (unexpected) throw new Error(`unsafe or unknown source node attribute: ${unexpected}`);
  const missing = required.find((key) => !Object.hasOwn(attributes, key));
  if (missing) throw new Error(`source node attribute is missing: ${missing}`);
  return attributes;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be text`);
  return value;
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isInteger(value) || (value as number) < minimum)
    throw new Error(`${label} must be an integer >= ${minimum}`);
  return value as number;
}

function hasControlOrBackslash(value: string): boolean {
  return (
    value.includes("\\") ||
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || code === 127;
    })
  );
}

function safeId(value: unknown): string {
  const id = text(value, "source anchor id");
  if (!id || /\s/u.test(id) || hasControlOrBackslash(id))
    throw new Error("unsafe source anchor id");
  return id;
}

function safeAbsoluteUrl(value: unknown, protocols: readonly string[]): string {
  const href = text(value, "source link URL");
  if (hasControlOrBackslash(href) || href.startsWith("//"))
    throw new Error("unsafe source link URL");
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    throw new Error("malformed source link URL");
  }
  if (!protocols.includes(url.protocol)) throw new Error("unapproved source link protocol");
  return href;
}

function targetHref(value: unknown): string {
  const target = record(value, "resolved source target");
  if (target.kind === "external") {
    exactKeys(target, ["kind", "url"]);
    return safeAbsoluteUrl(target.url, ["http:", "https:", "mailto:"]);
  }
  if (target.kind === "bookPage") {
    exactKeys(
      target,
      ["kind", "pageId", "sourcePath", "canonicalUrl", "anchor"],
      ["kind", "pageId", "sourcePath", "canonicalUrl"],
    );
  } else if (target.kind === "sourceDocument") {
    exactKeys(
      target,
      ["kind", "documentId", "sourcePath", "canonicalUrl", "anchor", "compatibilityAlias"],
      ["kind", "documentId", "sourcePath", "canonicalUrl"],
    );
  } else {
    throw new Error("unknown resolved source target kind");
  }
  const href = safeAbsoluteUrl(target.canonicalUrl, ["https:"]);
  return target.anchor === undefined ? href : `${href}#${safeId(target.anchor)}`;
}

function safeImageSource(value: unknown): string {
  const source = text(value, "source image path");
  if (
    !source ||
    source.startsWith("/") ||
    source.startsWith("//") ||
    source.includes("..") ||
    source.includes(":") ||
    hasControlOrBackslash(source)
  )
    throw new Error("unsafe source image path");
  const url =
    SOURCE_IMAGE_URLS[`../../../../../content/curriculum-v2/sources/rust-book/src/${source}`];
  if (!url) throw new Error("unknown source image path");
  return url;
}

type ParentListing = { number?: string; id?: string };

function children(node: SourceNode, key: string, parentListing?: ParentListing): ReactNode[] {
  if (node.children !== undefined && !Array.isArray(node.children))
    throw new Error(`${node.type} children must be an array`);
  return (node.children ?? []).map((child, index) =>
    renderNode(child, `${key}.${index}`, node.type, parentListing),
  );
}

function unknownTypedElement(value: never): never {
  throw new Error(`unknown typed source element: ${String(value)}`);
}

function typedElement(node: Extract<SourceNode, { type: "typedElement" }>, key: string): ReactNode {
  const attributes = record(node.attributes, "typed element attributes");
  const element = node.attributes.element;
  text(element, "typed element name");
  if (element === "img" && node.children !== undefined)
    throw new Error("source image cannot have children");
  const content = children(node, key);
  switch (element) {
    case "a": {
      exactKeys(attributes, ["element", "id"]);
      return (
        <span id={safeId(attributes.id)} key={key}>
          {content}
        </span>
      );
    }
    case "code":
    case "em":
    case "figcaption":
    case "figure":
    case "kbd":
    case "pre":
    case "sup":
      exactKeys(attributes, ["element"]);
      return createElement(element, { key }, content);
    case "img": {
      exactKeys(
        attributes,
        ["element", "src", "alt", "class", "widthPercent"],
        ["element", "src", "alt"],
      );
      const className = attributes.class;
      if (className !== undefined && className !== "center" && className !== "ferris-explain")
        throw new Error("unsafe source image class");
      if (attributes.widthPercent !== undefined && attributes.widthPercent !== 50)
        throw new Error("unsafe source image width");
      return (
        <img
          alt={text(attributes.alt, "source image alt text")}
          className={className as string | undefined}
          key={key}
          src={safeImageSource(attributes.src)}
          style={attributes.widthPercent === 50 ? { maxWidth: "100%", width: "50%" } : undefined}
        />
      );
    }
    case "span": {
      exactKeys(attributes, ["element", "class", "id"], ["element"]);
      const className = attributes.class;
      if (className !== undefined && className !== "caption" && className !== "filename")
        throw new Error("unsafe source span class");
      if (className === undefined && attributes.id === undefined)
        throw new Error("source span needs an approved class or id");
      return (
        <span
          className={className as string | undefined}
          id={attributes.id === undefined ? undefined : safeId(attributes.id)}
          key={key}
        >
          {content}
        </span>
      );
    }
    default:
      return unknownTypedElement(element);
  }
}

function unknownNode(value: never): never {
  throw new Error(`unknown source node type: ${String((value as { type?: unknown }).type)}`);
}

function renderNode(
  node: SourceNode,
  key: string,
  parentType?: SourceNode["type"],
  parentListing?: ParentListing,
): ReactNode {
  if (!node || typeof node !== "object") throw new Error("source node must be an object");
  switch (node.type) {
    case "text":
      exactKeys(node.attributes, []);
      return text(node.text, "source text");
    case "paragraph":
      exactKeys(node.attributes, []);
      return <p key={key}>{children(node, key)}</p>;
    case "heading": {
      const attributes = exactKeys(node.attributes, ["id", "level"]);
      const level = integer(attributes.level, "heading level", 1);
      if (level > 6) throw new Error("heading level must be <= 6");
      return createElement(`h${level}`, { id: safeId(attributes.id), key }, children(node, key));
    }
    case "blockquote":
      exactKeys(node.attributes, []);
      return <blockquote key={key}>{children(node, key)}</blockquote>;
    case "codeBlock": {
      const attributes = exactKeys(node.attributes, [
        "info",
        "classification",
        "runnable",
        "ordinal",
        "byteLength",
        "textSha256",
      ]);
      const classification = text(attributes.classification, "code classification");
      if (
        !["display", "runnable", "compile_fail", "panic", "context_fragment"].includes(
          classification,
        )
      )
        throw new Error("unknown code classification");
      if (attributes.runnable !== false)
        throw new Error("unreviewed source code cannot be runnable");
      integer(attributes.ordinal, "code ordinal", 1);
      integer(attributes.byteLength, "code byte length");
      if (!/^[a-f0-9]{64}$/u.test(text(attributes.textSha256, "code SHA-256")))
        throw new Error("invalid code SHA-256");
      const label = INTENTIONAL_OUTCOME[classification];
      const block = (
        <pre data-code-classification={classification} key={key}>
          <code>{children(node, key)}</code>
        </pre>
      );
      // The plan requires intentional failures to be labelled visibly *and* for
      // assistive tech, so the caption is real text rather than a colour cue.
      return label ? (
        <figure className="source-code-note" data-code-classification={classification} key={key}>
          <figcaption>{label}</figcaption>
          {block}
        </figure>
      ) : (
        block
      );
    }
    case "inlineCode":
      exactKeys(node.attributes, []);
      return <code key={key}>{text(node.text, "inline code")}</code>;
    case "inlineMath":
      exactKeys(node.attributes, []);
      return (
        <span data-inline-math="true" key={key}>
          {text(node.text, "inline math")}
        </span>
      );
    case "emphasis":
      exactKeys(node.attributes, []);
      return <em key={key}>{children(node, key)}</em>;
    case "strong":
      exactKeys(node.attributes, []);
      return <strong key={key}>{children(node, key)}</strong>;
    case "strikethrough":
      exactKeys(node.attributes, []);
      return <del key={key}>{children(node, key)}</del>;
    case "link": {
      const attributes = exactKeys(node.attributes, ["sourceTarget", "title", "target"]);
      text(attributes.sourceTarget, "source link target");
      const title = text(attributes.title, "source link title");
      return (
        <a href={targetHref(attributes.target)} key={key} title={title || undefined}>
          {children(node, key)}
        </a>
      );
    }
    case "list": {
      const attributes = exactKeys(node.attributes, ["ordered", "start"], ["ordered"]);
      if (typeof attributes.ordered !== "boolean")
        throw new Error("list ordered flag must be boolean");
      const content = children(node, key);
      if (!attributes.ordered) {
        if (attributes.start !== undefined) throw new Error("unordered list cannot have a start");
        return <ul key={key}>{content}</ul>;
      }
      return (
        <ol
          key={key}
          start={
            attributes.start === undefined ? undefined : integer(attributes.start, "list start")
          }
        >
          {content}
        </ol>
      );
    }
    case "listItem":
      exactKeys(node.attributes, []);
      return <li key={key}>{children(node, key)}</li>;
    case "listing": {
      const attributes = exactKeys(
        node.attributes,
        ["sourcePreprocessor", "number", "id", "fileName"],
        ["sourcePreprocessor"],
      );
      if (attributes.sourcePreprocessor !== "trpl-listing")
        throw new Error("unknown listing preprocessor");
      const number = attributes.number === undefined ? undefined : safeId(attributes.number);
      const id = attributes.id === undefined ? undefined : safeId(attributes.id);
      if ((number === undefined) !== (id === undefined) || (number && id !== `listing-${number}`))
        throw new Error("listing number and target id must agree");
      const fileName =
        attributes.fileName === undefined
          ? undefined
          : text(attributes.fileName, "listing file name");
      return (
        <figure data-listing-number={number} id={id} key={key}>
          {fileName === undefined ? null : (
            <span data-listing-file-name="true">
              Filename: <code>{fileName}</code>
            </span>
          )}
          {children(node, key, { number, id })}
        </figure>
      );
    }
    case "listingCaption": {
      if (parentType !== "listing") throw new Error("listing caption must belong to a listing");
      exactKeys(node.attributes, []);
      const number = parentListing?.number;
      const targetId = parentListing?.id;
      if ((number === undefined) !== (targetId === undefined))
        throw new Error("parent listing number and target id must be paired");
      const content = children(node, key);
      return (
        <figcaption key={key}>
          {number ? <a href={`#${targetId}`}>Listing {number}</a> : null}
          {number && content.length > 0 ? ": " : null}
          {content}
        </figcaption>
      );
    }
    case "noteCallout": {
      const attributes = exactKeys(node.attributes, ["sourcePreprocessor", "variant"]);
      if (attributes.sourcePreprocessor !== "trpl-note")
        throw new Error("unknown note preprocessor");
      if (attributes.variant !== "label" && attributes.variant !== "heading")
        throw new Error("unknown note variant");
      return (
        <aside
          aria-label={attributes.variant === "label" ? "Note" : undefined}
          key={key}
          role="note"
        >
          {children(node, key)}
        </aside>
      );
    }
    case "footnoteDefinition": {
      const attributes = exactKeys(node.attributes, ["label"]);
      return (
        <aside id={`footnote-${safeId(attributes.label)}`} key={key}>
          {children(node, key)}
        </aside>
      );
    }
    case "footnoteReference": {
      const attributes = exactKeys(node.attributes, ["label"]);
      const label = safeId(attributes.label);
      return (
        <sup key={key}>
          <a href={`#footnote-${label}`}>{text(node.text, "footnote label")}</a>
        </sup>
      );
    }
    case "table": {
      const attributes = exactKeys(node.attributes, ["alignments"]);
      if (!Array.isArray(attributes.alignments))
        throw new Error("table alignments must be an array");
      for (const alignment of attributes.alignments)
        if (!["none", "left", "center", "right"].includes(String(alignment)))
          throw new Error("unknown table alignment");
      const tableChildren = node.children ?? [];
      const head = tableChildren.filter((child) => child.type === "tableHead");
      const rows = tableChildren.filter((child) => child.type === "tableRow");
      if (head.length !== 1 || head.length + rows.length !== tableChildren.length)
        throw new Error("source table must contain one head followed by rows");
      return (
        <table key={key}>
          {head.map((child, index) => renderNode(child, `${key}.head.${index}`, "table"))}
          <tbody>
            {rows.map((child, index) => renderNode(child, `${key}.row.${index}`, "table"))}
          </tbody>
        </table>
      );
    }
    case "tableHead":
      exactKeys(node.attributes, []);
      return (
        <thead key={key}>
          <tr>{children(node, key)}</tr>
        </thead>
      );
    case "tableRow":
      exactKeys(node.attributes, []);
      return <tr key={key}>{children(node, key)}</tr>;
    case "tableCell":
      exactKeys(node.attributes, []);
      return parentType === "tableHead" ? (
        <th key={key}>{children(node, key)}</th>
      ) : (
        <td key={key}>{children(node, key)}</td>
      );
    case "hardBreak":
      exactKeys(node.attributes, []);
      return <br key={key} />;
    case "softBreak":
      exactKeys(node.attributes, []);
      return "\n";
    case "typedElement":
      return typedElement(node, key);
    case "warningCallout": {
      const attributes = exactKeys(node.attributes, ["class", "element"]);
      if (attributes.element !== "div" || attributes.class !== "warning")
        throw new Error("unsafe Mainmatter warning element");
      return (
        <aside className="warning" key={key} role="note">
          {children(node, key)}
        </aside>
      );
    }
    default:
      return unknownNode(node);
  }
}

export function SourceDocumentBlocks({ blocks }: { blocks: readonly SourceNode[] }) {
  if (!Array.isArray(blocks)) throw new Error("source document blocks must be an array");
  return <>{blocks.map((node, index) => renderNode(node, String(index)))}</>;
}
