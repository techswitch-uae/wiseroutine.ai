import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ActivityDraft, ActivityForm } from "@wiseroutine/design";
import { useState } from "react";
import { expect, test } from "vitest";

// biome-ignore lint/style/useComponentExportOnlyModules: controlled test harness
function Form() {
  const [draft, setDraft] = useState<ActivityDraft>({
    name: "Deep work",
    kind: "focus",
    sessionMinutes: 25,
    perDay: 4,
    days: 127,
    land: "any",
  });
  return <ActivityForm draft={draft} onChange={setDraft} />;
}

test("duration immediately reduces frequency when necessary, without silently increasing it later", async () => {
  const user = userEvent.setup();
  render(<Form />);
  const more = screen.getByRole("button", { name: "How often: more" });
  expect(more).toBeDisabled();
  expect(screen.getByText(/Up to 4 × day at this length/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "How long: more" }));
  expect(screen.getByText("30 min")).toBeVisible();
  expect(screen.getByText("4 × day")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "How long: more" }));
  expect(screen.getByText("35 min")).toBeVisible();
  expect(screen.getByText("3 × day")).toBeVisible();
  expect(more).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "How long: less" }));
  expect(screen.getByText("3 × day")).toBeVisible();
  expect(more).toBeEnabled();
  await user.click(more);
  expect(screen.getByText("4 × day")).toBeVisible();
});
