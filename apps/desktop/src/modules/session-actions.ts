import { createContext } from "react";
export const SessionActions = createContext<{ postpone: () => void } | null>(
  null,
);
