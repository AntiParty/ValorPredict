import { companionApi } from "../api";
import type { DashboardData } from "../types";
import { useBackendResource } from "./useBackendResource";
import { useWindowVisible } from "./useWindowVisible";

const fetchDashboard = () => companionApi.getDashboard();

export function useDashboard() {
  return useBackendResource<DashboardData>(
    fetchDashboard,
    "dashboard-changed",
    useWindowVisible(),
  );
}
