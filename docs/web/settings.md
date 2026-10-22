# Settings and Backups

A reference for setting Bandmate up the way you like, keeping copies of your work, and moving it between installs: look up the part you need. Writing a song and recording it are on [Writing and recording](/features).

## Settings

**Settings**, at the foot of the side bar, has four tabs:

- **This device**: what each device keeps for itself.
  - **Appearance**: three colour palettes, Terracotta (the default), Ink and Olive, each in light and dark. Follow your system's light or dark, or pick one.
  - **Recording**: every input on this device, each channel of an audio interface on its own, with its latency. Pick the one you record from, and check its level with **Test input**. Open one to [calibrate](/features#calibrate) it, or type its latency. Inputs that aren't plugged in keep their latency, under **Not connected**, where you can forget them.
  - **Rhyming dictionaries**: download one for each language you write in, so [Rhymes](/features#rhymes) can suggest words in it, or remove one you no longer need.
  - **Chord diagrams**: flip them for left-handed playing.
- **Shortcuts**: every [keyboard shortcut](#keyboard-shortcuts), with its keys. Open one to see what it does and where it works, and to [change its keys](#change-a-shortcut-s-keys), or search them as in the shortcuts list. Shown only on a bigger screen.
- **Backups**: see [Backups](#backups).
- **About**: the version you're running, what changed in it, whether a newer one is out, the yt-dlp in use, and the licenses of what ships in Bandmate.

## Keyboard shortcuts

On a song's page, press **?**, or the keyboard button by Write and Read, to see every shortcut. Type in the search at its top to find one by what it does or by its keys, like "split" or "Space".

<img src="@screenshots/shortcuts-sheet.png" alt="The shortcuts list: a search and Change keys at its top, then each shortcut with what it does, where it works and its keys">

On a Mac, ⌘ works wherever Ctrl does. To use other keys, see [below](#change-a-shortcut-s-keys).

### Change a shortcut's keys

In **Settings → Shortcuts**, open a shortcut. Click one of its keys and press the one you want, **Add key** to give it another, or remove a key with its ×. Esc cancels. A mouse shortcut, like Ctrl+click or Shift+drag, keeps its click, drag or scroll: choose which of Ctrl, Alt and Shift you hold with it, at least one.

A key another shortcut already has is refused, with a link to that shortcut so you can free the key there first. So are keys the browser or the page needs, like Tab or Ctrl+W.

**Reset** puts one shortcut back, and **Reset to defaults** puts them all back. Your keys are kept on each device, so each keyboard you use can have its own.

## Backups

Keep copies of your work, and move it between installs.

<img src="@screenshots/backups-labelled.png" alt="Settings' Backups, numbered 1 to 5 to match the list below it">

1. **Scheduled Backups**: have Bandmate back up everything on its own. See [below](#scheduled-backups).
2. **Upload** a Backup, made by this Bandmate or another.
3. **New Backup**: of the songs you choose, your beat library, or both.
4. **A Backup**, with when it was made and its size.
5. **Restore** what you pick from it, or download it to keep it somewhere safe. Where a song is already here, you choose to replace it or keep both. On a phone, Restore and Download are in the Backup's ⋯ menu.

A Backup restores into the same version of Bandmate or a newer one. To copy everything at once, see [copying the data folder](/self-hosting#copying-the-data-folder).

### Scheduled Backups

Turn on **Make Backups on a schedule**, choose daily, weekly or monthly, and Bandmate backs up everything on its own, the first as soon as you turn it on. If Bandmate was off when one came due, it makes one when it starts. If nothing in your Songs or Beats has changed since the last one, and it's still there, it skips it, so copies of the same work don't push out older Backups. The schedule is the same from every device.

Each is marked **Scheduled** in the list. Bandmate keeps only the newest Scheduled Backups, as many as you choose from 1 to 30, and deletes the oldest when a new one is made. Backups you make or upload are never deleted. Choosing fewer, or turning the schedule off, deletes nothing until the next one is made. To hold on to a Scheduled Backup, say one from before a big change, choose **Keep** in its ⋯ menu: it's then like a Backup you made, not counted among those kept, and never deleted unless you delete it.

If one couldn't be made, for example because the disk is full, the Scheduled Backups card says why, as does Bandmate's log. Fix the cause, and Bandmate tries again within the hour.
