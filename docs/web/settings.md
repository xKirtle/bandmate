# Settings and Backups

A reference for keeping copies of your work, moving it between installs, and setting Bandmate up the way you like: look up the part you need. Writing a song and recording it are on [Writing and recording](/features).

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

Turn on **Make Backups on a schedule**, choose daily, weekly or monthly, and Bandmate backs up everything on its own, each time that long has passed since its last Scheduled Backup. The first is made as soon as you turn the schedule on. Turning it off and on again doesn't make an extra one: the next still comes a day, week or month after the last. If Bandmate was off when one came due, it makes one when it starts, just one however long it was off. If nothing has changed in your Songs or Beats since the last one, and you haven't deleted it, Bandmate skips it, so a quiet month doesn't push out older Backups that differ, and looks again a day, week or month later. The schedule is the same from every device.

Each is marked **Scheduled** in the list, and you can restore, download, rename or delete it like any other. Bandmate keeps only the newest Scheduled Backups, as many as you choose from 1 to 30, and deletes the oldest when a new one is made. Backups you make or upload are never deleted. Choosing fewer, or turning the schedule off, deletes nothing at once: the extras go when the next one is made.

To hold on to a Scheduled Backup, say one from before a big change, choose **Keep** in its ⋯ menu. It's then like a Backup you made: no longer marked Scheduled, not counted among those kept, and never deleted unless you delete it.

Under the settings, the card says when the last Scheduled Backup was made, that nothing has changed since, or that there's nothing to back up. If one couldn't be made, for example because the disk is full, the card says why, as does Bandmate's log. Fix the cause and Bandmate makes it at its next try, within the hour.

## Settings

**Settings**, at the foot of the side bar, has four tabs:

- **This device**: what each device keeps for itself.
  - **Appearance**: three colour palettes, Terracotta (the default), Ink and Olive, each in light and dark. Follow your system's light or dark, or pick one. More palettes may come.
  - **Recording**: every input on this device, each channel of an audio interface on its own, with its latency or "Not calibrated" or "Skipped". Pick the one you record from, and check its level with **Test input** above the list: Bandmate only listens while it's on, and asks for the microphone the first time. Open any of them to calibrate it as in [Calibrate](/features#calibrate) without recording from it, or type its latency. Inputs that aren't plugged in keep their latency, listed under **Not connected**, to forget.
  - **Rhyming dictionaries**: one for each language Bandmate suggests rhymes in, each with its download size. Download the ones you write in, so [Rhymes](/features#rhymes) can suggest words in them, or remove one you no longer need.
  - **Chord diagrams**: flip them for left-handed playing.
- **Shortcuts**: every [keyboard shortcut](/features#keyboard-shortcuts), with its keys. Open one to see what it does and where it works, and to [change its keys](#change-a-shortcut-s-keys), or search them as in the shortcuts list. Shown only on a bigger screen.
- **Backups**: see [Backups](#backups).
- **About**: the version you're running, what changed in it, whether a newer one is out, the yt-dlp in use, and the packages and data that ship in Bandmate, with their licenses.

### Change a shortcut's keys

In **Settings → Shortcuts**, open a shortcut. Click one of its keys and press the one you want, **Add key** to give it another, or remove a key with its ×. Esc cancels. A mouse shortcut, like Ctrl+click or Shift+drag, keeps its click, drag or scroll: choose which of Ctrl, Alt and Shift you hold with it, at least one.

A key another shortcut already has is refused, with a link to that shortcut so you can free the key there first. So are keys the browser or the page needs, like Tab or Ctrl+W.

**Reset** puts one shortcut back, and **Reset to defaults** puts them all back. Your keys are kept on each device, so each keyboard you use can have its own.
