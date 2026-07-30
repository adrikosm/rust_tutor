import { createFileRoute } from "@tanstack/react-router";
import { DashboardPage } from "../features/learning/LearnPages";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Home | Rust Tutor" }] }),
  component: DashboardPage,
});
