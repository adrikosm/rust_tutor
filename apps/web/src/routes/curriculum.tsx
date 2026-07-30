import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { CurriculumPage } from "../features/learning/ProgressPages";

export const Route = createFileRoute("/curriculum")({
  head: () => ({ meta: [{ title: "Learning Path | Rust Tutor" }] }),
  validateSearch: (search) =>
    z
      .object({
        q: z.string().max(120).optional(),
        track: z.string().max(20).optional(),
      })
      .parse(search),
  component: CurriculumRoute,
});

function CurriculumRoute() {
  const search = Route.useSearch();
  return <CurriculumPage query={search.q} track={search.track} />;
}
