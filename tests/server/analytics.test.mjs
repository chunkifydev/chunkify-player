import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("analytics imports without a DOM and reports its package version", async () => {
  const { attachAnalytics } = await import("@chunkify/analytics");
  const pkg = JSON.parse(await readFile(new URL("../../packages/analytics/package.json", import.meta.url)));
  // HTML media is the external boundary. EventTarget suffices to inspect an
  // explicitly started attempt without constructing a browser DOM in Node.
  const media = Object.assign(new EventTarget(), { duration: NaN, src: "", currentSrc: "", ownerDocument: { defaultView: null } });
  const events = [];
  const session = attachAnalytics(media, { videoId: "asset-node", send: (event) => { events.push(event); } });
  assert.equal(events.length, 0);
  session.startAttempt();
  session.destroy();
  assert.equal(events.length, 2);
  assert.equal(events[0].sdk_version, pkg.version);
  assert.equal(events[0].connector_version, pkg.version);
});
