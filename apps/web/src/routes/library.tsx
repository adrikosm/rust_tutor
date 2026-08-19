import { createFileRoute } from "@tanstack/react-router";
import { ReferenceLibraryPage } from "../features/learning/ReferenceLibraryPage";

export const Route = createFileRoute("/library")({
  head: () => ({
    meta: [
      { title: "Reference library | Rust Tutor" },
      {
        name: "description",
        content:
          "A curated library of Rust books, references, and exercise repositories mapped to the lessons that need them.",
      },
    ],
  }),
  component: ReferenceLibraryPage,
});
