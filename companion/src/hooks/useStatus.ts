import { companionApi } from "../api";
import type { DetectionStatus } from "../types";
import { useBackendResource } from "./useBackendResource";
import { useWindowVisible } from "./useWindowVisible";

const fetchStatus = () => companionApi.getStatus();

export function useStatus() {
  return useBackendResource<DetectionStatus>(fetchStatus, "status-changed", useWindowVisible());
}
