import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { FlashcardsPage } from "../features/study/StudyPages";

const cardsSearch = z.object({
  chapter: z.string().max(64).optional(),
});

export const Route = createFileRoute("/study_/cards")({
  head: () => ({ meta: [{ title: "Flashcards | Rust Tutor" }] }),
  validateSearch: (search) => cardsSearch.parse(search),
  component: CardsRoute,
});

function CardsRoute() {
  const { chapter } = Route.useSearch();
  return <FlashcardsPage key={chapter ?? "all"} chapter={chapter} />;
}
