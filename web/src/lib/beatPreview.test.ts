import { describe, expect, it } from 'vitest';
import { toDraft } from './beatDraft';
import { previewCredit } from './beatPreview';

describe('previewCredit', () => {
  it('credits a Library Beat with its title and producer', () => {
    expect(previewCredit({ beat: { title: 'Echo Room', producer: 'Lumen' } })).toEqual({
      title: 'Echo Room',
      byline: 'Lumen',
    });
    expect(previewCredit({ beat: { title: 'Echo Room', producer: '' } })).toEqual({
      title: 'Echo Room',
      byline: 'No producer credited',
    });
  });

  it('names a staged file by the title typed for it, with its file name below', () => {
    const file = { name: 'track_07.wav' };
    expect(previewCredit({ row: { file, draft: toDraft({ title: 'Paper Hours' }) } })).toEqual({
      title: 'Paper Hours',
      byline: 'track_07.wav',
    });
  });

  it('names a staged file without a title by its file name alone', () => {
    const file = { name: 'track_07.wav' };
    expect(previewCredit({ row: { file, draft: { ...toDraft(null), title: '  ' } } })).toEqual({
      title: 'track_07.wav',
      byline: '',
    });
  });
});
