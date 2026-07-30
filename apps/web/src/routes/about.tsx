import { createFileRoute } from "@tanstack/react-router";
import { AboutPage } from "../features/learning/SupportPages";

export const Route = createFileRoute("/about")({
  head: () => ({ meta: [{ title: "About | Rust Tutor" }] }),
  component: AboutPage,
});
