import { api } from './api';
import { ListedLanguages } from './listedLanguages.svelte';

// The Languages Bandmate rhymes in, asked for once a visit and shared by
// the Languages picker, Settings' Rhyming dictionaries card and the Rhymes card.

export const listedLanguages = new ListedLanguages(api.getLanguages);
