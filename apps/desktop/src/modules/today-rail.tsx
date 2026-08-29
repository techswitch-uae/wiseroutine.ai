import { DashboardWidgets } from "./dashboard";
import { SetupRail } from "./setup-rail";
import { ThisSlot } from "./this-slot";
import { ToPlace } from "./to-place";

/**
 * What stands in the rail beside the day.
 *
 * In order, and none of them knows about the others: `ThisSlot` returns null
 * until a block is pressed, `SetupRail` returns null once the wizard is done,
 * `ToPlace` returns null when the day owes nothing, and the modules return
 * null until there is a day to describe. So a first run shows the checklist
 * over an empty rail, and a finished one shows whatever is true - without any
 * of them having to ask what the others are doing.
 *
 * `ThisSlot` is first because it is the only one the user opened. Something
 * that appears in answer to a press has to appear where the eye already is,
 * not below two cards that were already there.
 */
export const TodayRail: React.FC = () => (
  <>
    <ThisSlot />
    <SetupRail />
    <ToPlace />
    <DashboardWidgets />
  </>
);
