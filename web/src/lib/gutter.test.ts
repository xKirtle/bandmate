import { describe, expect, it } from 'vitest';
import { gutterFields } from './gutter';

describe('gutterFields', () => {
  const setUp = (keys: string[]) => {
    const opened: string[] = [];
    const fields = gutterFields();
    for (const k of keys) fields.set(k, { edit: () => opened.push(k) });
    return { fields, opened };
  };

  it('opens the next field down the page', () => {
    const { fields, opened } = setUp(['1:1', '1:2', '2:3']);
    expect(fields.editAfter(['1:1', '1:2', '2:3'], '1:2')).toBe(true);
    expect(opened).toEqual(['2:3']);
  });

  it('answers false after the last field', () => {
    const { fields, opened } = setUp(['1:1', '1:2']);
    expect(fields.editAfter(['1:1', '1:2'], '1:2')).toBe(false);
    expect(opened).toEqual([]);
  });

  it('skips a Line without a field just now', () => {
    const { fields, opened } = setUp(['1:1', '1:3']);
    expect(fields.editAfter(['1:1', '1:2', '1:3'], '1:1')).toBe(true);
    expect(opened).toEqual(['1:3']);
  });

  it('forgets a field once it is gone', () => {
    const { fields, opened } = setUp(['1:1', '1:2']);
    fields.set('1:2', null);
    expect(fields.editAfter(['1:1', '1:2'], '1:1')).toBe(false);
    expect(opened).toEqual([]);
  });
});
