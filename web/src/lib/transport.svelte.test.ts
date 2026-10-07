import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import type { Loop } from './schedule';
import type { PlayableClip } from './timelinePlayer';
import { Transport } from './transport.svelte';
import { FakeFrames, FakeTimelinePlayer } from './transportFakes';

/** A Clip of a source on a Track, from start to end seconds. */
const clip = (source: string, trackId: number, start: number, end: number): PlayableClip => ({
  source,
  trackId,
  start,
  offset: 0,
  length: end - start,
  gainFactor: 1,
});

/**
 * Transport as the Timeline makes it, inside an effect root, on a fake
 * player and frames, with what plays, the Loop, the length and the
 * recording set by the test through state, and what its hooks heard:
 * captures ended by playback stopping, errors said, and the playhead each
 * frame it's followed.
 */
function transportFor() {
  const state = $state({
    playable: [clip('a', 1, 0, 10), clip('b', 2, 0, 10)] as PlayableClip[],
    loop: null as Loop | null,
    length: 10,
    recording: false,
    capturing: false,
  });
  const frames = new FakeFrames();
  const heard = { captures: 0, errors: [] as (string | null)[], followed: [] as number[] };
  let player!: FakeTimelinePlayer;
  let transport!: Transport;
  const dispose = $effect.root(() => {
    transport = new Transport({
      player: (onState) => (player = new FakeTimelinePlayer(onState)),
      playable: () => state.playable,
      loop: () => state.loop,
      length: () => state.length,
      recording: () => state.recording,
      capturing: () => state.capturing,
      onCaptureStopped: () => heard.captures++,
      onError: (message) => heard.errors.push(message),
      onFollow: (position) => heard.followed.push(position),
      frames,
    });
  });
  disposers.push(dispose);
  flushSync();
  return { transport, player, frames, state, heard };
}

const disposers: (() => void)[] = [];

afterEach(() => {
  for (const d of disposers.splice(0)) d();
});

/** Lets a play load, and the effects it sets off run. */
async function loaded() {
  await new Promise((done) => setTimeout(done));
  flushSync();
}

describe('Transport, playing to the end', () => {
  it('stops at the end and keeps the playhead there', async () => {
    const { transport, player, frames } = transportFor();
    transport.toggle();
    await loaded();
    expect(transport.state).toBe('playing');
    player.now += 4;
    frames.step();
    expect(transport.position).toBe(4);
    expect(transport.playingAt).toBe(4);
    player.now += 7;
    frames.step();
    flushSync();
    expect(transport.state).toBe('stopped');
    expect(transport.position).toBe(10);
    expect(transport.playingAt).toBe(10);
    expect(player.position()).toBe(10);
    expect(frames.waiting).toBe(0);
  });

  it('lets go of the playhead kept at the end once it’s moved', async () => {
    const { transport, player, frames } = transportFor();
    transport.toggle();
    await loaded();
    player.now += 11;
    frames.step();
    flushSync();
    expect(transport.playingAt).toBe(10);
    transport.seek(3);
    expect(transport.playingAt).toBeNull();
    expect(player.plays).toHaveLength(1);
  });
});

describe('Transport, starting over', () => {
  it('plays from 0:00 once at the end, and lets go of the playhead kept there', async () => {
    const { transport, player, frames } = transportFor();
    transport.toggle();
    await loaded();
    player.now += 12;
    frames.step();
    flushSync();
    expect(transport.playingAt).toBe(10);
    transport.toggle();
    expect(player.plays.at(-1)?.from).toBe(0);
    await loaded();
    player.now += 1;
    frames.step();
    expect(transport.position).toBe(1);
    expect(transport.playingAt).toBe(1);
  });

  it('plays on from the end while a Loop is yet to go round', () => {
    const { transport, player, state } = transportFor();
    state.loop = { start: 8, end: 12 };
    transport.seek(10);
    transport.toggle();
    expect(player.plays.at(-1)).toMatchObject({ from: 10, loop: { start: 8, end: 12 } });
  });

  it('plays from where the playhead is when stopped before the end', () => {
    const { transport, player } = transportFor();
    transport.seek(3.5);
    transport.toggle();
    expect(player.plays.at(-1)?.from).toBe(3.5);
  });
});

