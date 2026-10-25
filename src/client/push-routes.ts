import type { PushEvent } from "../transport/push/types.js";

/**
 * The two routes a push message reaches the SDK on: the FCM socket, and a station relaying the same
 * message over its P2P session.
 */
export type PushRoute = "fcm" | "station";

/**
 * How long one route's delivery waits for the other route's copy of the same message. The bound covers a
 * delayed FCM delivery, and it is the longest a delivery whose twin never comes can stand in for a later one.
 */
export const PUSH_ROUTE_WINDOW_MS = 30_000;

interface Delivery {
  route: PushRoute;
  at: number;
  uniqueId?: string;
  triggerTime?: number;
}

/**
 * Tells a push message's second delivery from a new message, so one detection is announced once whichever
 * route brings it first.
 *
 * A delivery cancels at most ONE earlier delivery, and only one from the OTHER route: two FCM pushes for one
 * device are two events, as they are without the relay, and each relayed copy pairs with exactly one push.
 * The pair must name the same device and `event_type`; where both copies carry a `unique_id`, or failing that
 * a `trigger_time`, those must agree too, so a twin that never arrived cannot absorb a different event.
 *
 * A message naming no device or no `event_type` is never a repeat: announcing it twice is recoverable,
 * suppressing a different device's event is not.
 */
export class PushRouteDedupe {
  private readonly pending = new Map<string, Delivery[]>();

  constructor(
    private readonly windowMs: number = PUSH_ROUTE_WINDOW_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** Record this delivery, answering `true` when it is the other route's copy of one already recorded. */
  repeat(route: PushRoute, event: PushEvent): boolean {
    if (!event.deviceSn || event.eventType == null) return false;
    const at = this.now();
    for (const [k, list] of this.pending) {
      const live = list.filter((d) => at - d.at <= this.windowMs);
      if (live.length) this.pending.set(k, live);
      else this.pending.delete(k);
    }
    const key = `${event.deviceSn}:${event.eventType}`;
    const delivery: Delivery = {
      route,
      at,
      uniqueId:
        typeof event.payload.unique_id === "string" && event.payload.unique_id ? event.payload.unique_id : undefined,
      triggerTime: typeof event.payload.trigger_time === "number" ? event.payload.trigger_time : undefined,
    };
    const list = this.pending.get(key) ?? [];
    const twin = list.findIndex((d) => d.route !== route && sameMessage(d, delivery));
    if (twin >= 0) {
      list.splice(twin, 1);
      return true;
    }
    list.push(delivery);
    this.pending.set(key, list);
    return false;
  }
}

/** Two deliveries agree on every identity both of them carry: `unique_id` first, else `trigger_time`. */
function sameMessage(a: Delivery, b: Delivery): boolean {
  if (a.uniqueId && b.uniqueId) return a.uniqueId === b.uniqueId;
  if (a.triggerTime != null && b.triggerTime != null) return a.triggerTime === b.triggerTime;
  return true;
}
