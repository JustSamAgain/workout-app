# Workout Timer

A small installable web app (PWA) to build workouts from your own exercises and run them with a timer.

- **Exercises**: name, photo (from your phone) and description
- **Workouts**: as many as you like, each an ordered list of steps
  - exercise for a time (e.g. Plank, 45 s)
  - exercise for a number of reps (e.g. Squats, 15 reps)
  - rest of any length
- **Workout mode**: runs through the steps with a timer, beeps for the last 3 seconds and at every change, keeps the screen on. Rep steps wait until you tap **Done**.
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

## Updating the app

After changing any file, open `sw.js` and raise `VERSION` (e.g. `'v1'` → `'v2'`), then upload the changed files again. Phones load the new version the next time the app is opened (sometimes it takes a second restart of the app).

## Project structure

```
index.html            page shell and tab bar
manifest.webmanifest  app name, icons, colors for installing
sw.js                 offline support (caches all app files)
css/app.css           all styles, light and dark mode
js/app.js             router, workout list, workout editor, exercise library
js/player.js          workout mode (timer, steps, wake lock)
js/db.js              storage layer, the only file that touches the database
js/audio.js           beeps (Web Audio API)
js/ui.js              bottom sheets and confirm dialogs
js/utils.js           formatting, image resizing
js/icons.js           inline SVG icons
icons/, fonts/        app icons and bundled fonts
```

### Data model

```
Exercise  { id, name, description, image (Blob), createdAt, updatedAt }
Workout   { id, name, steps[], createdAt, updatedAt }
Step      { id, type: 'time', exerciseId, seconds }
        | { id, type: 'reps', exerciseId, reps }
        | { id, type: 'rest', seconds }
```

IDs are UUIDs, so records can later be merged with server data without collisions.

## Extending later

- **Server / shared exercise library**: all storage goes through the `repo` object in `js/db.js`. Replace those functions with API calls (or add sync next to them); the rest of the app doesn't need to change.
- **App Store / Play Store**: the same code can be wrapped as a native Android and iOS app with [Capacitor](https://capacitorjs.com). Not needed for installing from the browser.

## Licenses

Fonts: *Big Shoulders Display* and *Atkinson Hyperlegible*, both under the SIL Open Font License 1.1.
