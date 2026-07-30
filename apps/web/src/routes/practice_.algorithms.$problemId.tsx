import { createFileRoute } from "@tanstack/react-router";
import { AlgorithmProblemPage } from "../features/learning/SupportPages";

export const Route = createFileRoute("/practice_/algorithms/$problemId")({
  head: ({ params }) => ({
    meta: [{ title: `${params.problemId} · Algorithm Practice | Rust Tutor` }],
  }),
  component: ProblemPage,
});
function ProblemPage() {
  return <AlgorithmProblemPage problemId={Route.useParams().problemId} />;
}
