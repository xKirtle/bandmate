import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
// Shows the Palette and Light or Dark picked on this device, and follows
// the system and the device's other tabs, on every page.
import './lib/sharedAppearance.svelte';
import { deviceStorage } from './lib/deviceStorage';
import { trackPointerFocus } from './lib/pointerFocus';

trackPointerFocus();

// Rhyme mode replaced the Writing aids switch, which a device kept turned off
// under this key, read no longer.
try {
  deviceStorage()?.removeItem('bandmate.writingAidsOff');
} catch {
  // Left, harmless, where the browser refuses.
}

const app = mount(App, { target: document.getElementById('app')! });

export default app;