describe('Transport, the Loop', () => {
  it('goes round past the end, wrapping only at its end', async () => {
    const { transport, player, frames, state } = transportFor();
    state.loop = { start: 6, end: 10 };
    transport.seek(2);
    transport.toggle();
    await loaded();
    player.now += 7.5;
    frames.step();
    expect(transport.position).toBe(9.5);
    player.now += 1;
    frames.step();
    expect(transport.position).toBe(6.5);
    // Many times round, and still playing.
    player.now += 40;
    frames.step();
    expect(transport.position).toBe(6.5);
    expect(transport.state).toBe('playing');
  });

  it('switched on while playing, restarts from where the playhead is, never moving it', async () => {
    const { transport, player, frames, state } = transportFor();
    transport.seek(7);
    transport.toggle();
    await loaded();
    player.now += 1;
    frames.step();
    state.loop = { start: 2, end: 4 };
    flushSync();
    expect(player.plays.at(-1)).toMatchObject({ from: 8, loop: { start: 2, end: 4 } });
    await loaded();
    player.now += 1;
    frames.step();
    // Past the Loop, it plays on to the end.
    expect(transport.position).toBe(9);
  });
});

describe('Transport, restarting', () => {
  it('restarts from where it is when what plays changes while playing', async () => {
    const { transport, player, frames, state } = transportFor();
    transport.toggle();
    await loaded();
    player.now += 3;
    frames.step();
    state.playable = [...state.playable, clip('c', 3, 1, 5)];
    flushSync();
    expect(player.plays).toHaveLength(2);
    expect(player.plays[1].from).toBe(3);
    expect(player.plays[1].clips.map((c) => c.source)).toEqual(['a', 'b', 'c']);
  });

  it('doesn’t restart for Tracks reordered, or the Clips replaced as they were', async () => {
    const { transport, player, state } = transportFor();
    transport.toggle();
    await loaded();
    state.playable = [clip('b', 2, 0, 10), clip('a', 1, 0, 10)];
    flushSync();
    state.playable = [clip('a', 1, 0, 10), clip('b', 2, 0, 10)];
    flushSync();
    expect(player.plays).toHaveLength(1);
  });

  it('doesn’t restart while stopped, but plays what plays then', () => {
    const { transport, player, state } = transportFor();
    state.playable = [clip('c', 3, 0, 4)];
    flushSync();
    expect(player.plays).toHaveLength(0);
    transport.toggle();
    expect(player.plays[0].clips.map((c) => c.source)).toEqual(['c']);
  });

  it('doesn’t restart while capturing, which plays on as it started', async () => {
    const { transport, player, state } = transportFor();
    state.recording = true;
    await transport.playAlong(2);
    state.capturing = true;
    state.playable = [clip('a', 1, 0, 10)];
    state.loop = { start: 0, end: 4 };
    flushSync();
    expect(player.plays).toHaveLength(1);
  });
});

describe('Transport, seeking', () => {
  it('moves the playhead while stopped, without playing', () => {
    const { transport, player } = transportFor();
    transport.seek(4);
    expect(transport.position).toBe(4);
    expect(player.position()).toBe(4);
    expect(player.plays).toHaveLength(0);
  });

  it('jumps playback there while playing', async () => {
    const { transport, player, frames } = transportFor();
    transport.toggle();
    await loaded();
    transport.seek(6);
    expect(transport.position).toBe(6);
    expect(player.plays.at(-1)?.from).toBe(6);
    await loaded();
    player.now += 1;
    frames.step();
    expect(transport.position).toBe(7);
  });

  it('is ignored while a recording is on, from Record until its Take is saved', async () => {
    const { transport, player, state } = transportFor();
    state.recording = true;
    transport.seek(4);
    expect(transport.position).toBe(0);
    expect(player.position()).toBe(0);
    await transport.playAlong(2);
    state.capturing = true;
    transport.seek(8);
    expect(transport.position).toBe(2);
    expect(player.plays).toHaveLength(1);
  });
});

describe('Transport, playing from a time asked for', () => {
  it('starts playback there while stopped', () => {
    const { transport, player } = transportFor();
    transport.playFrom(5);
    expect(transport.position).toBe(5);
    expect(player.plays.map((p) => p.from)).toEqual([5]);
  });

  it('jumps there while playing, never pausing', async () => {
    const { transport, player } = transportFor();
    transport.toggle();
    await loaded();
    transport.playFrom(5);
    expect(player.plays.map((p) => p.from)).toEqual([0, 5]);
    await loaded();
    expect(transport.state).toBe('playing');
  });

  it('does nothing while a recording is on', () => {
    const { transport, player, state } = transportFor();
    state.recording = true;
    transport.playFrom(5);
    expect(transport.position).toBe(0);
    expect(player.plays).toHaveLength(0);
  });
});

