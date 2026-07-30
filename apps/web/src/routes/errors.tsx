import { createFileRoute } from "@tanstack/react-router";
import { ErrorCatalogPage } from "../features/learning/SupportPages";

export const Route = createFileRoute("/errors")({
  head: () => ({ meta: [{ title: "Error Catalog | Rust Tutor" }] }),
  component: ErrorCatalogPage,
});
