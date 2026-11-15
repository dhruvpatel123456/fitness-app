# Tucker Tally

A calorie and macro tracker that runs **on your own laptop**. You use it from your phone's browser and install it on the home screen like an app.

- Food diary, food search, barcode scanning with the phone camera, goals, recipes, exercise, water, weight and progress charts.
- **All your data stays on your laptop**, in one file. No accounts with the app, no ads, nothing paid.
- Metric units (kg, cm, g, mL), kcal (with a switch to kJ), dates as DD/MM/YYYY.
- One program, one address, one start command.

This guide assumes you have never done this before. Take it one section at a time.

> **How this guide was tested.** The app, its automated tests and a browser run on a phone-sized screen were all run on Linux. Everything else in this guide for Windows 11, macOS, iPhone, Android, Tailscale and mkcert is written from the official documentation of those tools and was **not** run on those systems. If a step does not match what you see on your screen, the Troubleshooting section at the end covers the common cases.

---

## Contents

1. [What you need](#1-what-you-need)
2. [Get the app and install it](#2-get-the-app-and-install-it)
3. [First run](#3-first-run)
4. [Connecting your phone](#4-connecting-your-phone) (Tailscale first)
5. [Add it to your phone's home screen](#5-add-it-to-your-phones-home-screen)
6. [Keep it running: firewall, start at boot, no sleep](#6-keep-it-running-firewall-start-at-boot-no-sleep) (Windows 11, macOS, Linux)
7. [Using the app](#7-using-the-app)
8. [Backup and restore](#8-backup-and-restore)
9. [Settings (the .env file) and the optional USDA key](#9-settings-the-env-file-and-the-optional-usda-key)
10. [Updating](#10-updating)
11. [Privacy: what leaves your laptop](#11-privacy-what-leaves-your-laptop)
12. [Troubleshooting](#12-troubleshooting)
13. [For developers](#13-for-developers)

---

## 1. What you need

- A laptop (Windows 11, macOS or Linux) that is usually on and at home. The app lives there.
- A phone (iPhone or Android) with a normal up-to-date browser (Safari on iPhone, Chrome on Android).
- **Node.js 22.12 or newer.** Easiest is the "LTS" version:
  - **Windows 11:** open *Terminal* (or PowerShell) and run `winget install OpenJS.NodeJS.LTS`, or download the installer from <https://nodejs.org>. Close and reopen the terminal afterwards.
  - **macOS:** download the "LTS" installer (.pkg) from <https://nodejs.org> and open it. (If you use Homebrew: `brew install node`.)
  - **Linux:** follow "Using a package manager" at <https://nodejs.org/en/download>. Your distribution's own `nodejs` package is often too old.

  Check it worked: open a new terminal and run

  ```bash
  node --version
  ```

  It should print `v22.12.0` or higher (for example `v24.1.0`).
- **Internet on the laptop** for the first install, and later for looking up foods online. Foods you have used before still work with the internet off.
- No compiler or build tools are needed. The database library ships ready-made for Windows, macOS and Linux.

## 2. Get the app and install it

The code is on the `self-hosted` branch of the GitHub repository `dhruvpatel123456/fitness-app`.

**Option A: download a zip (no extra software).**
Open <https://github.com/dhruvpatel123456/fitness-app/tree/self-hosted>, click the green **Code** button, then **Download ZIP**. Unzip it somewhere permanent, for example `C:\Users\you\tucker-tally` on Windows or `~/tucker-tally` on macOS and Linux (not the Downloads folder, you will want to keep it).

**Option B: git.**

```bash
git clone -b self-hosted https://github.com/dhruvpatel123456/fitness-app.git tucker-tally
```

Then open a terminal **inside that folder** (the one that contains `package.json`):

- Windows: open the folder in File Explorer, click the address bar, type `powershell`, press Enter.
- macOS: right-click the folder in Finder, choose *New Terminal at Folder* (or open Terminal and `cd` into it).
- Linux: `cd` into it.

Install everything, build the app and create the empty database with one command:

```bash
npm run setup
```

This takes one to three minutes and ends with a line starting `Database ready at …`. If it stops with a red error, see [Troubleshooting](#12-troubleshooting).

## 3. First run

```bash
npm start
```

You will see something like this:

```
  Tucker Tally is running.

  On this laptop:   http://localhost:3000
  On your Wi-Fi:    http://192.168.1.23:3000

  Scan this with your phone camera to open http://192.168.1.23:3000
  (a QR code appears here)

  Leave this window open. Press Ctrl+C to stop the app.
```

1. On the laptop, open <http://localhost:3000> in a browser.
2. **Choose a PIN or password** (at least 4 characters; longer is better). This is asked only once, on first run. It is stored scrambled (bcrypt), never as text.
3. Answer the short set-up questions (sex, age, height, weight, goal weight, activity level, weekly goal). The app works out your daily calorie target and macro split. You can change every number later in *Settings → Goals and targets*.
4. If the target would be below 1,500 kcal (male) or 1,200 kcal (female), the app warns you and asks you to confirm.

Leave the terminal window open: closing it stops the app. (Section 6 shows how to make it start by itself.)

To stop the app, press **Ctrl+C** in that window.

## 4. Connecting your phone

Your phone needs to reach the laptop. **Two things matter:**

- The **camera barcode scanner** and **Add to Home Screen** only work on a secure (`https://`) address. Phones refuse them on plain `http://`.
- **Never open the app to the internet.** Do not set up "port forwarding" on your router for this app. Both methods below keep it private.

Pick one:

| | Plan A: Tailscale (recommended) | Plan B: mkcert (no accounts at all) |
|---|---|---|
| Works away from home Wi-Fi | **Yes** (over mobile data too) | No, only on your home Wi-Fi |
| Needs an account | Yes, a free Tailscale account (you sign in with a Google, Microsoft, Apple or GitHub login) | No |
| Setup time | About 5 minutes | About 10 minutes |
| HTTPS address | `https://<laptop>.<tailnet>.ts.net` (real certificate, nothing to trust by hand) | `https://<laptop-address>:3443` (you install a certificate on the phone) |

If you want no third-party account of any kind, use Plan B.

### Plan A: Tailscale

Tailscale makes a private network (a "tailnet") containing only your own devices. Your food data travels between your phone and laptop inside that private network, encrypted. It does not go through Tailscale's servers as readable data, and the app is **not** reachable by anyone else.

**Step 1. Make a Tailscale account.** Go to <https://login.tailscale.com/start> and sign in with an existing Google, Microsoft, Apple or GitHub login. The free "Personal" plan is enough.

**Step 2. Install Tailscale on the laptop** and sign in with the same account:

- Windows 11: download from <https://tailscale.com/download/windows>, run the installer, sign in when the browser opens.
- macOS: install *Tailscale* from the Mac App Store or <https://tailscale.com/download/mac>, open it, sign in.
- Linux: run

  ```bash
  curl -fsSL https://tailscale.com/install.sh | sh
  sudo tailscale up
  ```

  and open the link it prints to sign in.

**Step 3. Install Tailscale on the phone** (App Store for iPhone, Google Play for Android), sign in with the **same** account, and switch it on (the VPN toggle inside the app; accept the "add VPN configuration" prompt). The laptop and phone now appear in each other's device list.

**Step 4. Give the laptop a plain name.** The machine name becomes part of the web address, and Tailscale's HTTPS certificates are recorded in **public** certificate logs, which means the machine name and your tailnet name become publicly visible (never your food data). So avoid putting your real name in it. In the Tailscale admin page <https://login.tailscale.com/admin/machines>, click the laptop's menu (⋯) → *Edit machine name* → for example `tracker-laptop`.

**Step 5. Turn on HTTPS for your tailnet (one time).** Open <https://login.tailscale.com/admin/dns>. Make sure **MagicDNS** is on and press **Enable HTTPS** under *HTTPS Certificates*. (New tailnets usually have these on already; if they are not, the command in step 6 prints a link that does the same.)

**Step 6. Publish the app privately.** Start the app (`npm start`, leave that window open), then open a **second** terminal and run:

```bash
tailscale serve --bg 3000
```

(If you changed `PORT` in `.env`, use that number instead of 3000. On macOS, if `tailscale` is "command not found" with the App Store version, run `/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg 3000` instead.)

It prints your address, which looks like `https://tracker-laptop.tail1234.ts.net`. You can show it again any time with `tailscale serve status`.

`--bg` means it keeps working after you close the terminal and comes back after a reboot. "Serve" is private to your tailnet. (Do **not** use `tailscale funnel`: that one publishes to the whole internet.)

**Step 7. Open it on the phone.** With the Tailscale VPN switched on, open that `https://…ts.net` address in Safari or Chrome. The first load can take up to half a minute while the certificate is created. Enter your PIN. Done. Add it to the home screen next ([section 5](#5-add-it-to-your-phones-home-screen)).

Tips:
- Make the start-up message show this address: add `PUBLIC_URL=https://tracker-laptop.tail1234.ts.net` to `.env`.
- If you only ever use Tailscale, add `HOST=127.0.0.1` to `.env`. The app then refuses connections from the Wi-Fi entirely and only Tailscale can reach it.
- On Windows, to keep Tailscale connected when nobody is signed in: Tailscale icon → *Preferences* → *Run unattended*.
- To stop publishing: `tailscale serve reset`.

### Plan B: mkcert (home Wi-Fi only, no accounts)

[mkcert](https://github.com/FiloSottile/mkcert) makes a small private certificate authority on your laptop and a certificate signed by it. You tell your phone to trust that authority once.

**Step 1. Give the laptop a fixed address on your home network.** In your router's settings find "DHCP reservation" or "static lease" and reserve an address for the laptop (this stays inside your home network; it is not port forwarding). Note the address, for example `192.168.1.23`. (The app prints it as "On your Wi-Fi" when it starts.)

**Step 2. Install mkcert on the laptop.**

- Windows 11: `winget install FiloSottile.mkcert` (or `choco install mkcert`, or `scoop install mkcert`).
- macOS: `brew install mkcert`
- Linux: install your package named `mkcert` (Ubuntu/Debian: `sudo apt install mkcert libnss3-tools`) or download it from <https://github.com/FiloSottile/mkcert/releases>.

**Step 3. Create the certificate** (in the app folder; use your own laptop address):

```bash
mkcert -install
mkdir certs
mkcert -cert-file certs/laptop.pem -key-file certs/laptop-key.pem localhost 127.0.0.1 192.168.1.23
```

**Step 4. Tell the app to use it.** Copy `.env.example` to `.env` ([section 9](#9-settings-the-env-file-and-the-optional-usda-key)), and set:

```
HTTPS_CERT_FILE=certs/laptop.pem
HTTPS_KEY_FILE=certs/laptop-key.pem
```

Restart the app. The start-up message now also shows `Wi-Fi (HTTPS): https://192.168.1.23:3443` and the QR code points to it.

**Step 5. Let your phone trust the certificate authority.** Find the file `rootCA.pem`: run `mkcert -CAROOT` and open the folder it prints. **Never share `rootCA-key.pem`** from that folder with anyone.

- **iPhone:**
  1. Copy `rootCA.pem` to a new file called `rootCA.crt` (iPhones ignore the `.pem` name).
  2. Send it to the phone with AirDrop (or email it to yourself and open the attachment on the phone).
  3. Tap it, then *Settings → General → VPN & Device Management → (the mkcert profile) → Install*.
  4. Then *Settings → General → About → Certificate Trust Settings* → switch **on** the toggle for the mkcert certificate.
- **Android:**
  1. Copy `rootCA.pem` to the phone (USB cable, Google Drive, or email), into any folder except Downloads.
  2. *Settings → Security & privacy → More security settings → Encryption & credentials → Install a certificate → CA certificate* (the wording differs a little between phone brands; search "CA certificate" in Settings). Accept the warning and choose the file.

**Step 6. Open `https://192.168.1.23:3443`** on the phone (on your home Wi-Fi). There should be no certificate warning. If the laptop's address ever changes, make a new certificate with Step 3.

If you remove the app one day, remove the mkcert certificate authority from the phone too (same settings screens).

### What if I open it over plain `http://`?

The app still works, with two limits it explains on screen: the camera scanner is hidden (you can type the barcode number instead), and the phone will not offer to install it. Nothing crashes.

## 5. Add it to your phone's home screen

Do this from the **https** address.

- **iPhone (Safari):** tap the Share button (square with an arrow) → **Add to Home Screen** → *Add*. Open it from the new icon. (It must be Safari: other iPhone browsers cannot install it on older iOS versions.)
- **Android (Chrome):** tap the three-dots menu → **Install app** (or **Add to Home screen**) → *Install*. *Settings → Install on this phone* inside the app also explains the steps for your phone.

The camera asks for permission the first time you scan. Choose **Allow**. If you said no by mistake, see "Camera won't open" in [Troubleshooting](#12-troubleshooting).

## 6. Keep it running: firewall, start at boot, no sleep

The app only works when the laptop is **on, awake and the app is running**. This section sets that up. Open the section for your system.

Which parts do you need?

- **Firewall:** only if you use Plan B or plain Wi-Fi (the phone connects straight to the laptop). With Tailscale (Plan A), connections reach the app through Tailscale on the laptop itself, so no firewall change is needed.
- **Start at boot:** recommended for everyone.
- **No sleep while plugged in:** recommended for everyone, otherwise the phone loses the laptop when it falls asleep.

### Windows 11

**Firewall.** The easiest way: the first time you run `npm start`, Windows shows *"Windows Defender Firewall has blocked some features of Node.js"*. Tick **Private networks** only (leave *Public networks* unticked) and press **Allow access**.

Or do it with a command. Open *Terminal (Admin)*: right-click the Start button → *Terminal (Admin)*, then (change 3000 if you changed `PORT`; for Plan B also open 3443):

```powershell
New-NetFirewallRule -DisplayName "Tucker Tally" -Direction Inbound -Protocol TCP -LocalPort 3000,3443 -Action Allow -Profile Private
```

`-Profile Private` limits it to networks Windows calls "Private". Check your home Wi-Fi is set to Private: *Settings → Network & internet → Wi-Fi → (your network) → Network profile type → Private*.

**Start when you sign in** (no administrator rights needed). Open PowerShell **in the app folder** (see section 2) and run:

```powershell
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\Tucker Tally.lnk")
$lnk.TargetPath = "$PWD\scripts\autostart\windows-start.cmd"
$lnk.WorkingDirectory = "$PWD"
$lnk.WindowStyle = 7
$lnk.Save()
```

That puts a shortcut in your Startup folder that runs `scripts\autostart\windows-start.cmd` minimised. It starts the app each time you sign in and starts it again 5 seconds later if it ever stops. To remove it: press `Win+R`, type `shell:startup`, delete the *Tucker Tally* shortcut. If you move the app folder, run these lines again.

The app starts when **you sign in**, not before. To make a restarted laptop sign itself in, you can turn on automatic sign-in (press `Win+R`, type `netplwiz`; if the tick box is missing, turn off *Settings → Accounts → Sign-in options → "For improved security, only allow Windows Hello sign-in"*). Only do this on a laptop that stays at home, because anyone who switches it on can then use it.

**No sleep while plugged in.** In the same Terminal:

```powershell
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change monitor-timeout-ac 10
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
powercfg /setactive SCHEME_CURRENT
```

That means: never sleep or hibernate on the charger, turn the screen off after 10 minutes, and do nothing when the lid closes on the charger. The same thing by mouse: *Settings → System → Power & battery → Screen, sleep & hibernate timeouts → "When plugged in, put my device to sleep after" → Never*; lid: Control Panel → *Power Options → Choose what closing the lid does → When plugged in: Do nothing*. Keep the laptop ventilated if you close the lid.

### macOS

**Firewall.** The macOS firewall is off by default, then nothing is needed. If it is on (*System Settings → Network → Firewall*), the first `npm start` shows *"Do you want the application 'node' to accept incoming network connections?"* → **Allow**. Or in Terminal:

```bash
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add "$(command -v node)"
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp "$(command -v node)"
```

(macOS allows programs, not port numbers.)

**Start when you log in, and restart if it stops.** In Terminal, **inside the app folder**, run this whole block as it is:

```bash
mkdir -p ~/Library/LaunchAgents ~/Library/Logs
cat > ~/Library/LaunchAgents/local.tuckertally.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>local.tuckertally</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string>
    <string>-s</string>
    <string>$(command -v node)</string>
    <string>server/index.js</string>
  </array>
  <key>WorkingDirectory</key><string>$PWD</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/tucker-tally.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/tucker-tally.log</string>
</dict>
</plist>
EOF
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.tuckertally.plist
```

The app is now running in the background (open <http://localhost:3000> to check). `caffeinate -s` also keeps the Mac awake while it is on the charger. Useful commands:

```bash
tail -f ~/Library/Logs/tucker-tally.log
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/local.tuckertally.plist
```

The first shows the app's messages (including the web address), the second stops it. (To start it again: re-run the `launchctl bootstrap …` line.) If you installed Node with `nvm`, the path is stored inside the file, so redo this block after changing Node versions.

This starts when **you log in**. For a Mac that must come back after a restart without you: *System Settings → Users & Groups → Automatically log in as…* (not available if FileVault disk encryption is on).

**No sleep while plugged in.** In Terminal:

```bash
sudo pmset -c sleep 0
sudo pmset -c displaysleep 10
```

(`-c` = only on the charger.) On a MacBook, closing the lid still sleeps it, unless an external display is connected (a feature called clamshell mode), so leave the lid open.

### Linux

**Firewall.** Many Linux installs have no firewall switched on, then nothing is needed. Otherwise, allow the port **from your home network only** (not the whole internet):

- Ubuntu / Debian (ufw):

  ```bash
  sudo ufw allow from 192.168.0.0/16 to any port 3000 proto tcp
  sudo ufw allow from 192.168.0.0/16 to any port 3443 proto tcp
  ```

  (Use `10.0.0.0/8` instead if your home network addresses start with `10.`. Skip the 3443 line unless you use Plan B.)
- Fedora / RHEL (firewalld): add `--add-port` for the home zone, for example `sudo firewall-cmd --permanent --zone=home --add-port=3000/tcp && sudo firewall-cmd --reload`, and make sure your Wi-Fi is in the `home` zone.

**Start at boot, restart if it stops** (a systemd service). In the app folder, run this block as it is:

```bash
sudo tee /etc/systemd/system/tucker-tally.service >/dev/null <<EOF
[Unit]
Description=Tucker Tally calorie tracker
After=network-online.target
Wants=network-online.target

[Service]
User=$USER
WorkingDirectory=$PWD
ExecStart=$(command -v node) server/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now tucker-tally
```

Check it with `systemctl status tucker-tally` and read its messages with `journalctl -u tucker-tally -n 50`. Stop it with `sudo systemctl disable --now tucker-tally`. (If Node came from `nvm`, the path in the file will break when you change Node versions; install Node from a package instead, or redo this block.)

**No sleep while plugged in.**

- GNOME (Ubuntu, Fedora): *Settings → Power → Automatic Suspend → Plugged In → Off*. Or:

  ```bash
  gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type 'nothing'
  ```
- Lid closed on the charger (works on any desktop):

  ```bash
  sudo mkdir -p /etc/systemd/logind.conf.d
  printf '[Login]\nHandleLidSwitchExternalPower=ignore\n' | sudo tee /etc/systemd/logind.conf.d/tucker-tally.conf
  ```

  then restart the laptop once.
- KDE: *System Settings → Power Management → On AC Power → Suspend session → Never*.

## 7. Using the app

Bottom bar: **Diary**, **Progress**, the green **+**, **Foods**, **Settings**.

- **Log a food (fastest):** tap **+**. The *Recent* list is at the top. Tap the round **+** next to a food and it is added to the meal that fits the time of day, with the serving you used last time. That is two taps from opening the app. Tap the food's name instead to change the serving first.
- **Search:** type in the box. Your own foods come first, then results from Open Food Facts (packaged foods, Australian products first) and USDA (generic foods, if you set a key). Foods you add from online results are saved on your laptop, so they work offline later.
- **Barcode:** tap the barcode button next to the search box and point the camera at the barcode. Unknown barcode? It opens a blank *Create a food* form with the number filled in. Next time it is found straight away.
- **Change an entry:** tap it to change servings, serving size or meal. **Swipe left** to delete (an *Undo* button appears for a few seconds).
- **Days:** use the arrows, the date in the middle, or swipe sideways on the top part. Tapping the **Diary** tab again returns to today.
- **Copy:** the **⋯** menu on a meal copies that meal to another day; the **⋯** at the top copies the whole day. *Save as a saved meal* turns a meal into a one-tap shortcut.
- **Recipes:** *Foods → Recipes → New recipe*. Add ingredients and how many servings it makes; nutrition per serving is worked out for you. Log a recipe like any food.
- **Exercise, water, notes:** cards further down the Diary page.
- **Progress:** weight (with trend line and goal), calories against your goal, macro split, body measurements and your logging streak.
- **Foods with missing numbers:** when a food has no value for something (for example fibre), the app shows "unknown" and leaves it out of totals rather than counting zero.

## 8. Backup and restore

Your whole diary is one file: `data/tucker-tally.sqlite` inside the app folder.

**Automatic backups.** Once a day (and at start-up) the app copies the database into the `backups` folder, keeping the newest 14. For protection against the laptop dying, point `BACKUP_DIR` at a synced or external drive (see `.env.example`), or copy the `backups` folder somewhere else now and then.

**Back up now:** in the app, *Settings → Data and backups → Back up now*, or in a terminal in the app folder:

```bash
npm run backup
```

**Export:** *Settings → Data and backups* gives you a full **JSON** export (everything, importable) and a **CSV** of your diary (for spreadsheets).

**Restore a backup file:**

1. Stop the app (Ctrl+C, or stop the background service from section 6).
2. In the app folder, run (using the file name you want):

   ```bash
   npm run restore -- backups/tucker-tally-daily-2026-11-15.sqlite
   ```

   The command checks the file is a healthy Tucker Tally database first. The database it replaces is kept next to it in `data/` as `before-restore-….sqlite`, so nothing is lost by mistake.
3. Start the app again.

**Restore a JSON export instead** (for example onto a new laptop): finish *First run* and set a PIN, then *Settings → Data and backups → Import from a JSON export* and choose the file. Importing replaces what is in the app, so it asks you to confirm.

**Move to a new laptop:** install the app there, then either copy `data/tucker-tally.sqlite` into its `data` folder before the first start, or use the JSON export and import above.

**Erase everything:** *Settings → Data and backups → Erase all data* (asks for your PIN). Export first if you might want it back.

## 9. Settings (the .env file) and the optional USDA key

Every setting has a default, so you can skip this section. To change one:

1. Copy `.env.example` to `.env` (Windows PowerShell: `Copy-Item .env.example .env`; macOS/Linux: `cp .env.example .env`).
2. Open `.env` in any text editor, remove the `#` in front of the setting you want and change the value. `.env.example` explains every setting.
3. Stop and start the app again.

The ones you are most likely to want: `PORT`, `BACKUP_DIR`, `PUBLIC_URL`, `HTTPS_CERT_FILE` / `HTTPS_KEY_FILE`, and `USDA_API_KEY`.

**USDA key (optional, free).** It adds generic foods such as "banana, raw". Request a key at <https://fdc.nal.usda.gov/api-key-signup> (it arrives by email), put `USDA_API_KEY=your-key` in `.env`, restart. Without the key, everything else still works.

Settings you change inside the app (units, kcal or kJ, meal names, water glass size, PIN, theme, targets) are in **Settings** and are saved in the database.

## 10. Updating

1. Back up first (section 8).
2. Stop the app.
3. Get the new version: if you used git, run `git pull` in the app folder; if you used the zip, download the new zip, unzip it into a new folder, and copy your old `data` folder and `.env` file into it.
4. Run `npm run setup` again (it installs, rebuilds and upgrades the database safely; your data is kept).
5. Start the app again.

Database changes are applied by numbered migration files, in order, once each.

## 11. Privacy: what leaves your laptop

| What | Where it goes |
|---|---|
| Your diary, weight, foods, goals, PIN (scrambled) | **Nowhere.** Only in `data/tucker-tally.sqlite` and its backups on your laptop. |
| Food searches and barcode look-ups | The search text or barcode number goes to Open Food Facts (`openfoodfacts.org`) and, if you set a key, USDA (`api.nal.usda.gov`) by the laptop, never by the phone. Nothing that identifies you is sent. |
| Tailscale (Plan A only) | Tailscale knows your account and device names. Your food data is carried encrypted between your own devices. The machine name appears in public certificate logs (section 4). |
| Anything else | Nothing. No analytics, no ads, no fonts or scripts loaded from other sites. |

Sign-in uses a long-lived cookie that only your browser sends back (it cannot be read by page scripts). After 5 wrong PIN tries from one address, further tries are refused for 15 minutes.

## 12. Troubleshooting

### "Phone can't reach the laptop"

Work down this list:

1. **Is the app running?** On the laptop, `http://localhost:3000` must open. If not, start it (`npm start`).
2. **Is the laptop awake?** Sleep cuts the connection. See *No sleep* in section 6.
3. **Plan A (Tailscale):**
   - On the phone, is the Tailscale app **switched on** (VPN key icon at the top of the screen)?
   - Is the laptop connected? Open <https://login.tailscale.com/admin/machines>: it should show a green dot.
   - Did you run `tailscale serve --bg 3000` *after* starting the app? `tailscale serve status` shows what is published. Is the port in that command the same as `PORT`?
   - Use the exact `https://…ts.net` address, with `https://`.
4. **Plan B / Wi-Fi:**
   - Are phone and laptop on the **same Wi-Fi**? Guest networks and some "AP isolation" settings stop devices seeing each other. Mobile data will not work in Plan B.
   - Is the address current? The laptop's address can change; the start-up message shows the current one. (Fix: the router reservation in Plan B, Step 1.)
   - **Firewall** (section 6). On Windows, check the Wi-Fi is set to *Private*.
   - VPN apps on the phone or laptop can block local addresses. Switch them off to test.
5. While the phone cannot reach the laptop the app shows an **Offline** bar and keeps trying by itself. What you typed stays in the box and is saved when the connection returns.

### "Camera won't open"

- The address must start with `https://` (the app says so on the scanner screen if not). See section 4.
- **iPhone:** *Settings → Safari → Camera → Ask/Allow*, and for the home-screen app *Settings → Safari → Camera*. If you tapped Don't Allow, delete the home-screen icon, open the address in Safari, and allow again.
- **Android (Chrome):** the padlock/tune icon in the address bar → *Permissions → Camera → Allow*. For the installed app: long-press the icon → *App info → Permissions → Camera → Allow*.
- Another app may be using the camera. Close it.
- No camera at all (or you simply prefer to): type the barcode digits in the box under the camera view and press *Look up*.
- Scanning is slow or misses: more light, hold 15 to 25 cm away, keep the barcode flat and inside the frame, and use the torch button (where the phone offers one).

### "Barcode not found"

- Open Food Facts is built by volunteers, so some products are missing. The app then opens a *Create a food* form with the barcode filled in. Type the numbers from the pack's label once; the next scan finds it instantly.
- Check the internet is working on the laptop. If the online database is slow or down, the app waits 5 seconds, then tells you it could not look it up and lets you create the food.
- Barcodes on fruit, bakery or deli items are shop codes, not product codes, and are not in public databases.
- Typed it by hand? 13 digits for most packaged food (EAN-13), 8 digits for small items. Leading zeros matter. The app also tries the common variants with and without a leading zero.

### "Port already in use"

The app prints `Port 3000 is already in use`. Either it is already running somewhere (look for another terminal window, the background service from section 6, or an old window; stop that one), or another program uses the port.
Choose a different port: put `PORT=3001` in `.env`, restart, and use the new number in the address (and in `tailscale serve --bg 3001`).

To see what holds the port:
- Windows: `netstat -ano | findstr :3000`
- macOS / Linux: `lsof -i :3000`

### `npm run setup` fails

- *"This app needs Node.js 22.12 or newer"*: install the current LTS from <https://nodejs.org>, open a **new** terminal, run `node --version`, try again.
- *"npm: command not found"* / *"'npm' is not recognized"*: Node is not installed or the terminal was opened before installing. Close and reopen it.
- Network errors during install: check the laptop's internet connection (a company or school network may block the npm registry), then run `npm run setup` again.
- Something half-installed: delete the `node_modules` folder and run `npm run setup` again.

### Other things

- **"I forgot my PIN."** Stop the app. Your data is not lost: copy `data/tucker-tally.sqlite` somewhere safe, then in the app folder run `node -e "const D=require('better-sqlite3');const d=new D('data/tucker-tally.sqlite');d.exec('DELETE FROM auth; DELETE FROM sessions;');console.log('PIN cleared')"` and start the app: it asks you to choose a new PIN, and your diary is still there. (Anyone with access to your laptop's files could do this, which is why the laptop's own login matters.)
- **Dates look a day off.** The diary uses the date on the phone. Check the phone's date, time and time zone are set to automatic.
- **After a long sleep the home-screen app looks stale.** Pull to refresh or close and reopen it; it reloads when it reconnects.
- **I want to see the app's messages.** They are in the terminal window (or the log from section 6).

## 13. For developers

```
server/      Express API (plain JavaScript, ES modules), SQLite via better-sqlite3
  migrations/  numbered .sql files, applied once each, in order
shared/      calculation code used by both server and browser (nutrition, goals, dates, trends)
src/         React + TypeScript front end (Tailwind CSS, TanStack Query, Recharts)
public/      icons, manifest, theme script
scripts/     check-node, migrate, backup, restore, Windows auto-start helper
tests/       automated tests (node:test) and a browser end-to-end script (tests/e2e)
```

| Command | What it does |
|---|---|
| `npm run setup` | install, build, create/upgrade the database |
| `npm start` | run the app (serves the built front end too) |
| `npm test` | automated tests: calculations and API routes |
| `npm run typecheck` | TypeScript check of the front end |
| `npm run dev` / `npm run dev:server` | front end dev server with reload (proxies `/api` to port 3000) / API with auto-restart |
| `npm run migrate` | apply database migrations only |
| `npm run backup` / `npm run restore -- <file>` | database backup and restore |

Rules the code follows: diary dates are local calendar dates (`YYYY-MM-DD`) and never UTC timestamps; nutrition is stored per 100 g or 100 mL, snapshotted into every diary entry, rounded only for display; a missing value is "unknown", never zero; every SQL statement is parameterised; foreign keys are on; every create request carries a client-made id so a double tap or retry never duplicates; online look-ups time out after 5 seconds and fall back to local data.

The browser end-to-end script is described in [`tests/e2e/README.md`](tests/e2e/README.md).
