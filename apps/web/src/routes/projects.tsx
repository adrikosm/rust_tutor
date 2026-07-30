import { createFileRoute } from "@tanstack/react-router";
import { ProjectsPage } from "../features/learning/ProgressPages";

export const Route = createFileRoute("/projects")({
  head: () => ({ meta: [{ title: "Projects | Rust Tutor" }] }),
  component: ProjectsPage,
});
