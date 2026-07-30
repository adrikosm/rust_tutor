import { createFileRoute } from "@tanstack/react-router";
import { PracticePage as RustWorkbenchPage } from "../features/learning/PracticePages";

export const Route = createFileRoute("/practice_/rust/$exerciseId")({
  head: ({ params }) => ({
    meta: [{ title: `${params.exerciseId} · Rust Practice | Rust Tutor` }],
  }),
  component: PracticePage,
});
function PracticePage() {
  return <RustWorkbenchPage exerciseId={Route.useParams().exerciseId} />;
}
