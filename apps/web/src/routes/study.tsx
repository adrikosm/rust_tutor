import { createFileRoute } from "@tanstack/react-router";
import { StudyHubPage } from "../features/study/StudyPages";

export const Route = createFileRoute("/study")({
  head: () => ({
    meta: [
      { title: "Study | Rust Tutor" },
      {
        name: "description",
        content:
          "Randomised chapter, strand, and mixed tests plus spaced flashcards built on retrieval practice.",
      },
    ],
  }),
  component: StudyHubPage,
});
