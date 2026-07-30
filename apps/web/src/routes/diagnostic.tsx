import { createFileRoute } from "@tanstack/react-router";
import { DiagnosticPage } from "../features/learning/ProgressPages";

export const Route = createFileRoute("/diagnostic")({
  head: () => ({ meta: [{ title: "Diagnostic | Rust Tutor" }] }),
  component: DiagnosticPage,
});
