import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useToast } from "../components/Toast";

interface MutationOptions<TData> {
  successMessage?: string | ((data: TData) => string);
  onSuccess?: (data: TData) => void;
}

// Shared wiring for every dashboard mutation: refetch the dashboard snapshot
// on success and surface a toast for both the success and error paths. The api
// client throws ApiError (extends Error) carrying the server message, so
// error.message is the human-readable reason from the backend.
export function useDashboardMutation<TVars = void, TData = unknown>(
  mutationFn: (vars: TVars) => Promise<TData>,
  options: MutationOptions<TData> = {},
) {
  const queryClient = useQueryClient();
  const { push } = useToast();

  return useMutation({
    mutationFn,
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      const message =
        typeof options.successMessage === "function"
          ? options.successMessage(data)
          : options.successMessage;
      if (message) {
        push({ kind: "success", message });
      }
      options.onSuccess?.(data);
    },
    onError: (error) => {
      push({
        kind: "error",
        message: error instanceof Error ? error.message : "Something went wrong.",
      });
    },
  });
}
