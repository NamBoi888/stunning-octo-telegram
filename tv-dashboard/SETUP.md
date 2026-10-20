# Installing the dashboard on the Xiaomi TV Stick

These steps are written for **Claude Code running on a computer on the same
Wi-Fi as the stick**. Open Claude Code in this folder and say:

> Follow tv-dashboard/SETUP.md to set up my TV stick.

Claude should run each step, show the output, and **ask before disabling any
app**. Everything here can be undone (see *Undo everything* at the end).

Device: Xiaomi TV Stick (MiTV-AXTU0), Android TV OS 14.

---

## 1. Tools

Install Google's **Android SDK Platform-Tools** (it contains `adb`):

- macOS: `brew install --cask android-platform-tools`
- Windows: `winget install Google.PlatformTools`
- Linux: `sudo apt install adb` (or download Platform-Tools from Google)

Check: `adb version`

## 2. Connect to the stick

On the TV: **Settings → System → Developer options → Wireless debugging**.

1. Choose **Pair device with pairing code**. The TV shows a 6-digit code and
   an `IP:port` just for pairing.
   ```sh
   adb pair <IP>:<PAIRING_PORT> <CODE>
   ```
2. Connect using the `IP:port` on the main Wireless debugging screen
   (last seen as `192.168.0.113:35661`; the port changes after a reboot or
   when wireless debugging is toggled, so re-check it on the TV):
   ```sh
   adb connect 192.168.0.113:35661
   adb devices        # should list the stick as "device"
   ```
3. If the TV asks **Allow wireless debugging?**, tick *Always allow* and accept.

## 3. Save the current state first

```sh
adb shell pm list packages -e | sort > tv-enabled-before.txt
adb shell cmd package resolve-activity --brief \
  -a android.intent.action.MAIN -c android.intent.category.HOME
```

The second command prints the current home screen (normally
`com.google.android.tvlauncher/...`). Note it down for *Undo*.

## 4. Install the dashboard

```sh
adb install -r tv-dashboard/dist/tv-dashboard.apk
```

## 5. Make it the home screen

Android TV 14 has no "choose default launcher" setting.

```sh
adb shell cmd package set-home-activity com.namboi.tvdashboard/.HomeActivity
adb shell input keyevent KEYCODE_HOME
```

If the old Google home screen still appears when pressing Home, disable it
(this is the package printed in step 3):

```sh
adb shell pm disable-user --user 0 com.google.android.tvlauncher
adb shell input keyevent KEYCODE_HOME
```

The dashboard's **All apps** tile replaces the old app list, and the gear
button opens Settings.

## 6. Turn on the Riyadh Metro screensaver

```sh
adb shell settings put secure screensaver_enabled 1
adb shell settings put secure screensaver_components com.namboi.tvdashboard/.MetroDreamService
adb shell settings put secure screensaver_default_component com.namboi.tvdashboard/.MetroDreamService
# Start the screensaver after 10 idle minutes:
adb shell settings put system screen_off_timeout 600000
```

To preview it now: on the TV open **Settings → System → Ambient mode / Screen
saver** and choose *Start now*, or just leave the remote alone for 10 minutes.

## 7. Faster menus

```sh
adb shell settings put global window_animation_scale 0.5
adb shell settings put global transition_animation_scale 0.5
adb shell settings put global animator_duration_scale 0.5
```

(Use `0` instead of `0.5` to turn animations off completely.)

## 8. Remove bloat (review first)

List what's enabled, then **propose a list to the user and wait for a yes**
before disabling anything:

```sh
adb shell pm list packages -e | sort
```

Disable an approved app (nothing is deleted; it can be re-enabled):

```sh
adb shell pm disable-user --user 0 <package>
```

Keep a log of every package disabled in `tv-disabled.txt`.

**Usually safe to disable if the user doesn't use them:**
YouTube Music (`com.google.android.youtube.tvmusic`), YouTube Kids
(`com.google.android.youtube.tvkids`), Google TV / Play Movies
(`com.google.android.videos`), Play Games (`com.google.android.play.games`),
Live Channels (`com.google.android.tv`), Prime Video
(`com.amazon.amazonvideo.livingroom`), Spotify (`com.spotify.tv.android`),
Feedback (`com.google.android.feedback`), Print spooler
(`com.android.printspooler`), the old home screen's recommendations
(`com.google.android.tvrecommendations`) once the dashboard is the home
screen, and Xiaomi promo or extra apps the user doesn't recognize or need.

**Never disable:**
- Google Play Services, Play Store, Services Framework
  (`com.google.android.gms`, `com.android.vending`, `com.google.android.gsf`)
- System UI, Settings, setup (`com.android.systemui`,
  `com.android.tv.settings`, `com.google.android.tungsten.setupwraith`)
- Anything starting with `com.android.providers.`, `com.droidlogic.` or
  `com.amlogic.` (hardware and remote control support)
- Keyboard (`com.google.android.leanback.ime`), WebView
  (`com.google.android.webview`), Bluetooth (`com.android.bluetooth`)
- Voice search / Assistant (`com.google.android.katniss`) if the user talks
  to the remote
- Chromecast built-in (`com.google.android.apps.mediashell`) if the user casts
  from their phone
- The dashboard itself and the apps on it (YouTube, Netflix, Apple TV,
  Stremio, Shahid, OSN+, stc tv)

If unsure about a package, leave it enabled.

Restart the stick afterwards: `adb reboot`, then reconnect (step 2; the port
will have changed).

## 9. Optional: install the missing apps

Tiles for apps that aren't installed say **Get app** and open the Play Store.
Stremio isn't always on the TV Play Store; if not, it can be sideloaded from
stremio.com.

---

## Undo everything

```sh
# Bring back the Google home screen
adb shell pm enable com.google.android.tvlauncher
# Re-enable an app that was disabled
adb shell pm enable <package>
# Default animations
adb shell settings put global window_animation_scale 1
adb shell settings put global transition_animation_scale 1
adb shell settings put global animator_duration_scale 1
# Remove the dashboard
adb uninstall com.namboi.tvdashboard
```

As a last resort, a factory reset (Settings → System → About → Reset)
returns the stick to how it came out of the box.

## Updating the dashboard later

Rebuild (`./gradlew assembleRelease` in `tv-dashboard/`) or download the new
`dist/tv-dashboard.apk`, then run `adb install -r` again. The signing key is
kept in the repo, so updates install over the existing app.
