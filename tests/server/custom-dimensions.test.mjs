import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

// HTML media is the external boundary; an EventTarget stands in for the media element.
function fakeMedia() {
  const listeners = [];
  const media = Object.assign(new EventTarget(), { duration: 100, currentTime: 0, src: "video.mp4",
    currentSrc: "video.mp4", ownerDocument: { defaultView: null } });
  const add = media.addEventListener.bind(media);
  media.addEventListener = (name, listener) => { listeners.push(name); add(name, listener); };
  return { media, listeners };
}

async function record(custom, play = (session) => { session.startAttempt(); session.destroy(); }) {
  const { attachAnalytics } = await import("@chunkify/player-analytics");
  const { media } = fakeMedia();
  const events = [];
  const options = { videoId: "custom", destinations: [{ send(event) { events.push(event); } }] };
  if (custom !== undefined) options.custom = custom;
  play(attachAnalytics(media, options), media);
  return events;
}

test("custom dimensions are sent unchanged on view_started only", async () => {
  const custom = { plan: "premium", ab_test: "B", seats: 5, trial: false, ratio: -0.25, z: "\u{1F600}".repeat(256) };
  const events = await record(custom, (session, media) => {
    session.startAttempt();
    media.dispatchEvent(new Event("playing"));
    media.dispatchEvent(new Event("ended"));
    session.destroy();
  });
  assert.ok(events.length > 2);
  const started = events.filter((event) => event.event_name === "chunkify.video.view_started");
  assert.equal(started.length, 1);
  assert.deepEqual(started[0].custom, custom);
  assert.ok(Object.keys(started[0]).indexOf("custom") > Object.keys(started[0]).indexOf("video_title"));
  for (const event of events.filter((event) => event.event_name !== "chunkify.video.view_started")) {
    assert.equal(Object.hasOwn(event, "custom"), false, event.event_name);
  }
});

test("custom dimensions are omitted when absent, null or empty", async () => {
  for (const custom of [undefined, null, {}]) {
    const events = await record(custom);
    assert.equal(Object.hasOwn(events[0], "custom"), false);
  }
});

test("the same custom dimensions start every view, including after a source change", async () => {
  const custom = { plan: "premium", seats: 5 };
  const events = await record(custom, (session, media) => {
    session.startAttempt();
    custom.plan = "free"; // The option is fixed at startup.
    delete custom.seats;
    session.sourceChanged();
    session.startAttempt();
    media.dispatchEvent(new Event("ended"));
    session.startAttempt();
    session.destroy();
  });
  const started = events.filter((event) => event.event_name === "chunkify.video.view_started");
  assert.equal(started.length, 3);
  assert.equal(new Set(started.map((event) => event.view_id)).size, 3);
  for (const event of started) assert.deepEqual(event.custom, { plan: "premium", seats: 5 });
  // Each event gets its own copy, so a destination that mutates one cannot affect the next view.
  started[0].custom.plan = "changed";
  assert.equal(started[1].custom.plan, "premium");
});

test("valid custom shapes are accepted", async () => {
  const tenKeys = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, i]));
  const otherRealm = vm.runInNewContext('({ plan: "premium" })');
  for (const custom of [tenKeys, { ["a".repeat(40)]: "x" }, { _0: 0, n: Number.MAX_VALUE, t: true },
    { s: " " }, { s: "a".repeat(256) }, Object.assign(Object.create(null), { plan: "premium" }), otherRealm]) {
    const events = await record(custom);
    assert.deepEqual({ ...events[0].custom }, { ...custom });
  }
});

