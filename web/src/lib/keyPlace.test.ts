// @vitest-environment happy-dom
import { afterEach, describe as group, expect, it } from 'vitest';
import { ownKey } from './keyPlace';

afterEach(() => document.body.replaceChildren());

/** Puts some markup on the page and gives back the element `selector` picks in it, where the key is pressed. */
function fixture(html: string, selector: string): Element {
  document.body.innerHTML = html;
  const found = document.querySelector(selector);
  if (!found) throw new Error(`No ${selector} in the fixture`);
  return found;
}

/** Whether `key`, pressed on the element `selector` picks, is that control's own. */
const own = (key: string, html: string, selector = '#at') => ownKey({ key, target: fixture(html, selector) });

const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
// Keys a Song page Shortcut has by default, or could be given.
const shortcutKeys = [' ', 'Home', 'End', 'Enter', 'Escape', 'r', 'z', '?', ...arrows];

group('a text field', () => {
  it('owns every key typed into it', () => {
    for (const key of shortcutKeys) {
      expect(own(key, '<input id="at" type="text">')).toBe(true);
      expect(own(key, '<textarea id="at"></textarea>')).toBe(true);
      expect(own(key, '<div id="at" contenteditable="true"></div>')).toBe(true);
    }
  });

  it("owns none once it's read-only, e.g. in Sync mode", () => {
    expect(own(' ', '<textarea id="at" readonly></textarea>')).toBe(false);
    expect(own('r', '<textarea id="at" readonly></textarea>')).toBe(false);
  });
});

group('a dialog, a popover, a ⋯ menu or a list', () => {
  const containers = {
    'a dialog': '<dialog open><button id="at">Close</button></dialog>',
    'a popover, e.g. the Cues menu':
      '<div role="dialog" aria-label="Cues"><button id="at">Clear all Cues</button></div>',
    'a ⋯ menu': '<div role="menu"><button id="at" role="menuitem">Delete</button></div>',
    'a list, e.g. a picker': '<ul role="listbox"><li id="at" role="option" tabindex="0">0.1 s</li></ul>',
  };

  for (const [name, html] of Object.entries(containers)) {
    it(`owns every key pressed in ${name}`, () => {
      for (const key of shortcutKeys) expect(own(key, html)).toBe(true);
    });
  }

  it("owns no key pressed elsewhere on the page while one's open", () => {
    const page =
      '<div role="dialog" aria-label="Cues"><button>Clear all Cues</button></div><button id="at">Play</button>';
    expect(own(' ', page)).toBe(false);
    expect(own('z', page)).toBe(false);
  });
});

group('Space', () => {
  it('is the own key of a select, a checkbox or a radio button', () => {
    expect(own(' ', '<select id="at"><option>A</option></select>')).toBe(true);
    expect(own(' ', '<input id="at" type="checkbox">')).toBe(true);
    expect(own(' ', '<input id="at" type="radio">')).toBe(true);
  });

  it('is not a plain button’s, so it still plays or pauses wherever a click left focus', () => {
    expect(own(' ', '<button id="at">Add Track</button>')).toBe(false);
    expect(own(' ', '<input id="at" type="range">')).toBe(false);
  });
});

group('Home and End', () => {
  it('are the own keys of a select or a range slider, e.g. a Track’s volume', () => {
    for (const key of ['Home', 'End']) {
      expect(own(key, '<select id="at"><option>A</option></select>')).toBe(true);
      expect(own(key, '<input id="at" type="range">')).toBe(true);
    }
  });

  it('are not the ruler’s, where they go to the start and the end', () => {
    const ruler = '<div id="at" class="ruler" role="slider" tabindex="0" aria-valuenow="0"></div>';
    expect(own('Home', ruler)).toBe(false);
    expect(own('End', ruler)).toBe(false);
  });

  it('are not a plain button’s, nor a checkbox’s', () => {
    expect(own('Home', '<button id="at">Add Track</button>')).toBe(false);
    expect(own('End', '<input id="at" type="checkbox">')).toBe(false);
  });
});

group('The arrows', () => {
  const controls = {
    'a select': '<select id="at"><option>A</option></select>',
    'a range slider': '<input id="at" type="range">',
    'a number box': '<input id="at" type="number" readonly>',
    'a radio button': '<input id="at" type="radio">',
    'the ruler': '<div id="at" role="slider" tabindex="0"></div>',
    'a spin button': '<div id="at" role="spinbutton" tabindex="0"></div>',
    'a combobox': '<div id="at" role="combobox" tabindex="0"></div>',
    'a tab list': '<div role="tablist"><button id="at" role="tab">Lyrics</button></div>',
    'a radio group': '<div role="radiogroup"><button id="at" role="radio">Write</button></div>',
    'a ⋯': '<button id="at" aria-haspopup="menu">⋯</button>',
    'a field opening a list': '<button id="at" aria-haspopup="listbox">0.1 s</button>',
  };

  for (const [name, html] of Object.entries(controls)) {
    it(`are ${name}’s own`, () => {
      for (const key of arrows) expect(own(key, html)).toBe(true);
    });
  }

  it('are not a plain button’s, nor a checkbox’s', () => {
    for (const key of arrows) {
      expect(own(key, '<button id="at">Add Track</button>')).toBe(false);
      expect(own(key, '<input id="at" type="checkbox">')).toBe(false);
    }
  });

  it('leave a control the keys it doesn’t use, e.g. a slider’s Space or a ⋯’s R', () => {
    expect(own('r', '<div id="at" role="slider" tabindex="0"></div>')).toBe(false);
    expect(own('z', '<button id="at" aria-haspopup="menu">⋯</button>')).toBe(false);
    expect(own('Enter', '<select id="at"><option>A</option></select>')).toBe(false);
    expect(own('p', '<input id="at" type="checkbox">')).toBe(false);
  });
});

group('The page itself', () => {
  it('owns no key pressed with nothing focused', () => {
    for (const key of shortcutKeys) expect(ownKey({ key, target: document.body })).toBe(false);
  });
});
