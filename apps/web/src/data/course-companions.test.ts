import { describe, expect, it } from "vitest";
import { chapters } from "../features/learning/course";
import { libraryMatches } from "../features/learning/ReferenceLibraryPage";
import { chapterCompanions, learningPaths } from "./course-companions";
import catalog from "./reference-library.json";

const libraryIds = new Set(catalog.map((entry) => entry.id));

describe("reference library", () => {
  it("keeps every entry link-only, licensed, and uniquely identified", () => {
    expect(libraryIds.size).toBe(catalog.length);
    for (const entry of catalog) {
      expect(entry.use).toBe("link-only");
      expect(entry.license.length).toBeGreaterThan(2);
      expect(entry.url).toMatch(/^https:\/\//);
    }
  });

  it("filters by shelf, depth, and topic tags", () => {
    const dataset = catalog.find((entry) => entry.kind === "dataset");
    expect(dataset).toBeDefined();
    if (!dataset) return;
    expect(libraryMatches(dataset, { level: "all", shelf: "datasets", query: "" })).toBe(true);
    expect(libraryMatches(dataset, { level: "all", shelf: "books", query: "" })).toBe(false);
    expect(
      libraryMatches(dataset, { level: "all", shelf: "all", query: dataset.topics?.[0] ?? "" }),
    ).toBe(true);
  });
});

describe("course companions", () => {
  it("gives every course chapter at least three companions from the library", () => {
    for (const chapter of chapters) {
      const companions = chapterCompanions[chapter.id];
      expect(companions, chapter.id).toBeDefined();
      expect(companions?.length ?? 0).toBeGreaterThanOrEqual(3);
    }
    for (const chapterId of Object.keys(chapterCompanions)) {
      expect(
        chapters.some((chapter) => chapter.id === chapterId),
        chapterId,
      ).toBe(true);
    }
  });

  it("cites only known library entries with https links and authored reasons", () => {
    for (const companions of Object.values(chapterCompanions)) {
      for (const companion of companions) {
        expect(libraryIds.has(companion.libraryId), companion.libraryId).toBe(true);
        expect(companion.url).toMatch(/^https:\/\//);
        expect(companion.why.length).toBeGreaterThanOrEqual(20);
      }
    }
  });

  it("builds learning paths only from library entries", () => {
    const ids = new Set<string>();
    for (const path of learningPaths) {
      expect(ids.has(path.id)).toBe(false);
      ids.add(path.id);
      expect(path.steps.length).toBeGreaterThanOrEqual(3);
      for (const step of path.steps) {
        expect(libraryIds.has(step.libraryId), `${path.id}:${step.libraryId}`).toBe(true);
      }
    }
  });
});
