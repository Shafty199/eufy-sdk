import { PushRouteDedupe } from "../push-routes.js";
import type { PushEvent } from "../../transport/push/types.js";

/**
 * One detection reaches the SDK twice — relayed by the station over P2P, then as the FCM push — and is
 * announced once. The pairing is one-for-one and across routes only, so consecutive real events, which a
 * motion or a doorbell press legitimately produces, are never collapsed.
 */
const CAM = "T8000P0000000001";
const OTHER = "T8000P0000000002";
const MOTION = 3101;
const PERSON = 3102;

const ev = (payload: Record<string, unknown> = {}, deviceSn = CAM, eventType = MOTION) =>
  ({ deviceSn, eventType, payload, raw: { payload: {} } }) as PushEvent;

const clock = () => {
  let t = 0;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};

describe("push route dedupe", () => {
  it("announces the relay and swallows the FCM copy that follows", () => {
    const d = new PushRouteDedupe();
    expect(d.repeat("station", ev())).toBe(false);
    expect(d.repeat("fcm", ev())).toBe(true);
  });

  it("works the same when FCM arrives first", () => {
    const d = new PushRouteDedupe();
    expect(d.repeat("fcm", ev())).toBe(false);
    expect(d.repeat("station", ev())).toBe(true);
  });

  it("never collapses two deliveries from the same route", () => {
    const d = new PushRouteDedupe();
    expect(d.repeat("fcm", ev())).toBe(false);
    expect(d.repeat("fcm", ev())).toBe(false);
    expect(d.repeat("station", ev())).toBe(true);
    expect(d.repeat("station", ev())).toBe(true);
    expect(d.repeat("station", ev())).toBe(false);
  });

  it("pairs one relay with exactly one push", () => {
    const d = new PushRouteDedupe();
    expect(d.repeat("station", ev())).toBe(false);
    expect(d.repeat("fcm", ev())).toBe(true);
    expect(d.repeat("fcm", ev())).toBe(false);
  });

  it("does not pair different devices or different event types", () => {
    const d = new PushRouteDedupe();
    expect(d.repeat("station", ev())).toBe(false);
    expect(d.repeat("fcm", ev({}, OTHER))).toBe(false);
    expect(d.repeat("fcm", ev({}, CAM, PERSON))).toBe(false);
  });

  it("does not pair copies whose unique_id disagrees", () => {
    const d = new PushRouteDedupe();
    expect(d.repeat("station", ev({ unique_id: "a".repeat(32) }))).toBe(false);
    expect(d.repeat("fcm", ev({ unique_id: "b".repeat(32) }))).toBe(false);
    expect(d.repeat("fcm", ev({ unique_id: "a".repeat(32) }))).toBe(true);
  });

  it("falls back to trigger_time when either copy lacks a unique_id", () => {
    const d = new PushRouteDedupe();
    expect(d.repeat("station", ev({ unique_id: "a".repeat(32), trigger_time: 1000 }))).toBe(false);
    expect(d.repeat("fcm", ev({ trigger_time: 2000 }))).toBe(false);
    expect(d.repeat("fcm", ev({ trigger_time: 1000 }))).toBe(true);
  });

  it("pairs copies that carry no identity at all", () => {
    const d = new PushRouteDedupe();
    expect(d.repeat("station", ev({ unique_id: "a".repeat(32) }))).toBe(false);
    expect(d.repeat("fcm", ev())).toBe(true);
  });

  it("lets a delivery whose twin never came stand in only for the window", () => {
    const c = clock();
    const d = new PushRouteDedupe(30_000, c.now);
    expect(d.repeat("station", ev())).toBe(false);
    c.advance(30_001);
    expect(d.repeat("fcm", ev())).toBe(false);
  });

  it("never treats a message without a device or an event type as a repeat", () => {
    const d = new PushRouteDedupe();
    const anonymous = { eventType: MOTION, payload: {}, raw: { payload: {} } } as PushEvent;
    expect(d.repeat("station", anonymous)).toBe(false);
    expect(d.repeat("fcm", anonymous)).toBe(false);
    const untyped = { deviceSn: CAM, payload: {}, raw: { payload: {} } } as PushEvent;
    expect(d.repeat("station", untyped)).toBe(false);
    expect(d.repeat("fcm", untyped)).toBe(false);
  });
});
