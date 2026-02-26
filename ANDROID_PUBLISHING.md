# Android Publishing Guide — PWA to Google Play Store (TWA)

This guide documents how to take an existing Progressive Web App (PWA) and publish it to the Google Play Store using a **Trusted Web Activity (TWA)**. A TWA wraps your hosted web app in a native Android shell — no rewrite required.

---

## Prerequisites

| Requirement | Details |
|---|---|
| Deployed PWA | Must be live on HTTPS with a valid `manifest.json` |
| `manifest.json` | Must have `name`, `short_name`, `icons` (192px + 512px), `start_url`, `display: standalone` |
| Node.js | v18+ recommended |
| Google Play Developer account | One-time $25 fee at [play.google.com/console](https://play.google.com/console) |
| Android Studio *(optional)* | Only needed if testing on emulator |

---

## Step 1 — Install Bubblewrap

[Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) is Google's official CLI for generating TWA projects from a PWA manifest.

```bash
npm install -g @bubblewrap/cli
```

---

## Step 2 — Initialise the TWA Project

Run this from your project root, pointing at your live manifest:

```bash
bubblewrap init --manifest https://your-domain.com/manifest.json
```

You will be prompted to answer several questions:

| Prompt | Recommended answer |
|---|---|
| Domain / Origin | `your-domain.com` |
| Application ID | `com.yourname.appname` (reverse domain format) |
| App name | Your app's full name |
| Short name | Short version (launcher label) |
| Start URL | `/` |
| Display mode | `standalone` |
| Orientation | Match your `manifest.json` (e.g. `portrait`) |
| Theme / status bar color | Match your `theme_color` |
| Background color | Match your `background_color` |
| Include Play Billing | `No` (unless you have in-app purchases) |
| Key store path | Accept default (saves in project root) |
| Key store password | Choose a strong password — **save this, you need it for every update** |
| Key alias | Any name (e.g. your app name) |
| Key password | Same as key store password |

This generates:
- `twa-manifest.json` — TWA configuration
- `android.keystore` — signing key (keep this safe, never commit to git)
- Android project files (`app/`, `build.gradle`, etc.)

---

## Step 3 — Build the App Bundle

```bash
bubblewrap build
```

On first run, Bubblewrap downloads the Android SDK automatically (~5 min). You will be prompted to:
1. **Accept the Android SDK license** — type `y`
2. **Enter your keystore password** — the one you chose in Step 2

This generates two files:
- `app-release-signed.apk` — for sideloading / emulator testing
- `app-release-bundle.aab` — for uploading to Google Play Store

---

## Step 4 — Set Up Digital Asset Links

TWA requires domain verification via a Digital Asset Links file. This proves your Android app and website belong to the same owner.

### 4a — Get your SHA-256 fingerprint

```bash
# macOS / Linux
/path/to/android_sdk/build-tools/35.0.0/apksigner verify --print-certs app-release-signed.apk | grep "SHA-256"
```

The output looks like:
```
Signer #1 certificate SHA-256 digest: fe08d0...
```

Convert it to colon-separated uppercase format:
```bash
echo "fe08d0..." | sed 's/../&:/g;s/:$//' | tr '[:lower:]' '[:upper:]'
# → FE:08:D0:...
```

### 4b — Create the asset links file

Create `.well-known/assetlinks.json` in your project root:

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.yourname.appname",
    "sha256_cert_fingerprints": ["FE:08:D0:...your fingerprint here..."]
  }
}]
```

### 4c — Serve it with correct headers

Create `netlify.toml` (or equivalent for your host) to ensure the file is served correctly:

```toml
[build]
  publish = "."
  functions = "netlify/functions"

[[headers]]
  for = "/.well-known/assetlinks.json"
  [headers.values]
    Content-Type = "application/json"
    Access-Control-Allow-Origin = "*"
```

### 4d — Deploy and verify

Push to your host and confirm the file is live:
```
https://your-domain.com/.well-known/assetlinks.json
```

---

## Step 5 — Add Android Build Files to .gitignore

Add the following to `.gitignore` — **never commit your keystore or APKs**:

```gitignore
# Android / TWA build artifacts
*.apk
*.aab
*.idsig
android.keystore
.gradle/
build/
app/build/
local.properties
manifest-checksum.txt
```

---

## Step 6 — Test on Emulator (Optional)

If you don't have a physical Android device:

1. Download and install [Android Studio](https://developer.android.com/studio)
2. Open **Tools → Device Manager → Create Device**
3. Choose a Pixel model, API 33 (Android 13) or higher
4. Start the emulator
5. Install your APK:

```bash
# Find adb (installed with Android Studio or Bubblewrap)
adb devices  # confirm emulator is listed

