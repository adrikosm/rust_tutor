import { createFileRoute } from "@tanstack/react-router";
import { CurriculumModulePage } from "../features/learning/ProgressPages";

export const Route = createFileRoute("/curriculum_/$moduleId")({
  head: ({ params }) => ({
    meta: [{ title: `${params.moduleId} · Module | Rust Tutor` }],
  }),
  component: ModulePage,
});
function ModulePage() {
  return <CurriculumModulePage moduleId={Route.useParams().moduleId} />;
}
