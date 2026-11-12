# FitTrack — Calorie Counter

A free, mobile-first calorie counter that runs in your phone's browser and installs like an app.
No account and no server: all your data stays on your phone.

## Features
- **Barcode scanner**: scan packaged food with your phone camera, or scan from a photo, or type the numbers. Product nutrition comes from the free [Open Food Facts](https://world.openfoodfacts.org) database.
- **Unknown products**: if a barcode isn't in the database, enter it from the label once and it's remembered for next time.
- **Food search**: 80 built-in common foods (these work offline) plus millions of products from Open Food Facts.
- **Meal photos**: snap a photo of your meal, name it, and log calories (portion guides help you estimate).
- **Quick add & create food**: log just calories, or save your own foods and recipes.
- **Diary**: Breakfast / Lunch / Dinner / Snacks, plus exercise and water, with *Goal − Food + Exercise = Remaining*. Browse any day.
- **Dashboard**: calories remaining ring, carbs/fat/protein progress, steps, water, logging streak, 7-day chart.
- **Personal calorie goal**: calculated from your age, sex, height, weight, activity level and weekly goal (Mifflin-St Jeor), or set your own. Custom macro split.
- **Exercise**: 13 activity types with calorie estimates based on your weight.
- **Progress**: weight log with trend chart and goal line, 14-day calorie chart, BMI.
- **Works offline** and installs to your home screen (PWA). Back up or restore with Export/Import.

## Use it on your phone
Scan `qr-code.png` with your phone camera, or open the GitHub Pages link. Then:
- **iPhone (Safari)**: Share ⬆ → *Add to Home Screen*
- **Android (Chrome)**: menu ⋮ → *Install app* (or use the Install button in Settings)

The camera only works over **https**, which GitHub Pages provides.

## Run locally
```bash
python3 -m http.server 8000
```
Then open http://localhost:8000.

## Tech
Plain HTML, CSS and JavaScript, with no build step. The barcode decoding uses [html5-qrcode](https://github.com/mebjas/html5-qrcode) (Apache-2.0), included in `vendor/`.
