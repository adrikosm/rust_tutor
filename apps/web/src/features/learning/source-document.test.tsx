import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SourceDocumentBlocks, type SourceNode } from "./source-document";

type SourceRecord = { blocks: SourceNode[] };
type BookArtifact = { pages: SourceRecord[] };
type MainmatterArtifact = { exercises: SourceRecord[]; resources: SourceRecord[] };

const contentRoot = resolve(__dirname, "../../../../../content/curriculum-v2");
const book = JSON.parse(
  readFileSync(resolve(contentRoot, "rust-book.json"), "utf8"),
) as BookArtifact;
const mainmatter = JSON.parse(
  readFileSync(resolve(contentRoot, "mainmatter-documents.json"), "utf8"),
) as MainmatterArtifact;
const records = [...book.pages, ...mainmatter.exercises, ...mainmatter.resources];

function nodeTypes(nodes: SourceNode[], output = new Set<string>()): Set<string> {
  for (const node of nodes) {
    output.add(node.type);
    if ("children" in node && node.children) nodeTypes(node.children, output);
  }
  return output;
}

function allNodes(nodes: SourceNode[], output: SourceNode[] = []): SourceNode[] {
  for (const node of nodes) {
    output.push(node);
    if ("children" in node && node.children) allNodes(node.children, output);
  }
  return output;
}

