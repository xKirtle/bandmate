import { describe as group, expect, it } from 'vitest';
import { listEdgeSpeed, pressSong, songDrop, songStep } from './songDrag';

const from = { clientX: 100, clientY: 100 };
const near = { clientX: 103, clientY: 98 };
const away = { clientX: 100, clientY: 140 };

group('a mouse pressing a Song', () => {
  it('drags it once it moves past the slop', () => {
    const { press, outcome } = songStep(pressSong(from, false), { kind: 'move', at: away });
    expect(outcome).toBe('drag');
    expect(songStep(press!, { kind: 'lift' }).outcome).toBe('drop');
  });
});

group('a mouse clicking a Song', () => {
  it('leaves the click to open it, through a wobble', () => {
    const { press, outcome } = songStep(pressSong(from, false), { kind: 'move', at: near });
    expect(outcome).toBe('wait');
    expect(songStep(press!, { kind: 'lift' })).toEqual({ press: null, outcome: 'giveUp' });
  });
});

group('a finger on a Song', () => {
  it('leaves a tap to open it', () => {
    expect(songStep(pressSong(from, true), { kind: 'lift' }).outcome).toBe('giveUp');
  });

  it('leaves a swipe before the long press to scroll the list', () => {
    expect(songStep(pressSong(from, true), { kind: 'move', at: away })).toEqual({ press: null, outcome: 'giveUp' });
  });

  it('drags it once held still, then follows the finger and drops where it lifts', () => {
    let step = songStep(pressSong(from, true), { kind: 'move', at: near });
    expect(step.outcome).toBe('wait');
    step = songStep(step.press!, { kind: 'hold' });
    expect(step.outcome).toBe('drag');
    step = songStep(step.press!, { kind: 'move', at: away });
    expect(step.outcome).toBe('drag');
    expect(songStep(step.press!, { kind: 'lift' }).outcome).toBe('drop');
  });

  it('drops nothing when the browser cancels the drag', () => {
    const held = songStep(pressSong(from, true), { kind: 'hold' }).press!;
    expect(songStep(held, { kind: 'cancel' })).toEqual({ press: null, outcome: 'giveUp' });
  });
});

group('songDrop', () => {
  it('moves a Song in no Folder into the Folder it drops on', () => {
    expect(songDrop(null, { folder: 3 })).toEqual({ folder: 3 });
  });

  it('moves a Song out to no Folder, dropped on the Songs link', () => {
    expect(songDrop(3, { folder: null })).toEqual({ folder: null });
  });

  it('changes nothing dropped where it already is, or anywhere else', () => {
    expect(songDrop(3, { folder: 3 })).toBeNull();
    expect(songDrop(null, { folder: null })).toBeNull();
    expect(songDrop(3, null)).toBeNull();
  });
});

group('listEdgeSpeed', () => {
  // The list in view from 100px down the window to 700px, above the tab bar.
  const speed = (y: number) => listEdgeSpeed(y, 100, 700);

  it('leaves the list still away from its edges', () => {
    expect(speed(148)).toBe(0);
    expect(speed(400)).toBe(0);
    expect(speed(652)).toBe(0);
  });

  it('scrolls up near the top edge and down near the bottom, faster the nearer', () => {
    expect(speed(124)).toBe(-300);
    expect(speed(100)).toBe(-600);
    expect(speed(676)).toBe(300);
    expect(speed(700)).toBe(600);
  });

  it('leaves it still past its edges, over the header or the tab bar', () => {
    expect(speed(60)).toBe(0);
    expect(speed(740)).toBe(0);
  });
});
