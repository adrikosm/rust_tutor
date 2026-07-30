import { createFileRoute } from "@tanstack/react-router";
import { UnifiedLessonPage } from "../features/learning/UnifiedLessonPage";

export const Route = createFileRoute("/lessons/$lessonId")({
  head: ({ params }) => ({
    meta: [{ title: `${params.lessonId} · Lesson | Rust Tutor` }],
  }),
  component: LessonRoute,
});

function LessonRoute() {
  return <UnifiedLessonPage lessonId={Route.useParams().lessonId} />;
}