adb install app-release-signed.apk
```

The app will appear in the emulator's app drawer. It should open full-screen with no browser address bar — if you see an address bar, the Digital Asset Links file hasn't been picked up yet (give it a minute and reopen).

---

## Step 7 — Prepare Play Store Assets

| Asset | Spec | Notes |
|---|---|---|
| App icon | 512×512 PNG, no transparency, max 1MB | Must have solid background |
| Feature graphic | 1024×500 PNG or JPG | Banner shown at top of store listing |
| Screenshots | Min 2, PNG/JPG, 320px–3840px each side | Capture from emulator or real device |
| Privacy policy | Public URL | Required for all apps |

### Fix icon transparency (if needed)

If your icon has an alpha channel, flatten it against your background color before uploading:

```python
# fix_icon.py — flatten PNG alpha onto solid background
import struct, zlib

def paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p-a), abs(p-b), abs(p-c)
    if pa <= pb and pa <= pc: return a
    if pb <= pc: return b
    return c

# See full script in project repo
```

Or use any image editor (Photoshop, GIMP, Figma) to export with a solid background.

---

## Step 8 — Play Store Submission

### 8a — Create the app in Play Console

1. Go to [play.google.com/console](https://play.google.com/console)
2. **Create app** → fill in name, language, free/paid
3. Complete the **Publishing overview** checklist:
   - **App content**: content rating questionnaire, target audience, data safety
   - **Store listing**: title, descriptions, icon, screenshots, feature graphic
   - **Pricing & distribution**: free, select countries

### 8b — Content rating

Complete the questionnaire honestly. For a simple content/reading app with no user interaction, violence, or purchases, you will likely receive an **Everyone** rating.

### 8c — Data safety

If your app collects no personal data:
- No data collected ✅
- No data shared ✅
- Data is not sold ✅

### 8d — Store listing copy

**Short description** (max 80 chars):
> Summarise your app's core value in one sentence.

**Full description** (max 4000 chars):
> Cover: what the app does, key features, who it's for. Use bullet points for scannability.

### 8e — Upload the bundle

Go to **Production → Create new release** (or **Closed testing** if required):
- Upload `app-release-bundle.aab`
- Add release notes
- Save and review

### 8f — Closed testing (new accounts)

New Google Play developer accounts may be required to run a closed test with:
- At least **12 testers**
- For at least **14 days**

Before promoting to Production.

---

## Step 9 — After Approval

Once live on the Play Store, future updates follow this process:

1. Make changes to your web app and deploy
2. If the app logic/config changes (package name, permissions, etc.), rebuild:
   ```bash
   bubblewrap build
   # enter keystore password when prompted
   ```
3. Upload the new `app-release-bundle.aab` to a new release in Play Console
4. Increment the version code in `twa-manifest.json` for each release

> **Important:** Keep your `android.keystore` file and password backed up securely. If you lose it, you cannot publish updates to your existing app — you would have to create a new listing from scratch.

---

## Troubleshooting

| Issue | Fix |
|---|---|
| Address bar visible in TWA | `assetlinks.json` not verified — check it's live and JSON is valid |
| Build fails: license not accepted | Run `bubblewrap build` interactively in your terminal, type `y` when prompted |
| `adb: command not found` | Use full path: `~/.bubblewrap/android_sdk/platform-tools/adb` |
| App crashes on launch | Check your `start_url` in `twa-manifest.json` matches your live site |
| Play Store rejects AAB | Ensure version code is incremented from previous release |

---

## File Reference

| File | Purpose |
|---|---|
| `twa-manifest.json` | TWA configuration (commit this) |
| `android.keystore` | Signing key — **never commit, back up securely** |
| `app-release-bundle.aab` | Upload this to Play Store |
| `app-release-signed.apk` | Use this for emulator/device testing |
| `.well-known/assetlinks.json` | Domain verification for TWA |
| `netlify.toml` | Serves asset links with correct headers |

---

*Generated during the GitaVerse Android publishing process — February 2026.*
