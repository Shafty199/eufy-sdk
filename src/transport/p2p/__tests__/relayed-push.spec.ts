import { P2PSession } from "../p2p-session.js";

/**
 * A station relays a push message over its session as a `CMD_NOTIFY_PAYLOAD` whose inner `cmd` is 2037 and
 * whose `payload` is the push body as a JSON string. The session recognises the shape and hands the envelope
 * over untouched; reading the body is not a transport concern. Driven through the private frame handler.
 */
const handle = (json: unknown, commandId = 1351) => {
  const session = new P2PSession({ stationSn: "T8000P0000000000", p2pDid: "XXXXXXX-000000-XXXXX" });
  const frames: { relayedPush?: Record<string, unknown> }[] = [];
  session.on("data", (f) => frames.push(f));
  const body = Buffer.concat([Buffer.from(JSON.stringify(json), "utf8"), Buffer.from([0])]);
  (session as unknown as { handleFrame(h: unknown, p: Buffer, d: number): void }).handleFrame(
    { commandId, channel: 255, signCode: 0, bytesToRead: body.length },
    body,
    0,
  );
  return frames[0];
};

const relay = {
  cmd: 2037,
  payload: JSON.stringify({ msg_type: 18, event_type: 3101, device_sn: "T8000P0000000001", channel: 1 }),
};

describe("P2P frame — relayed push", () => {
  it("hands over the envelope of a notify that relays a push body", () => {
    expect(handle(relay)?.relayedPush).toEqual(relay);
  });

  it("ignores the same inner cmd under any other outer command", () => {
    expect(handle(relay, 1350)?.relayedPush).toBeUndefined();
  });

  it("ignores a 2037 notify whose payload is not a string body", () => {
    expect(handle({ cmd: 2037, payload: { event_type: 3101 } })?.relayedPush).toBeUndefined();
  });

  it("ignores every other notify", () => {
    expect(handle({ cmd: 6246, payload: { num: 1 } })?.relayedPush).toBeUndefined();
  });
});
