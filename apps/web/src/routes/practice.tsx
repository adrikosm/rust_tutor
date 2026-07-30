import { createFileRoute, Outlet, useMatchRoute } from "@tanstack/react-router";
import { z } from "zod";
import { PracticePage, type PracticeView } from "../features/learning/PracticePages";

export const Route = createFileRoute("/practice")({
  head: () => ({ meta: [{ title: "Practice | Rust Tutor" }] }),
  validateSearch: (search) =>
    z
      .object({
        view: z.enum(["next", "rust", "interview", "questions"]).optional(),
        difficulty: z.string().max(40).optional(),
        page: z.coerce.number().int().min(1).optional(),
      })
      .parse(search),
  component: PracticeRoute,
});

function PracticeRoute() {
  const matchRoute = useMatchRoute();
  const search = Route.useSearch();
  return matchRoute({ to: "/practice", fuzzy: false }) ? (
    <PracticePage
      view={(search.view ?? "next") as PracticeView}
      difficulty={search.difficulty}
      page={search.page}
    />
  ) : (
    <Outlet />
  );
}
