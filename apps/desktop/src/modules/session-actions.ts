import type { StartedSlot } from "@wiseroutine/scheduler";
import { createContext } from "react";
export const SessionActions = createContext<{ slot: StartedSlot } | null>(null);
