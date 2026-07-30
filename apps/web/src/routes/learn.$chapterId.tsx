import { createFileRoute } from "@tanstack/react-router";
import { UnifiedLessonPage } from "../features/learning/UnifiedLessonPage";

export const Route = createFileRoute("/learn/$chapterId")({
  head: ({ params }) => ({
    meta: [{ title: `${params.chapterId} · Learn | Rust Tutor` }],
  }),
  component: LearnChapterRoute,
});

function LearnChapterRoute() {
  return <UnifiedLessonPage lessonId={Route.useParams().chapterId} />;
}
