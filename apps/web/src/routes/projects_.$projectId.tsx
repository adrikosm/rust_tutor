import { createFileRoute } from "@tanstack/react-router";
import { ProjectPage as ProjectExperience } from "../features/learning/ProgressPages";

export const Route = createFileRoute("/projects_/$projectId")({
  head: ({ params }) => ({
    meta: [{ title: `${params.projectId} · Project | Rust Tutor` }],
  }),
  component: ProjectPage,
});
function ProjectPage() {
  return <ProjectExperience projectId={Route.useParams().projectId} />;
}
