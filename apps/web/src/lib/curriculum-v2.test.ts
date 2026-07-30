import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { lessonV2Schema, practiceItemV2Schema, practiceListSchema } from "./service-client";

const releasePath = resolve(__dirname, "../../../../content/curriculum-v2/release.json");
const release = JSON.parse(readFileSync(releasePath, "utf8")) as {
  lessons: unknown[];
  exercises: unknown[];
};

describe("curriculum v2 frontend contracts", () => {
  it("parses every authored lesson after private recall answers are removed", () => {
    for (const raw of release.lessons) {
      const lesson = structuredClone(raw) as Record<string, unknown>;
      lesson.recallChecks = (lesson.recallChecks as Record<string, unknown>[]).map(
        ({ answerIndex: _answerIndex, ...safeCheck }) => safeCheck,
      );
      expect(lessonV2Schema.safeParse(lesson).success).toBe(true);
    }
  });

  it("parses every public practice summary without solutions or private tests", () => {
    for (const raw of release.exercises) {
      const {
        explanation: _explanation,
        referenceSolution: _referenceSolution,
        tests: _tests,
        evaluator: _evaluator,
        ...safeItem
      } = raw as Record<string, unknown>;
      expect(practiceItemV2Schema.safeParse(safeItem).success).toBe(true);
      expect(safeItem).not.toHaveProperty("referenceSolution");
    }
  });

  it("rejects catalog pages larger than the 25-item response bound", () => {
    const fixture = {
      releaseId: "CURRICULUM-V2-TEST",
      items: [],
      total: 0,
      page: 1,
      pageSize: 26,
      totalPages: 0,
    };
    expect(practiceListSchema.safeParse(fixture).success).toBe(false);
  });
});
