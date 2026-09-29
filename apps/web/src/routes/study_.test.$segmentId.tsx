import { createFileRoute } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { z } from "zod";
import { SegmentTestPage } from "../features/study/StudyPages";

const testSearch = z.object({
  mode: z.enum(["exam", "practice", "pretest"]).optional(),
  seed: z.coerce.number().int().min(0).max(0xffffffff).optional(),
});

export const Route = createFileRoute("/study_/test/$segmentId")({
  head: ({ params }) => ({ meta: [{ title: `${params.segmentId} test | Rust Tutor` }] }),
  validateSearch: (search) => testSearch.parse(search),
  component: TestRoute,
});

function TestRoute(): ReactElement {
  const { segmentId } = Route.useParams();
  // Re-decoding keeps this component's types independent of the generated
  // route tree, which otherwise forms an inference cycle through StudyPages.
  const { mode, seed } = testSearch.parse(Route.useSearch());
  return (
    <SegmentTestPage
      key={`${segmentId}:${mode ?? "exam"}:${seed ?? ""}`}
      segmentId={segmentId}
      mode={mode ?? "exam"}
      seed={seed}
    />
  );
}
