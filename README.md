# Workout Timer

A small installable web app (PWA) to build workouts from your own exercises and run them with a timer.

- **Exercises**: name, photo (from your phone), description and tags (muscle groups or your own). Tap tags to filter.
- **Workouts**: as many as you like, each an ordered list of steps
  - exercise for a time (e.g. Plank, 45 s)
  - exercise for a number of reps (e.g. Squats, 15 reps)
  - rest of any length
  - repeat block: a group of exercises and rests done several rounds in a row
- **Workout mode**: runs through the steps with a timer, beeps for the last 3 seconds and at every change, keeps the screen on. Rep steps wait until you tap **Done**. Shows the round inside repeat blocks.
- **Share**: send a single exercise or workout to a friend, or export everything (photos included) as a backup.
- Works offline. All data stays on the device.

No build step, no dependencies. Plain HTML, CSS and JavaScript.

## Try it on your computer

The app must be served over `http://localhost` (not opened as a file):

```bash
cd workout-app
python3 -m http.server 8000
```

Then open http://localhost:8000 in Chrome or Safari.

## Put it online with GitHub Pages (free)

A phone can only install the app from an `https://` address.

1. Create a free account on https://github.com and click **New repository**. Name it e.g. `workout-app`, set it to **Public**, and create it.
2. On the new repository page, click **uploading an existing file** and drag in **the contents** of this folder (`index.html`, `sw.js`, `manifest.webmanifest`, and the folders `css`, `js`, `icons`, `fonts`). Click **Commit changes**.
3. Go to **Settings → Pages**. Under *Branch*, choose `main` and `/ (root)`, then **Save**.
4. After a minute the page shows your address, e.g. `https://YOUR-NAME.github.io/workout-app/`.

## Install on the phone

**Android (Chrome):** open the address, tap the **⋮** menu and choose **Add to Home screen** / **Install app**.

**iPhone (Safari):** open the address, tap the **Share** button and choose **Add to Home Screen**.

Important on iPhone: the home-screen app has its own storage, separate from Safari. Add your exercises in the installed app, not in the Safari tab.

## Good to know

- **Sound on iPhone**: beeps are muted when the ring/silent switch is set to silent.
- **Screen stays on** during a workout on current Android and iOS versions. If it still turns off, check that power-saving mode is off.
- **Data lives on one device** (in the browser's IndexedDB). Deleting the app or clearing website data deletes your exercises and workouts.
- If you switch to another app during a workout, the running step keeps counting. When you come back, the next step starts from that moment.

## Tags

Each exercise can have tags: the built-in muscle groups (Chest, Back, Shoulders, Biceps, Triceps, Core, Glutes, Quads, Hamstrings, Calves, Full body, Cardio) and your own (**+ Own tag**). Tap tags above the exercise list, or in the "Add exercise" sheet of a workout, to filter. With several tags selected, only exercises that have **all** of them are shown. Only tags that some exercise uses appear in the filter.

## Repeat blocks

In a workout, **+ Repeat** adds a block with a number of rounds. Add exercises and rests inside it with its own buttons. The arrows move steps into a block (from the step right above or below it) and out of it (from its first or last step). Tap the block title to change the rounds, ungroup it, or delete it.

A rest at the end of a block is the rest between rounds: it is skipped after the last round. Add a separate rest after the block if you want one there.

## Sharing and backups

To share **one exercise or workout**, open it and tap **Share** at the top. A shared workout includes all exercises it uses, with photos.

On the **Share** tab:

- **Export** puts all exercises and workouts, with photos, into one `.json` file. On phones, **Share file** opens the share menu (WhatsApp, Mail, Files …). **Save file** downloads it.
- **Import** adds the contents of such a file. Nothing is ever deleted. Exercises and workouts that already exist (same id) are only replaced when the file has a newer version, so importing the same file twice is safe.
- Two different exercises with the same name (e.g. your "Push-ups" and a friend's "Push-ups") stay separate.

Exporting regularly is also the only backup, since the data lives on one device.

## Updating the app

After changing any file, open `sw.js` and raise `VERSION` (e.g. `'v1'` → `'v2'`), then upload the changed and new files again (when in doubt, upload the whole folder again). Phones load the new version the next time the app is opened (sometimes it takes a second restart of the app).

## Project structure

```
index.html            page shell and tab bar
manifest.webmanifest  app name, icons, colors for installing
sw.js                 offline support (caches all app files)
css/app.css           all styles, light and dark mode
js/app.js             router and workout list
js/editor.js          workout editor (steps, repeat blocks, step sheets)
js/exercises.js       exercise library and exercise form
js/tags.js            built-in tags, tag filter
js/share.js           Share tab, sharing single items
js/player.js          workout mode (timer, rounds, wake lock)
js/transfer.js        export and import (file format, checks, merging)
js/state.js           small shared navigation state
js/db.js              storage layer, the only file that touches the database
js/audio.js           beeps (Web Audio API)
js/ui.js              bottom sheets and confirm dialogs
js/utils.js           formatting, image resizing
js/icons.js           inline SVG icons
icons/, fonts/        app icons and bundled fonts
```

### Data model

```
Exercise  { id, name, description, tags[], image (Blob), createdAt, updatedAt }
Workout   { id, name, steps[], createdAt, updatedAt }
Step      { id, type: 'time', exerciseId, seconds }
        | { id, type: 'reps', exerciseId, reps }
        | { id, type: 'rest', seconds }
        | { id, type: 'repeat', rounds, steps[] }    one level only, no repeat inside a repeat
```

IDs are UUIDs, so records can later be merged with server data without collisions.

### Export file

```
{
  "format": "workout-timer",
  "version": 2,
  "exportedAt": "2026-10-21T18:00:00.000Z",
  "exercises": [ { ...exercise, "image": "data:image/jpeg;base64,..." } ],
  "workouts":  [ ...workouts ]
}
```

Photos are embedded as base64, so one file contains everything. Imported photos are re-encoded, and invalid steps or entries are skipped.

Version 2 added tags and repeat blocks. Version 1 files still import. An older app refuses version 2 files with a message to update the app.

## Extending later

- **Server / shared exercise library**: all storage goes through the `repo` object in `js/db.js`. Replace those functions with API calls (or add sync next to them); the rest of the app doesn't need to change.
- **App Store / Play Store**: the same code can be wrapped as a native Android and iOS app with [Capacitor](https://capacitorjs.com). Not needed for installing from the browser.

## Licenses

Fonts: *Big Shoulders Display* and *Atkinson Hyperlegible*, both under the SIL Open Font License 1.1.
