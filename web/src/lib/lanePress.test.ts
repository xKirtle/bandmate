import { describe as group, expect, it } from 'vitest';
import { laneStep, pressLane, type LaneInput, type LaneOutcome, type LanePress } from './lanePress';

const from = { clientX: 100, clientY: 100 };
const wobble = { clientX: 103, clientY: 98 };
const away = { clientX: 140, clientY: 120 };

/** The outcomes of a press's inputs in turn, and the press left after them. */
function run(press: LanePress, ...inputs: LaneInput[]) {
  const outcomes: LaneOutcome[] = [];
  let at: LanePress | null = press;
  for (const input of inputs) {
    if (!at) break;
    const step = laneStep(at, input);
    outcomes.push(step.outcome);
    at = step.press;
  }
  return { outcomes, press: at };
}

group('a mouse or pen press on empty lane space', () => {
  const press = pressLane(from, false);

  it('draws a box once it moves past the slop, and keeps it on lifting', () => {
    expect(run(press, { kind: 'move', at: wobble }, { kind: 'move', at: away }, { kind: 'lift' })).toEqual({
      outcomes: ['wait', 'box', 'keep'],
      press: null,
    });
  });

  it('is a click when lifted without moving past the slop', () => {
    expect(run(press, { kind: 'move', at: wobble }, { kind: 'lift' })).toEqual({
      outcomes: ['wait', 'click'],
      press: null,
    });
  });

  it('restores the Selection when its box is given up', () => {
    expect(run(press, { kind: 'move', at: away }, { kind: 'cancel' }).outcomes).toEqual(['box', 'restore']);
  });

  it('gives up leaving the Selection be before it draws a box', () => {
    expect(run(press, { kind: 'cancel' })).toEqual({ outcomes: ['giveUp'], press: null });
  });

  it('has no long press', () => {
    expect(run(press, { kind: 'hold' }, { kind: 'lift' }).outcomes).toEqual(['wait', 'click']);
  });
});

group('a finger pressing empty lane space', () => {
  const press = pressLane(from, true);

  it('gives up, leaving the Timeline to pan, when it moves past the slop before the hold', () => {
    expect(run(press, { kind: 'move', at: wobble }, { kind: 'move', at: away })).toEqual({
      outcomes: ['wait', 'giveUp'],
      press: null,
    });
  });

  it('is a tap when lifted before the hold', () => {
    expect(run(press, { kind: 'lift' }).outcomes).toEqual(['click']);
  });

  it('draws a box under the finger once held, which grows as it drags and stays on lifting', () => {
    expect(
      run(press, { kind: 'move', at: wobble }, { kind: 'hold' }, { kind: 'move', at: away }, { kind: 'lift' }),
    ).toEqual({
      outcomes: ['wait', 'box', 'box', 'keep'],
      press: null,
    });
  });

  it('is a click, clearing the Selection, when held and lifted without dragging', () => {
    expect(run(press, { kind: 'hold' }, { kind: 'move', at: wobble }, { kind: 'lift' }).outcomes).toEqual([
      'box',
      'box',
      'click',
    ]);
  });

  it('is a drag once the finger has moved past the slop from where it held, even back again', () => {
    expect(
      run(press, { kind: 'hold' }, { kind: 'move', at: away }, { kind: 'move', at: from }, { kind: 'lift' }).outcomes,
    ).toEqual(['box', 'box', 'box', 'keep']);
  });

  it('restores the Selection when its box is given up, e.g. for a second finger', () => {
    expect(run(press, { kind: 'hold' }, { kind: 'move', at: away }, { kind: 'cancel' }).outcomes).toEqual([
      'box',
      'box',
      'restore',
    ]);
    expect(run(press, { kind: 'hold' }, { kind: 'cancel' }).outcomes).toEqual(['box', 'restore']);
  });

  it('gives up leaving the Selection be when cancelled before the hold', () => {
    expect(run(press, { kind: 'cancel' }).outcomes).toEqual(['giveUp']);
  });
});
