import { api } from './api';
import { dictionaryStore } from './dictionaryStore';
import { RhymingDictionaries } from './rhymingDictionaries.svelte';

// The rhyming dictionaries downloaded to this device, shared by Settings'
// Writing card, which downloads and removes them, and the Song page's
// Rhymes card, which reads them. One downloaded or removed in any of this
// device's tabs shows in all of them.

const tabs = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('bandmate.rhymingDictionaries');

export const rhymingDictionaries = new RhymingDictionaries(dictionaryStore, api.getLanguageData, {
  changed: () => tabs?.postMessage('changed'),
});

tabs?.addEventListener('message', () => void rhymingDictionaries.relist());
