// A fake `@tauri-apps/api/event` for tests. Use:
//   vi.mock("@tauri-apps/api/event", () => import("../test/tauriEvents").then((m) => m.eventModule));
// then `emitBackendEvent("status-changed", payload)` inside `act`.
type Handler = (event: { payload: unknown }) => void;

const handlers = new Map<string, Set<Handler>>();

export const eventModule = {
  listen: async (name: string, handler: Handler) => {
    const set = handlers.get(name) ?? new Set<Handler>();
    set.add(handler);
    handlers.set(name, set);
    return () => {
      set.delete(handler);
    };
  },
};

export function emitBackendEvent(name: string, payload: unknown = null) {
  for (const handler of [...(handlers.get(name) ?? [])]) handler({ payload });
}

export function listenerCount(name: string): number {
  return handlers.get(name)?.size ?? 0;
}

export function resetBackendEvents() {
  handlers.clear();
}
