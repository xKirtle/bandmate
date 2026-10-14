import { describe, expect, it } from 'vitest';
import { Tour, steps } from './tour.svelte';

/** A Tour whose goings are recorded rather than made. */
function newTour() {
  const went: { to: string; back?: true }[] = [];
  const tour = new Tour({ go: (to) => went.push({ to }), goBack: (to) => went.push({ to, back: true }) });
  return { tour, went };
}

describe('the Tour', () => {
  it('has eight steps, every one but the last spotlighting a control', () => {
    expect(steps).toHaveLength(8);
    expect(steps.slice(0, 7).every((s) => s.control)).toBe(true);
    expect(steps[7].control).toBeUndefined();
  });

  it("isn't running until it's taken", () => {
    const { tour, went } = newTour();
    expect(tour.running).toBe(false);
    expect(went).toEqual([]);
  });

  it('opens the Demo Song at step 1 when taken', () => {
    const { tour, went } = newTour();
    tour.start('/settings/about');
    expect(tour.running).toBe(true);
    expect(tour.step.title).toBe('Sections');
    expect(tour.count).toBe('1 of 8');
    expect(went).toEqual([{ to: '/songs/demo' }]);
  });

  it('goes forward with Next and back with Back, counting as it goes', () => {
    const { tour } = newTour();
    tour.start('/');
    tour.next();
    tour.next();
    expect(tour.step.title).toBe('Chords');
    expect(tour.count).toBe('3 of 8');
    tour.back();
    expect(tour.step.title).toBe('Lines');
    expect(tour.count).toBe('2 of 8');
  });

  it("doesn't go back from step 1", () => {
    const { tour } = newTour();
    tour.start('/');
    tour.back();
    expect(tour.count).toBe('1 of 8');
    expect(tour.running).toBe(true);
  });

  it('says Finish on the last step only', () => {
    const { tour } = newTour();
    tour.start('/');
    for (let i = 0; i < 6; i++) tour.next();
    expect(tour.last).toBe(false);
    tour.next();
    expect(tour.last).toBe(true);
    expect(tour.step.title).toBe('That’s the core of it');
    expect(tour.count).toBe('8 of 8');
  });

  it('ends at Finish, going back to where it was taken from', () => {
    const { tour, went } = newTour();
    tour.start('/settings/about');
    for (let i = 0; i < 8; i++) tour.next();
    expect(tour.running).toBe(false);
    expect(went.at(-1)).toEqual({ to: '/settings/about', back: true });
  });

  it('ends part-way (End tour, Esc, or a window narrowed to phone width), going back to where it was taken from', () => {
    const { tour, went } = newTour();
    tour.start('/?q=boats');
    tour.next();
    tour.end();
    expect(tour.running).toBe(false);
    expect(went.at(-1)).toEqual({ to: '/?q=boats', back: true });
  });

  it('ends without going anywhere once the Demo Song is left', () => {
    const { tour, went } = newTour();
    tour.start('/settings/about');
    tour.next();
    tour.stop();
    expect(tour.running).toBe(false);
    expect(went).toEqual([{ to: '/songs/demo' }]);
  });

  it('keeps no progress: taken again, it starts at step 1', () => {
    const { tour } = newTour();
    tour.start('/');
    tour.next();
    tour.next();
    tour.end();
    tour.start('/');
    expect(tour.count).toBe('1 of 8');
  });

  it('does nothing once ended', () => {
    const { tour, went } = newTour();
    tour.start('/');
    tour.end();
    tour.next();
    tour.back();
    tour.end();
    expect(tour.running).toBe(false);
    expect(went).toHaveLength(2);
  });
});