test("invalid custom options throw at init before installing listeners", async () => {
  const { attachAnalytics } = await import("@chunkify/player-analytics");
  const tooMany = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, i]));
  const hidden = Object.defineProperty({}, "plan", { value: "premium", enumerable: false });
  const getter = Object.defineProperty({}, "plan", { get: () => "premium", enumerable: true });
  const cases = [
    ["plan", /plain object/], [0, /plain object/], [false, /plain object/], [[], /plain object/], [[["plan", "x"]], /plain object/],
    [new Map([["plan", "x"]]), /plain object/], [new (class Custom { plan = "x"; })(), /plain object/],
    [new Date(), /plain object/],
    [tooMany, /at most 10 keys/],
    [{ Plan: "x" }, /keys must match/], [{ "ab-test": "x" }, /keys must match/], [{ "": "x" }, /keys must match/],
    [{ ["a".repeat(41)]: "x" }, /keys must match/], [{ "plan ": "x" }, /keys must match/],
    [{ é: "x" }, /keys must match/], [{ [Symbol("plan")]: "x" }, /keys must match/],
    [{ plan: null }, /custom\.plan must be/], [{ plan: undefined }, /custom\.plan must be/],
    [{ plan: "" }, /custom\.plan must be/], [{ plan: "a".repeat(257) }, /custom\.plan must be/],
    [{ plan: "\u{1F600}".repeat(257) }, /custom\.plan must be/],
    [{ plan: NaN }, /custom\.plan must be/], [{ plan: Infinity }, /custom\.plan must be/],
    [{ plan: -Infinity }, /custom\.plan must be/], [{ plan: 1n }, /custom\.plan must be/],
    [{ plan: {} }, /custom\.plan must be/], [{ plan: ["a"] }, /custom\.plan must be/],
    [{ plan: () => "x" }, /custom\.plan must be/], [hidden, /custom\.plan must be/], [getter, /custom\.plan must be/],
  ];
  for (const [custom, message] of cases) {
    const { media, listeners } = fakeMedia();
    let sent = false;
    assert.throws(() => attachAnalytics(media, { videoId: "custom", custom,
      destinations: [{ send() { sent = true; } }] }), (error) => error instanceof TypeError && message.test(error.message),
    String(custom?.toString?.() ?? custom));
    assert.deepEqual(listeners, []);
    assert.equal(sent, false);
  }
});

test("emoji values count Unicode characters, not UTF-16 units", async () => {
  const value = "\u{1F600}".repeat(256); // 512 UTF-16 units.
  assert.equal((await record({ v: value }))[0].custom.v, value);
});

test("an own __proto__ key is kept, not treated as the prototype", async () => {
  const custom = JSON.parse('{"__proto__": "x", "plan": "premium"}');
  const event = (await record(custom))[0];
  assert.equal(Object.hasOwn(event.custom, "__proto__"), true);
  assert.equal(JSON.stringify(event.custom), '{"__proto__":"x","plan":"premium"}');
  const only = (await record(JSON.parse('{"__proto__": 1}')))[0];
  assert.equal(JSON.stringify(only.custom), '{"__proto__":1}');
});

test("strings with lone surrogates are rejected or repaired so every event is well-formed JSON", async () => {
  const { attachAnalytics } = await import("@chunkify/player-analytics");
  for (const [options, message] of [
    [{ custom: { plan: "a\uD800" } }, /custom\.plan must be/], [{ custom: { plan: "\uDC00b" } }, /custom\.plan must be/],
    [{ userId: "user\uD800" }, /userId must not contain lone surrogates/],
    [{ videoId: "video\uDFFF" }, /videoId must not contain lone surrogates/],
    [{ environment: "\uD800" }, /environment must not contain lone surrogates/],
  ]) {
    const { media, listeners } = fakeMedia();
    assert.throws(() => attachAnalytics(media, { videoId: "custom", destinations: [{ send() {} }], ...options }),
      message, JSON.stringify(options));
    assert.deepEqual(listeners, []);
  }
  const { media } = fakeMedia();
  const events = [];
  // Paired surrogates are fine; a title from content is repaired instead of rejected.
  const session = attachAnalytics(media, { videoId: "custom", userId: "\u{1F600}", videoTitle: "Title \uD800 end",
    custom: { emoji: "\u{1F600}" }, destinations: [{ send(event) { events.push(event); } }] });
  session.startAttempt();
  session.destroy();
  assert.equal(events[0].video_title, "Title � end");
  assert.equal(events[0].user_id, "\u{1F600}");
  assert.equal(events[0].custom.emoji, "\u{1F600}");
});
