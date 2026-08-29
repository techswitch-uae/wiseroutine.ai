import { DashboardModules } from "./dashboard";
import { SetupRail } from "./setup-rail";

/**
 * What stands in the rail beside the day.
 *
 * Both, in order, and neither knows about the other: `SetupRail` returns null
 * once the wizard is done, and the modules return null until there is a day to
 * describe. So a first run shows the checklist over an empty rail, and a
 * finished one shows the modules alone - without either component having to
 * ask what the other is doing.
 */
export const TodayRail: React.FC = () => (
  <>
    <SetupRail />
    <DashboardModules />
  </>
);
