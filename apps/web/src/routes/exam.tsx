import { createFileRoute } from "@tanstack/react-router";
import { FinalExamPage } from "../features/learning/SupportPages";

export const Route = createFileRoute("/exam")({
  head: () => ({ meta: [{ title: "Final Exam | Rust Tutor" }] }),
  component: FinalExamPage,
});
