import { Navigate } from "@tanstack/react-router";
import type { Feature } from "@wiseroutine/plans/features";
import type { ReactNode } from "react";
import { useFeatures } from "../lib/features";

/** Guards direct URLs and responds to live rollback; disabled children never
 * mount, fetch their API or register keyboard/background handlers. */
export function FeaturePage({
  feature,
  children,
}: {
  feature: Feature;
  children: ReactNode;
}) {
  const flags = useFeatures();
  return flags[feature] ? children : <Navigate to="/" replace />;
}
