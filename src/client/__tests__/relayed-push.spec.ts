import { describe, it, expect, vi, beforeEach } from "vitest";
import { EufyMega } from "../eufy-mega.js";
import { PushClient } from "../../transport/push/push-client.js";
import type { P2PFrame } from "../../transport/p2p/p2p-session.js";

/**
 * A HomeBase relays a detection's push body over its P2P session ahead of the FCM push for the same
 * detection. Both bodies decode through the same capability tables, and the detection is announced once
 * whichever arrives first — while two real detections, each with its own pair, are both announced.
 *
 * The FCM socket is not opened: the store supplies persisted credentials and `connect` is answered locally.
 * The relayed frame enters through the private frame handler the P2P router calls.
 */
const STATION = "T8000P0000000000";
const CAM = "T8000P0000000001";
const MOTION = 3101;

const body = (uniqueId: string) => ({
  msg_type: 18,
  event_type: MOTION,
  device_sn: CAM,
  channel: 1,
  trigger_time: 1_700_000_000_000,
  unique_id: uniqueId,
});

const relayed = (uniqueId: string): P2PFrame =>
  ({
    stationSn: STATION,
    commandId: 1351,
    commandName: "CMD_NOTIFY_PAYLOAD",
    channel: 255,
    signCode: 1,
    bytesToRead: 0,
    type: 2,
    dataType: 2,
    data: Buffer.alloc(0),
    raw: Buffer.alloc(0),
    json: { cmd: 2037, payload: JSON.stringify(body(uniqueId)) },
    relayedPush: { cmd: 2037, payload: JSON.stringify(body(uniqueId)) },
  }) as P2PFrame;

async function started() {
  const eufy = new EufyMega({
    email: "t@example.com",
    password: "x",
    pushStore: {
      load: () => ({
        creds: { fid: "f", androidId: "0", securityToken: "0", fcmToken: "t", createdAt: 0 },
        persistentIds: [],
      }),
      save: () => {},
      clear: () => {},
    },
  });
  Object.defineProperty((eufy as any).mega, "auth", {
    configurable: true,
    get: () => ({ userId: "u", authToken: "t" }),
  });
  vi.spyOn((eufy as any).mega, "registerPushToken").mockResolvedValue(undefined);
  const registry = (eufy as any).registry;
  vi.spyOn(registry, "capabilitiesForDevice").mockReturnValue(new Set(["motion"]));
  vi.spyOn(registry, "capabilitiesForFrame").mockReturnValue(undefined);
  vi.spyOn(registry, "serialForFrame").mockReturnValue(undefined);
  vi.spyOn(PushClient.prototype, "connect").mockImplementation(function (this: PushClient) {
    this.emit("connect");
  });
  const client: PushClient = await (eufy as any).startPush();
  const motions: unknown[] = [];
  eufy.on("motion", (e) => motions.push(e));
  const fcm = (uniqueId: string) =>
    client.emit("push", { deviceSn: CAM, stationSn: STATION, eventType: MOTION, payload: body(uniqueId) });
  const station = (uniqueId: string) => (eufy as any).onP2PFrame(STATION, relayed(uniqueId));
  return { eufy, motions, fcm, station };
}

describe("relayed push", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("announces a detection the station relays, with no FCM push at all", async () => {
    const c = await started();
    c.station("a".repeat(32));
    expect(c.motions).toEqual([expect.objectContaining({ deviceSn: CAM })]);
  });

  it("announces once when the relay precedes the FCM push", async () => {
    const c = await started();
    c.station("a".repeat(32));
    c.fcm("a".repeat(32));
    expect(c.motions).toHaveLength(1);
  });

  it("announces once when the FCM push precedes the relay", async () => {
    const c = await started();
    c.fcm("a".repeat(32));
    c.station("a".repeat(32));
    expect(c.motions).toHaveLength(1);
  });

  it("announces two real detections, each delivered on both routes, twice", async () => {
    const c = await started();
    c.station("a".repeat(32));
    c.fcm("a".repeat(32));
    c.station("b".repeat(32));
    c.fcm("b".repeat(32));
    expect(c.motions).toHaveLength(2);
  });

  it("still emits the raw push for an FCM copy it does not announce", async () => {
    const c = await started();
    const raw: unknown[] = [];
    c.eufy.on("push", (p) => raw.push(p));
    c.station("a".repeat(32));
    c.fcm("a".repeat(32));
    expect(raw).toHaveLength(1);
    expect(c.motions).toHaveLength(1);
  });
});
