import { createFileRoute } from "@tanstack/react-router";
import { ReviewPage } from "../features/learning/ProgressPages";

export const Route = createFileRoute("/review")({
  head: () => ({ meta: [{ title: "Review Queue | Rust Tutor" }] }),
  component: ReviewPage,
});
