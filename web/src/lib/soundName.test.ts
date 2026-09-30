import { describe, expect, it } from 'vitest';
import { soundName } from './soundName';

describe('soundName', () => {
  it("is the file's title tag", () => {
    expect(soundName('voice memo 12.m4a', { title: '  Hook idea ' })).toBe('Hook idea');
  });

  it('is otherwise the filename without its extension, as it is', () => {
    expect(soundName('guitar_line.take2.wav')).toBe('guitar_line.take2');
    expect(soundName('dark_trap_140bpm_Am.wav', { title: ' ' })).toBe('dark_trap_140bpm_Am');
    expect(soundName('riff')).toBe('riff');
  });
});
