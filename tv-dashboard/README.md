# TV Dashboard

A clean home screen and screensaver for an Android TV stick (built for the
Xiaomi TV Stick, Android TV OS 14).

**Dashboard (home screen)**
- Big clock, English date and Hijri date (Umm al-Qura)
- Live Riyadh weather: temperature, condition, today's high and low. Data
  comes from [Open-Meteo](https://open-meteo.com), which is free and needs no
  key. It refreshes every 30 minutes and remembers the last reading if offline.
- App tiles: YouTube, Netflix, Apple TV, Stremio, Shahid, OSN+, stc tv, plus
  All apps and Settings. Installed apps show their own banner; missing ones
  offer **Get app** (Play Store).
- A small live Riyadh Metro map with moving trains

**Screensaver: Riyadh Metro**
- The six metro lines traced from the official network map, with all 85
  stations and the interchange stations marked
- Trains run end to end on every line and pause at each station
- Line legend and clock; the map drifts a few pixels so nothing burns in

Plain Java, no libraries, about 40 KB.

## Install

The ready-to-install APK is `dist/tv-dashboard.apk`. See **[SETUP.md](SETUP.md)**
for connecting to the stick, installing, setting it as home screen and
screensaver, removing bloat, and how to undo all of it.

## Build

Needs JDK 17+ and the Android SDK (platform 34).

```sh
./gradlew assembleRelease
cp app/build/outputs/apk/release/app-release.apk dist/tv-dashboard.apk
```

## Changing things

| What | Where |
|---|---|
| App tiles (order, names, package names) | `AppShortcut.DASHBOARD` |
| Weather city | `Weather.URL_RIYADH` and `weather_city` in `strings.xml` |
| Metro map geometry, labels, train speed | `MetroMapView` |
| Colors and sizes | `res/values/colors.xml`, `res/values/dimens.xml` |

## Files

- `HomeActivity`: the dashboard; registered as a HOME activity
- `AllAppsActivity`: grid of every installed app
- `MetroDreamService` + `MetroMapView`: the screensaver and the animated map
- `Weather`: Open-Meteo client with offline cache
- `AppShortcut`: finds each app by package name or label, and launches it
