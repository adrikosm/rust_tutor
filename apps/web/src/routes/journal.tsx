import { createFileRoute } from "@tanstack/react-router";
import { JournalPage } from "../features/learning/SupportPages";

export const Route = createFileRoute("/journal")({
  head: () => ({ meta: [{ title: "Notebook | Rust Tutor" }] }),
  component: JournalPage,
});