describe('Transport, recording', () => {
  it('plays along from where the recording starts, ignoring the Loop', async () => {
    const { transport, player, state } = transportFor();
    state.loop = { start: 0, end: 4 };
    state.recording = true;
    flushSync();
    expect(await transport.playAlong(2)).toBe(true);
    expect(player.plays).toEqual([{ clips: state.playable, from: 2, loop: null }]);
    expect(transport.startedAt).toBe(100);
  });

  it('plays on past the end while capturing', async () => {
    const { transport, player, frames, state } = transportFor();
    state.recording = true;
    await transport.playAlong(8);
    state.capturing = true;
    flushSync();
    player.now += 5;
    frames.step();
    expect(transport.position).toBe(13);
    expect(transport.state).toBe('playing');
  });

  it('stops a capture on Space, ending it through onCaptureStopped', async () => {
    const { transport, state, heard } = transportFor();
    state.recording = true;
    await transport.playAlong(2);
    state.capturing = true;
    transport.toggle();
    expect(transport.state).toBe('stopped');
    expect(heard.captures).toBe(1);
  });

  it('does nothing on Space while a recording starts or saves', async () => {
    const { transport, player, state, heard } = transportFor();
    state.recording = true;
    transport.toggle();
    expect(player.plays).toHaveLength(0);
    await transport.playAlong(2);
    transport.toggle();
    expect(transport.state).toBe('playing');
    expect(heard.captures).toBe(0);
  });

  it('ends a capture when something else stops playback', async () => {
    const { transport, player, state, heard } = transportFor();
    state.recording = true;
    await transport.playAlong(2);
    state.capturing = true;
    player.now += 3;
    player.stop();
    expect(heard.captures).toBe(1);
    expect(transport.state).toBe('stopped');
    expect(transport.position).toBe(5);
  });

  it('doesn’t call onCaptureStopped when playback stops without a capture', async () => {
    const { transport, heard } = transportFor();
    transport.toggle();
    await loaded();
    transport.toggle();
    expect(heard.captures).toBe(0);
  });

  it('resolves to not playing when stopped before it starts', async () => {
    const { transport, player, state } = transportFor();
    state.recording = true;
    const release = player.holdLoading();
    const playing = transport.playAlong(2);
    transport.stop();
    release();
    expect(await playing).toBe(false);
  });
});

describe('Transport, the playhead', () => {
  it('reads to the millisecond, playing or stopped', async () => {
    const { transport, player } = transportFor();
    transport.seek(1.23456);
    expect(transport.playheadAt()).toBe(1.235);
    transport.toggle();
    await loaded();
    player.now += 2.0004;
    expect(transport.playheadAt()).toBe(3.235);
    transport.toggle();
    expect(transport.playheadAt()).toBe(3.235);
  });

  it('is let go of once stopped by hand, and kept while starting over from elsewhere', async () => {
    const { transport, frames, player } = transportFor();
    expect(transport.playingAt).toBeNull();
    transport.toggle();
    await loaded();
    player.now += 2;
    frames.step();
    transport.seek(6);
    expect(transport.state).toBe('loading');
    // Kept as the last frame had it, until the next.
    expect(transport.playingAt).toBe(2);
    await loaded();
    transport.toggle();
    expect(transport.playingAt).toBeNull();
  });

  it('isn’t heard while loading to play from stopped, until the first frame', async () => {
    const { transport, frames, player } = transportFor();
    transport.seek(3);
    const release = player.holdLoading();
    transport.toggle();
    expect(transport.state).toBe('loading');
    expect(transport.playingAt).toBeNull();
    release();
    await loaded();
    expect(transport.playingAt).toBeNull();
    player.now += 1;
    frames.step();
    expect(transport.playingAt).toBe(4);
  });
});

describe('Transport, failing to play', () => {
  it('says why, clearing what was said as Play is pressed again', async () => {
    const { transport, player, heard } = transportFor();
    player.failing = 'Couldn’t load the audio (404).';
    transport.toggle();
    await loaded();
    expect(transport.state).toBe('stopped');
    expect(heard.errors).toEqual([null, 'Couldn’t load the audio (404).']);
    player.failing = null;
    transport.toggle();
    expect(heard.errors.at(-1)).toBeNull();
  });
});

