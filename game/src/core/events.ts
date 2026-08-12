/**
 * Tiny typed event bus. Gameplay systems (HUD, art layer, and later the
 * multiplayer room) subscribe to gameplay events without coupling to the
 * scene — multiplayer becomes "forward these events to a peer".
 */
export class Emitter<Events extends Record<string, unknown>> {
  private readonly handlers = new Map<
    keyof Events,
    Set<(payload: never) => void>
  >();

  /** Subscribe; returns an unsubscribe function. */
  on<K extends keyof Events>(
    event: K,
    fn: (payload: Events[K]) => void,
  ): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(fn as (payload: never) => void);
    return () => {
      set.delete(fn as (payload: never) => void);
    };
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const fn of set) {
      (fn as (payload: Events[K]) => void)(payload);
    }
  }
}