describe("SourceDocumentBlocks", () => {
  it("renders every pinned typed block through native React elements", () => {
    const seen = new Set<string>();
    for (const record of records) {
      nodeTypes(record.blocks, seen);
      const html = renderToStaticMarkup(<SourceDocumentBlocks blocks={record.blocks} />);
      expect(html).not.toContain("<script");
      expect(html).not.toContain("typedElementBoundary");
    }
    expect([...seen].sort()).toEqual([
      "blockquote",
      "codeBlock",
      "emphasis",
      "footnoteDefinition",
      "footnoteReference",
      "hardBreak",
      "heading",
      "inlineCode",
      "inlineMath",
      "link",
      "list",
      "listItem",
      "listing",
      "listingCaption",
      "noteCallout",
      "paragraph",
      "softBreak",
      "strong",
      "table",
      "tableCell",
      "tableHead",
      "tableRow",
      "text",
      "typedElement",
      "warningCallout",
    ]);
  });

  it("renders nested listings and the pinned stale-anchor compatibility target", () => {
    const listing = book.pages
      .flatMap((page) => allNodes(page.blocks))
      .find(
        (node) =>
          node.type === "listing" &&
          node.children.some((child) => child.type === "codeBlock") &&
          node.children.some(
            (child) =>
              child.type === "listingCaption" &&
              allNodes(child.children).some(
                (captionNode) =>
                  captionNode.type === "inlineCode" || captionNode.type === "emphasis",
              ),
          ),
      );
    expect(listing).toBeDefined();
    const listingHtml = renderToStaticMarkup(
      <SourceDocumentBlocks blocks={[listing as SourceNode]} />,
    );
    expect(listingHtml).toMatch(/<figure[^>]+id="listing-[^"]+"/u);
    expect(listingHtml).toMatch(/<figcaption><a href="#listing-[^"]+">Listing /u);
    expect(listingHtml).not.toContain("`Box");

    const syntax = mainmatter.exercises[1];
    if (!syntax) throw new Error("pinned Mainmatter syntax document is missing");
    const html = renderToStaticMarkup(<SourceDocumentBlocks blocks={syntax.blocks} />);
    expect(html).toContain(
      "https://github.com/mainmatter/100-exercises-to-learn-rust/blob/57d145e6d393dfffeadb97fc61e814255c3b6ffe/book/src/01_intro/00_welcome.md#workshop-runner-wr",
    );
  });

  it("escapes text and rejects unknown nodes, attributes, links, and image paths", () => {
    const escaped = renderToStaticMarkup(
      <SourceDocumentBlocks blocks={[{ type: "text", text: "<script>alert(1)</script>" }]} />,
    );
    expect(escaped).toContain("&lt;script&gt;");

    expect(() =>
      renderToStaticMarkup(
        <SourceDocumentBlocks blocks={[{ type: "rawHtml", text: "<b>x</b>" } as never]} />,
      ),
    ).toThrow("unknown source node type");
    expect(() =>
      renderToStaticMarkup(
        <SourceDocumentBlocks
          blocks={[{ type: "paragraph", attributes: { onclick: "x" } } as never]}
        />,
      ),
    ).toThrow("unsafe or unknown source node attribute");
    expect(() =>
      renderToStaticMarkup(
        <SourceDocumentBlocks
          blocks={[
            {
              type: "link",
              attributes: {
                sourceTarget: "javascript:alert(1)",
                title: "",
                target: { kind: "external", url: "javascript:alert(1)" },
              },
              children: [{ type: "text", text: "unsafe" }],
            },
          ]}
        />,
      ),
    ).toThrow("unapproved source link protocol");
    expect(() =>
      renderToStaticMarkup(
        <SourceDocumentBlocks
          blocks={[
            {
              type: "typedElement",
              attributes: { element: "img", src: "../secret", alt: "unsafe" },
            },
          ]}
        />,
      ),
    ).toThrow("unsafe source image path");
    expect(() =>
      renderToStaticMarkup(
        <SourceDocumentBlocks
          blocks={[
            {
              type: "typedElement",
              attributes: { element: "img", src: "img/missing.svg", alt: "missing" },
            },
          ]}
        />,
      ),
    ).toThrow("unknown source image path");
    for (const attributes of [
      { element: "img", src: "img/x.svg" },
      { element: "a" },
      { element: "code", caption: "not allowed" },
    ]) {
      expect(() =>
        renderToStaticMarkup(
          <SourceDocumentBlocks
            blocks={[{ type: "typedElement", attributes, children: [] } as never]}
          />,
        ),
      ).toThrow();
    }
    expect(() =>
      renderToStaticMarkup(
        <SourceDocumentBlocks
          blocks={[
            {
              type: "typedElement",
              attributes: { element: "img", src: "img/x.svg", alt: "x" },
              children: [{ type: "text", text: "not allowed" }],
            } as never,
          ]}
        />,
      ),
    ).toThrow("source image cannot have children");
  });

  it("preserves the pinned note and listing preprocessor inventory", () => {
    const nodes = book.pages.flatMap((page) => allNodes(page.blocks));
    const listings = nodes.filter((node) => node.type === "listing");
    const captions = nodes.filter((node) => node.type === "listingCaption");
    const notes = nodes.filter((node) => node.type === "noteCallout");
    expect(listings).toHaveLength(424);
    expect(
      listings.filter((node) => node.type === "listing" && "number" in node.attributes),
    ).toHaveLength(384);
    expect(captions).toHaveLength(384);
    expect(
      listings.filter((node) => node.type === "listing" && node.attributes.fileName !== undefined),
    ).toHaveLength(337);
    expect(
      captions.filter(
        (node) =>
          node.type === "listingCaption" &&
          allNodes(node.children).some(
            (child) => child.type === "inlineCode" || child.type === "emphasis",
          ),
      ),
    ).toHaveLength(269);
    expect(notes).toHaveLength(46);
    expect(
      notes.filter((node) => node.type === "noteCallout" && node.attributes.variant === "label"),
    ).toHaveLength(32);
    expect(
      notes.filter((node) => node.type === "noteCallout" && node.attributes.variant === "heading"),
    ).toHaveLength(14);
    expect(nodes.filter((node) => node.type === "blockquote")).toHaveLength(3);
  });

  it("derives caption identity only from its parent listing", () => {
    const parentOwned: SourceNode = {
      type: "listing",
      attributes: {
        sourcePreprocessor: "trpl-listing",
        number: "1-1",
        id: "listing-1-1",
      },
      children: [
        {
          type: "listingCaption",
          children: [{ type: "text", text: "Parent-owned caption" }],
        },
      ],
    };
    const html = renderToStaticMarkup(<SourceDocumentBlocks blocks={[parentOwned]} />);
    expect(html).toContain('<a href="#listing-1-1">Listing 1-1</a>');
    expect(html).not.toContain("listing-2-1");

    expect(() =>
      renderToStaticMarkup(
        <SourceDocumentBlocks
          blocks={[
            {
              ...parentOwned,
              children: [
                {
                  type: "listingCaption",
                  attributes: { number: "2-1", targetId: "listing-2-1" },
                  children: [],
                },
              ],
            } as never,
          ]}
        />,
      ),
    ).toThrow("unsafe or unknown source node attribute: number");
  });

  it("contains no raw HTML or runtime Markdown rendering escape hatch", () => {
    const source = readFileSync(resolve(__dirname, "source-document.tsx"), "utf8");
    expect(source).not.toContain("dangerouslySetInnerHTML");
    expect(source).not.toMatch(/react-markdown|marked|remark|rehype/u);
  });
});
