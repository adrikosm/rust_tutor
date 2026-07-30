import { createFileRoute } from "@tanstack/react-router";
import { CollectionPage } from "../features/learning/SupportPages";

export const Route = createFileRoute("/concepts/$conceptId")({
  head: ({ params }) => ({
    meta: [{ title: `${params.conceptId} · Concept | Rust Tutor` }],
  }),
  component: ConceptPage,
});
function ConceptPage() {
  return <CollectionPage area="Concept" detail={Route.useParams().conceptId} />;
}
