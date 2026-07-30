import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "../features/learning/SupportPages";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings | Rust Tutor" }] }),
  component: SettingsPage,
});
