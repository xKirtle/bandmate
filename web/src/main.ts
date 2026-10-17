import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
// Shows the Palette and Light or Dark picked on this device, and follows
// the system and the device's other tabs, on every page.
import './lib/sharedAppearance.svelte';
// Has every Shortcut's handler and hint use the keys as rebound on this device.
import './lib/sharedShortcutKeys.svelte';
import { trackPointerFocus } from './lib/pointerFocus';

trackPointerFocus();

const app = mount(App, { target: document.getElementById('app')! });

export default app;
