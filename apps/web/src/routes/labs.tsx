import { createFileRoute } from "@tanstack/react-router";
import { SystemsLabPage } from "../features/learning/SupportPages";

export const Route = createFileRoute("/labs")({
  head: () => ({ meta: [{ title: "Systems Lab | Rust Tutor" }] }),
  component: SystemsLabPage,
});