describe('Transport, the ruler scrub', () => {
  it('seeks as it goes while stopped', () => {
    const { transport, player } = transportFor();
    transport.startScrub(2);
    expect(transport.scrubbing).toBe(true);
    transport.scrubTo(5);
    expect(transport.position).toBe(5);
    expect(player.position()).toBe(5);
    transport.endScrub(6);
    expect(transport.scrubbing).toBe(false);
    expect(transport.position).toBe(6);
    expect(player.position()).toBe(6);
    expect(player.plays).toHaveLength(0);
  });

  it('while playing, moves the playhead, left there by frames, and jumps playback only on release', async () => {
    const { transport, player, frames } = transportFor();
    transport.toggle();
    await loaded();
    // Pressed, playback jumps there.
    transport.startScrub(2);
    expect(player.plays.map((p) => p.from)).toEqual([0, 2]);
    await loaded();
    transport.scrubTo(7);
    player.now += 1;
    frames.step();
    expect(transport.position).toBe(7);
    transport.scrubTo(8);
    expect(transport.position).toBe(8);
    expect(player.plays).toHaveLength(2);
    transport.endScrub(8.5);
    expect(player.plays.map((p) => p.from)).toEqual([0, 2, 8.5]);
    await loaded();
    player.now += 1;
    frames.step();
    expect(transport.position).toBe(9.5);
  });

  it('given up while playing, isn’t a seek: playback plays on from where it was', async () => {
    const { transport, player, frames } = transportFor();
    transport.toggle();
    await loaded();
    transport.startScrub(2);
    await loaded();
    transport.scrubTo(7);
    transport.cancelScrub();
    expect(transport.scrubbing).toBe(false);
    transport.endScrub(7);
    expect(player.plays.map((p) => p.from)).toEqual([0, 2]);
    player.now += 1;
    frames.step();
    expect(transport.position).toBe(3);
  });

  it('given up while stopped, leaves the playhead where it was scrubbed to', () => {
    const { transport, player } = transportFor();
    transport.startScrub(2);
    transport.scrubTo(5);
    transport.cancelScrub();
    transport.scrubTo(8);
    expect(transport.position).toBe(5);
    expect(player.position()).toBe(5);
  });

  it('isn’t started while a recording is on', async () => {
    const { transport, player, state } = transportFor();
    state.recording = true;
    await transport.playAlong(2);
    state.capturing = true;
    transport.startScrub(6);
    expect(transport.scrubbing).toBe(false);
    transport.scrubTo(7);
    transport.endScrub(7);
    expect(transport.position).toBe(2);
    expect(player.plays).toHaveLength(1);
  });
});

describe('Transport, following the playhead', () => {
  it('is heard each frame while playing on', async () => {
    const { transport, player, frames, heard } = transportFor();
    expect(transport.following).toBe(true);
    transport.toggle();
    await loaded();
    player.now += 1;
    frames.step();
    player.now += 1;
    frames.step();
    expect(heard.followed).toEqual([1, 2]);
  });

  it('goes off with a hand scroll, no longer heard each frame', async () => {
    const { transport, player, frames, heard } = transportFor();
    transport.toggle();
    await loaded();
    transport.stopFollowing();
    expect(transport.following).toBe(false);
    player.now += 1;
    frames.step();
    expect(heard.followed).toEqual([]);
    expect(transport.position).toBe(1);
  });

  it('comes on with playing from stopped, but not with pausing', async () => {
    const { transport } = transportFor();
    transport.stopFollowing();
    transport.toggle();
    expect(transport.following).toBe(true);
    await loaded();
    transport.stopFollowing();
    transport.toggle();
    expect(transport.following).toBe(false);
  });

  it('comes on with playing from a time asked for', () => {
    const { transport } = transportFor();
    transport.stopFollowing();
    transport.playFrom(5);
    expect(transport.following).toBe(true);
  });

  it('comes on with playing along with a recording', async () => {
    const { transport, state } = transportFor();
    transport.stopFollowing();
    state.recording = true;
    await transport.playAlong(2);
    expect(transport.following).toBe(true);
  });

  it('comes on with a hand seek', () => {
    const { transport } = transportFor();
    transport.stopFollowing();
    transport.seek(4);
    expect(transport.following).toBe(true);
  });

  it('comes on with a ruler press, even during a recording, which it doesn’t move', async () => {
    const { transport, player, state } = transportFor();
    state.recording = true;
    await transport.playAlong(2);
    state.capturing = true;
    transport.stopFollowing();
    transport.startScrub(6);
    expect(transport.following).toBe(true);
    expect(transport.scrubbing).toBe(false);
    expect(transport.position).toBe(2);
    expect(player.plays).toHaveLength(1);
  });

  it('isn’t heard while the playhead’s scrubbed, which shows it where it’s dragged', async () => {
    const { transport, player, frames, heard } = transportFor();
    transport.toggle();
    await loaded();
    transport.startScrub(2);
    await loaded();
    transport.scrubTo(7);
    player.now += 1;
    frames.step();
    expect(heard.followed).toEqual([]);
    transport.endScrub(7);
    await loaded();
    player.now += 1;
    frames.step();
    expect(heard.followed).toEqual([8]);
  });
});
