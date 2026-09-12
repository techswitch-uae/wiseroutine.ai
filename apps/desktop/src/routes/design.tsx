import { createFileRoute, notFound } from "@tanstack/react-router";
import { Gallery } from "@wiseroutine/design/gallery";

// The component gallery. `pnpm design` opens this directly.
export const Route = createFileRoute("/design")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  component: Gallery,
});
