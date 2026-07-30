import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { GraphPage } from "../features/learning/ProgressPages";

const graphSearch = z.object({
  id: z.string().max(100).optional(),
  kinds: z.string().max(240).optional(),
  depth: z.coerce.number().int().min(0).max(3).optional(),
});

export const Route = createFileRoute("/graph")({
  head: () => ({ meta: [{ title: "Knowledge Graph | Rust Tutor" }] }),
  validateSearch: (search) => graphSearch.parse(search),
  component: GraphRoute,
});

function GraphRoute() {
  const search = Route.useSearch();
  return <GraphPage selectedId={search.id} kinds={search.kinds} depth={search.depth} />;
}
