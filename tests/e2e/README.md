# Browser end-to-end check

`phone-flows.cjs` drives the real app in an emulated iPhone (Chromium through Playwright) the way a person would: it sets a PIN, answers the set-up questions, logs foods, searches, scans a barcode with a fake camera, builds a recipe, logs exercise and water, looks at the charts, changes settings, goes offline, and checks the midnight rollover (11:55 pm and 12:05 am entries landing on the right days).

It is a developer tool. It is **not** part of `npm test` (which needs no browser), and you do not need it to use the app.

It passed 25 of 25 flows with no browser console errors when last run (Linux, Chromium).

## What it needs

1. **Playwright** with a Chromium browser: `npm install --no-save playwright` in a scratch folder (or globally), then `npx playwright install chromium`. The script does `require('playwright')`.
2. **The app running on a fresh, empty database** (the script sets the PIN `246810` on first run) with the stand-in food databases instead of the real internet:

   ```bash
   # terminal 1: pretend Open Food Facts + USDA, on port 4010
   node tests/e2e/mock-online.mjs 4010

   # terminal 2: the app on port 3100, data in a throw-away folder
   npm run build
   PORT=3100 DATA_DIR=/tmp/tt-e2e/data BACKUP_DIR=/tmp/tt-e2e/backups \
   OFF_BASE_URL=http://127.0.0.1:4010 USDA_BASE_URL=http://127.0.0.1:4010 \
   USDA_API_KEY=TESTKEY BCRYPT_ROUNDS=6 node server/index.js
   ```

   (On Windows set those variables with `$env:PORT=3100` and so on before `node server/index.js`.) Delete the throw-away data folder between runs.
3. Optional: a video for the fake camera. The camera test needs a Motion-JPEG video of the barcode `9300633000011` (the stand-in "Wholegrain Biscuits"); without `BARCODE_VIDEO` that one flow is skipped. One way to make it: render the barcode to an image and run

   ```bash
   ffmpeg -loop 1 -i barcode.jpg -t 5 -r 10 -c:v mjpeg barcode.mjpeg
   ```

## Running it

```bash
APP_URL=http://localhost:3100 \
LAN_URL=http://<your-laptop-lan-ip>:3100 \
BARCODE_VIDEO=/path/to/barcode.mjpeg \
SHOTS=/tmp/tt-e2e/shots \
node tests/e2e/phone-flows.cjs
```

| Variable | Meaning |
|---|---|
| `APP_URL` | Where the app is (default `http://localhost:3100`). `localhost` counts as a secure context, so the camera works. |
| `LAN_URL` | Optional. The same app by its plain-http network address, to check the "camera hidden, no crash, typing a barcode still works" behaviour. |
| `BARCODE_VIDEO` | Optional. Video for Chromium's fake camera. |
| `SHOTS` | Folder for screenshots (default `tests/e2e/shots`, git-ignored if you add it). |

The script prints one line per flow and a summary. It exits with a non-zero code if any flow fails or the browser console shows an error. A failed flow also saves `fail-….png` in the screenshots folder.

## What this does not prove

It uses Chromium's fake camera and a pretend food database. It does not test a real iPhone or Android phone, Safari, a real camera or the real Open Food Facts and USDA services.
