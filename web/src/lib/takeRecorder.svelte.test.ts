import { describe, expect, it } from 'vitest';
import type { Clip, Track } from './api';
import { Saves } from './saves.svelte';
import { emptySong, FakeSongServer } from './songServerFake';
import { TakeRecorder, type TakeRecorderOptions } from './takeRecorder.svelte';
import { FakeCalibrations, FakeInput, FakeKeeping, FakePlayer, guitar, mic } from './takeRecorderFakes';

/** The context time the fake player starts playback at. */
const startedAt = 10;

const track = (id: number, clips: Clip[] = []): Track => ({
  id,
  name: `Track ${id}`,
  volume: 0,
  muted: false,
  soloed: false,
  clips,
});

/** A Clip of one Take, recorded 1s before its start, as a Take is. */
const takeClip = (id: number, start: number, length: number, takeId = id * 10): Clip => ({
  id,
  beatId: null,
  soundId: null,
  name: null,
  gain: 0,
  tempo: 1,
  pitch: 0,
  fadeIn: 0,
  fadeOut: 0,
  takes: [
    {
      id: takeId,
      number: 1,
      size: 0,
      duration: length + 1,
      sampleRate: 100,
      latencyOffset: 0,
      position: 0,
      nudge: 0,
      recordedAt: '',
    },
  ],
  activeTakeId: takeId,
  start,
  offset: 1,
  length,
});

/** A recorder for a Song on the server holding tracks, as the Timeline makes one, with fakes for its ports. */
async function setup(tracks: Track[] = [track(1), track(2)], options: Partial<TakeRecorderOptions> = {}) {
  const server = new FakeSongServer(emptySong(), tracks);
  const [song, timeline] = await Promise.all([server.getSong(), server.getTimeline()]);
  const saves = new Saves({ server, song, timeline });
  const player = new FakePlayer(startedAt);
  const input = new FakeInput();
  const keeping = new FakeKeeping();
  // Every Input the fake records from is calibrated, unless a test says otherwise.
  const calibrations = new FakeCalibrations({ offset: 0, offered: true });
  /** The errors the recorder said, in order. */
  const errors: string[] = [];
  const onError = (message: string) => errors.push(message);
  const recorder = new TakeRecorder({
    saves,
    player,
    input,
    keeping,
    calibrations,
    uploads: server,
    onError,
    ...options,
  });
  /** Sings for seconds from the start of playback, lead-in included. */
  const sing = (seconds: number) => input.opened!.sing(startedAt, seconds);
  return { server, saves, player, input, keeping, calibrations, recorder, errors, sing };
}

/** Lets everything waiting on the fakes run. */
const settled = () => new Promise((done) => setTimeout(done));

describe('TakeRecorder', () => {
  it('records a new Take on the Chosen Track at the playhead, and saves it there', async () => {
    const { server, player, keeping, recorder, sing, errors } = await setup();

    await recorder.start({ trackId: 1, playhead: 5 });
    expect(recorder.phase).toBe('recording');
    expect(recorder.plan).toEqual({ start: 5, from: 3 });
    expect(player.played).toEqual([3]);
    // Kept in the browser as it's recorded.
    expect(keeping.takes).toMatchObject([{ songId: 1, trackId: 1, clipId: null, plan: { start: 5, from: 3 } }]);

    sing(4);
    expect(recorder.liveTiles(0.01).flat().length).toBeGreaterThan(0);
    await recorder.stop();

    expect(recorder.phase).toBeNull();
    expect(errors).toEqual([]);
    expect(player.playing).toBe(false);
    const [clip] = server.timeline.tracks[0].clips;
    expect(clip).toMatchObject({ start: 5, length: 2 });
    expect(clip.takes).toHaveLength(1);
    expect(server.timeline.tracks[1].clips).toEqual([]);
    // Saved, it's no longer kept.
    await settled();
    expect(keeping.takes).toEqual([]);
  });

  it('records a Retake into its Clip, from its start, and saves it as its active Take', async () => {
    const { server, player, recorder, sing } = await setup([track(1, [takeClip(7, 4, 3)])]);

    await recorder.start({ trackId: 1, playhead: 0, retake: 7 });
    expect(recorder.clipId).toBe(7);
    expect(player.played).toEqual([2]);
    sing(4);
    await recorder.stop();

    const [clip] = server.timeline.tracks[0].clips;
    expect(clip.takes.map((t) => t.id)).toEqual([70, 71]);
    expect(clip.activeTakeId).toBe(71);
    expect(recorder.phase).toBeNull();
  });

  it('keeps nothing from a recording stopped during the lead-in, and forgets the copy kept', async () => {
    const { server, keeping, recorder, sing, errors } = await setup();

    await recorder.start({ trackId: 1, playhead: 5 });
    sing(1.5);
    await recorder.stop();
    await settled();

    expect(errors).toEqual(['Recording stopped during the lead-in, so there was nothing to keep.']);
    expect(recorder.phase).toBeNull();
    expect(server.landed).toBe(0);
    expect(keeping.takes).toEqual([]);
    expect(recorder.unsaved).toEqual([]);
  });

  it("says why recording can't start where that's known before opening the Input", async () => {
    const { player, input, recorder, errors } = await setup();
    input.problemFound = "Bandmate isn't allowed to use the microphone.";

    await recorder.start({ trackId: 1, playhead: 0 });

    expect(errors).toEqual(["Bandmate isn't allowed to use the microphone."]);
    expect(recorder.phase).toBeNull();
    expect(input.opened).toBeNull();
    expect(player.played).toEqual([]);
  });

  it("says why the Input couldn't be opened", async () => {
    const { player, input, recorder, errors } = await setup();
    input.failing = 'The audio input is busy or unavailable.';

    await recorder.start({ trackId: 1, playhead: 0 });

    expect(errors).toEqual(['The audio input is busy or unavailable.']);
    expect(recorder.phase).toBeNull();
    expect(player.played).toEqual([]);
  });

  it('fails a Retake whose Clip is gone by the time the Input opens, letting go of the Input', async () => {
    const { server, saves, player, input, keeping, recorder, errors } = await setup([track(1, [takeClip(7, 4, 3)])]);
    const opening = input.holdOpen();

    const started = recorder.start({ trackId: 1, playhead: 0, retake: 7 });
    await saves.edit({ kind: 'deleteClip', clipId: 7 });
    opening();
    await started;

    expect(errors).toEqual(['The Clip to retake is gone.']);
    expect(recorder.phase).toBeNull();
    expect(input.opened!.closed).toBe(true);
    expect(player.played).toEqual([]);
    expect(keeping.takes).toEqual([]);
    expect(server.timeline.tracks[0].clips).toEqual([]);
  });

  it('places a Take by the Latency Offset of the Input it was recorded from', async () => {
    const { server, input, recorder, sing, calibrations } = await setup();
    calibrations.set(mic, { offset: 0.03, offered: true });
    calibrations.set(guitar, { offset: 0.05, offered: true });
    input.reported = 0.01;

    input.recordsFrom = guitar;
    await recorder.start({ trackId: 1, playhead: 5 });
    sing(4);
    await recorder.stop();
    input.recordsFrom = mic;
    await recorder.start({ trackId: 2, playhead: 5 });
    sing(4);
    await recorder.stop();

    expect(server.timeline.tracks[0].clips[0].takes[0].latencyOffset).toBe(0.05);
    expect(server.timeline.tracks[1].clips[0].takes[0].latencyOffset).toBe(0.03);
  });

  it('places a Take from an Input whose calibration was skipped by the latency the browser reports', async () => {
    const { server, input, recorder, sing, calibrations } = await setup();
    calibrations.set(guitar, { offset: null, offered: true });
    input.recordsFrom = guitar;
    input.reported = 0.01;

    await recorder.start({ trackId: 1, playhead: 5 });
    sing(4);
    await recorder.stop();

    expect(server.timeline.tracks[0].clips[0].takes[0].latencyOffset).toBe(0.01);
  });

  it("offers calibration of an Input before its first recording, and records nothing till it's calibrated or skipped", async () => {
    const offers: unknown[] = [];
    const { server, input, player, keeping, recorder, errors, calibrations } = await setup(undefined, {
      onUncalibrated: (offered, start, reported) => offers.push({ offered, start, reported }),
    });
    calibrations.others = { offset: null, offered: false };
    calibrations.set(mic, { offset: 0.03, offered: true });
    input.recordsFrom = guitar;
    input.reported = 0.012;

    await recorder.start({ trackId: 1, playhead: 5, retake: 7 });

    // With the latency the browser reports for it, which skipping uses.
    expect(offers).toEqual([{ offered: guitar, start: { trackId: 1, playhead: 5, retake: 7 }, reported: 0.012 }]);
    expect(recorder.phase).toBeNull();
    expect(input.opened!.closed).toBe(true);
    expect(player.played).toEqual([]);
    expect(keeping.takes).toEqual([]);
    expect(errors).toEqual([]);
    expect(server.timeline.tracks[0].clips).toEqual([]);

    // Skipped, it records.
    calibrations.set(guitar, { offset: null, offered: true });
    await recorder.start({ trackId: 1, playhead: 5 });
    expect(recorder.phase).toBe('recording');
    expect(offers).toHaveLength(1);
  });

  it("records from the default Input, and says so, when the one chosen isn't connected", async () => {
    const { server, input, recorder, sing } = await setup();
    input.gone = 'USB Mic';

    await recorder.start({ trackId: 1, playhead: 5 });

    expect(recorder.inputNote).toBe("USB Mic isn't connected, so recording from the default input.");
    sing(4);
    await recorder.stop();
    expect(server.timeline.tracks[0].clips).toHaveLength(1);
  });

  it('offers a Take whose save failed back as unsaved, and keeps it later where it would have gone', async () => {
    const { server, saves, keeping, recorder, sing } = await setup();

    await recorder.start({ trackId: 1, playhead: 5 });
    sing(4);
    server.failNext(1);
    await recorder.stop();

    expect(saves.saveError).toBe("Can't reach Bandmate. Check your connection.");
    expect(server.timeline.tracks[0].clips).toEqual([]);
    expect(recorder.unsaved).toHaveLength(1);
    // Still kept in the browser, for another tab or a later visit to offer back.
    expect(await keeping.list(1)).toHaveLength(1);

    await recorder.keepUnsaved();

    expect(recorder.unsaved).toEqual([]);
    expect(recorder.recovering).toBe(false);
    expect(server.timeline.tracks[0].clips).toMatchObject([{ start: 5, length: 2 }]);
    expect(keeping.takes).toEqual([]);
  });

  it('offers back the unsaved Takes kept for the Song from an earlier visit, and keeps them one after another', async () => {
    const { server, keeping, recorder } = await setup();
    keeping.put(unsavedOn(1, 2), new Float32Array(400).fill(0.5));
    keeping.put(unsavedOn(2, 6), new Float32Array(400).fill(0.5));
    keeping.put({ ...unsavedOn(1, 2), songId: 2 }, new Float32Array(400).fill(0.5));

    await recorder.loadUnsaved();
    expect(recorder.unsaved).toHaveLength(2);
    await recorder.keepUnsaved();

    expect(server.timeline.tracks.map((t) => t.clips.map((c) => c.start))).toEqual([[2], [6]]);
    expect(recorder.unsaved).toEqual([]);
    expect(keeping.takes.map((t) => t.songId)).toEqual([2]);
  });

  it('discards the unsaved Takes offered', async () => {
    const { server, keeping, recorder } = await setup();
    keeping.put(unsavedOn(1, 2), new Float32Array(400).fill(0.5));
    await recorder.loadUnsaved();

    recorder.discardUnsaved();
    await settled();

    expect(recorder.unsaved).toEqual([]);
    expect(keeping.takes).toEqual([]);
    expect(server.landed).toBe(0);
  });

  it('adds a Track through Saves for an unsaved Take whose Track is gone, and keeps it there', async () => {
    const added: number[] = [];
    const { server, saves, keeping, recorder } = await setup([track(1, [takeClip(3, 0, 10)])], {
      onTrackAdded: (id) => added.push(id),
    });
    keeping.put(unsavedOn(9, 4), new Float32Array(400).fill(0.5));

    await recorder.loadUnsaved();
    await recorder.keepUnsaved();

    expect(server.timeline.tracks.map((t) => t.name)).toEqual(['Track 1', 'Track 2']);
    expect(server.timeline.tracks[1].clips).toMatchObject([{ start: 4, length: 2 }]);
    expect(added).toEqual([server.timeline.tracks[1].id]);
    expect(recorder.unsaved).toEqual([]);
    expect(saves.canUndo).toBe(true);
  });

  it('holds refreshes from pressing Record until the Take is done, then shows what changed elsewhere', async () => {
    const { server, saves, recorder, sing } = await setup();

    const started = recorder.start({ trackId: 1, playhead: 5 });
    server.changeElsewhere({ title: 'From another tab' });
    await saves.refresh();
    await started;
    expect(saves.saved.title).toBe('Untitled');

    sing(1);
    await recorder.stop();
    await settled();

    expect(saves.saved.title).toBe('From another tab');
  });

  it("doesn't record when playback is stopped before it starts", async () => {
    const { player, input, recorder, errors } = await setup();
    player.stopsBeforeStart = true;

    await recorder.start({ trackId: 1, playhead: 5 });

    expect(errors).toEqual(['Recording stopped before it started.']);
    expect(recorder.phase).toBeNull();
    expect(input.opened!.closed).toBe(true);
  });

  it('lets go of an Input still opening when closed, without playing or keeping anything', async () => {
    const { server, saves, player, input, keeping, recorder } = await setup();
    const opening = input.holdOpen();

    const started = recorder.start({ trackId: 1, playhead: 5 });
    expect(recorder.phase).toBe('starting');
    recorder.close();
    opening();
    await started;

    expect(input.opened!.closed).toBe(true);
    expect(player.played).toEqual([]);
    expect(keeping.takes).toEqual([]);
    // Refreshes aren't held by a recording that never started.
    server.changeElsewhere({ title: 'From another tab' });
    await saves.refresh();
    expect(saves.saved.title).toBe('From another tab');
  });

  it('keeps what was captured so far to offer back when closed while recording', async () => {
    const { keeping, recorder, sing, input } = await setup();
    await recorder.start({ trackId: 1, playhead: 5 });
    sing(4);

    recorder.close();
    await settled();

    expect(input.opened!.closed).toBe(true);
    expect(await keeping.list(1)).toHaveLength(1);
  });
});

/** An unsaved Take of a new Clip at start on a Track, as kept by an earlier visit, captured from its lead-in at 100 a second. */
function unsavedOn(trackId: number, start: number) {
  return {
    songId: 1,
    trackId,
    clipId: null,
    takes: [],
    plan: { start, from: start - 2 },
    latencyOffset: 0,
    sampleRate: 100,
    first: 0,
    recordedAt: `2026-01-01T00:00:0${start}Z`,
  };
}
