package com.namboi.tvdashboard;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Outline;
import android.graphics.drawable.Drawable;
import android.icu.text.SimpleDateFormat;
import android.icu.util.ULocale;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.KeyEvent;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewOutlineProvider;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class HomeActivity extends Activity {

    private static final long WEATHER_MAX_AGE_MS = 30 * 60 * 1000L;
    private static final long WEATHER_STALE_MS = 3 * 60 * 60 * 1000L;
    private static final long TICK_MS = 60 * 1000L;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    private TextView date, hijri;
    private ImageView weatherIcon;
    private TextView weatherTemp, weatherSummary, weatherRange;
    private final View[] tiles = new View[AppShortcut.DASHBOARD.length];

    private boolean weatherFetching;

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            updateDate();
            refreshWeatherIfOld();
            main.postDelayed(this, TICK_MS);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_home);

        date = findViewById(R.id.date);
        hijri = findViewById(R.id.hijri);
        weatherIcon = findViewById(R.id.weather_icon);
        weatherTemp = findViewById(R.id.weather_temp);
        weatherSummary = findViewById(R.id.weather_summary);
        weatherRange = findViewById(R.id.weather_range);

        MetroMapView map = findViewById(R.id.map);
        map.setShowLabels(false);
        map.setFrameDelay(40);
        map.setDim(0.9f);

        buildTiles();
        showWeather(Weather.cached(this));
    }

    @Override
    protected void onResume() {
        super.onResume();
        refreshTiles();
        main.removeCallbacks(tick);
        tick.run();
    }

    @Override
    protected void onPause() {
        super.onPause();
        main.removeCallbacks(tick);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        worker.shutdownNow();
    }

    /** This is the home screen, so Back has nowhere to go. */
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) return true;
        return super.onKeyDown(keyCode, event);
    }

    // ---- Tiles -------------------------------------------------------------

    private void buildTiles() {
        LayoutInflater inflater = LayoutInflater.from(this);
        LinearLayout row1 = findViewById(R.id.row1);
        LinearLayout row2 = findViewById(R.id.row2);

        for (int i = 0; i < AppShortcut.DASHBOARD.length; i++) {
            AppShortcut shortcut = AppShortcut.DASHBOARD[i];
            LinearLayout row = i < 4 ? row1 : row2;
            View tile = inflater.inflate(R.layout.view_tile, row, false);
            styleTile(tile);
            tile.setContentDescription(shortcut.label);
            tile.setOnClickListener(v -> {
                if (!shortcut.open(this)) {
                    Toast.makeText(this, getString(R.string.cant_open, shortcut.label),
                            Toast.LENGTH_SHORT).show();
                }
            });
            ((TextView) tile.findViewById(R.id.tile_label)).setText(shortcut.label);
            tile.setBackgroundColor(shortcut.brandColor);
            row.addView(tile);
            tiles[i] = tile;
        }

        View allApps = inflater.inflate(R.layout.view_tile, row2, false);
        styleTile(allApps);
        allApps.setContentDescription(getString(R.string.all_apps));
        ((TextView) allApps.findViewById(R.id.tile_label)).setText(R.string.all_apps);
        ImageView appsIcon = allApps.findViewById(R.id.tile_icon);
        appsIcon.setImageResource(R.drawable.ic_apps);
        appsIcon.setVisibility(View.VISIBLE);
        allApps.setOnClickListener(v -> startActivity(new Intent(this, AllAppsActivity.class)));
        row2.addView(allApps);

        row2.addView(buildSettingsButton(row2));
        tiles[0].requestFocus();
    }

    private View buildSettingsButton(ViewGroup parent) {
        int size = dp(52);
        ImageButton button = new ImageButton(this);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(size, size);
        lp.gravity = android.view.Gravity.CENTER_VERTICAL;
        lp.setMarginStart(dp(6));
        button.setLayoutParams(lp);
        button.setBackgroundResource(R.drawable.round_button);
        button.setImageResource(R.drawable.ic_settings);
        button.setImageTintList(getColorStateList(R.color.round_button_tint));
        button.setScaleType(ImageView.ScaleType.CENTER);
        button.setFocusable(true);
        button.setContentDescription(getString(R.string.settings));
        button.setOnClickListener(v ->
                AppShortcut.startSafely(this, new Intent(Settings.ACTION_SETTINGS)));
        button.setOnFocusChangeListener((v, hasFocus) -> animateFocus(v, hasFocus));
        return button;
    }

    private void styleTile(View tile) {
        final float radius = getResources().getDimension(R.dimen.tile_radius);
        tile.setOutlineProvider(new ViewOutlineProvider() {
            @Override
            public void getOutline(View view, Outline outline) {
                outline.setRoundRect(0, 0, view.getWidth(), view.getHeight(), radius);
            }
        });
        tile.setClipToOutline(true);
        tile.setOnFocusChangeListener((v, hasFocus) -> animateFocus(v, hasFocus));
    }

    private void animateFocus(View v, boolean hasFocus) {
        float scale = hasFocus ? 1.08f : 1f;
        v.animate().scaleX(scale).scaleY(scale).translationZ(hasFocus ? dp(8) : 0)
                .setDuration(150).start();
    }

    /** Looks up which apps are installed; package queries can be slow, so off-thread. */
    private void refreshTiles() {
        worker.execute(() -> {
            PackageManager pm = getPackageManager();
            List<ResolveInfo> launchable = AppShortcut.launchableApps(pm);
            final Drawable[] banners = new Drawable[tiles.length];
            final Drawable[] icons = new Drawable[tiles.length];
            for (int i = 0; i < tiles.length; i++) {
                AppShortcut s = AppShortcut.DASHBOARD[i];
                s.resolve(pm, launchable);
                banners[i] = s.banner(pm);
                if (banners[i] == null) icons[i] = s.icon(pm);
            }
            main.post(() -> {
                for (int i = 0; i < tiles.length; i++) {
                    bindTile(tiles[i], AppShortcut.DASHBOARD[i], banners[i], icons[i]);
                }
            });
        });
    }

    private void bindTile(View tile, AppShortcut s, Drawable banner, Drawable icon) {
        ImageView bannerView = tile.findViewById(R.id.tile_banner);
        View fallback = tile.findViewById(R.id.tile_fallback);
        ImageView iconView = tile.findViewById(R.id.tile_icon);
        TextView hint = tile.findViewById(R.id.tile_hint);

        if (banner != null) {
            bannerView.setImageDrawable(banner);
            bannerView.setVisibility(View.VISIBLE);
            fallback.setVisibility(View.GONE);
            return;
        }
        bannerView.setVisibility(View.GONE);
        fallback.setVisibility(View.VISIBLE);
        iconView.setImageDrawable(icon);
        iconView.setVisibility(icon != null ? View.VISIBLE : View.GONE);
        hint.setVisibility(s.installedPackage == null ? View.VISIBLE : View.GONE);
    }

    // ---- Clock and date ----------------------------------------------------

    private void updateDate() {
        Date now = new Date();
        date.setText(new java.text.SimpleDateFormat("EEEE, d MMMM", Locale.ENGLISH).format(now));
        SimpleDateFormat hijriFormat = new SimpleDateFormat("d MMMM y",
                new ULocale("ar_SA@calendar=islamic-umalqura"));
        hijri.setText(hijriFormat.format(now) + " هـ");
    }

    // ---- Weather -----------------------------------------------------------

    private void refreshWeatherIfOld() {
        Weather cached = Weather.cached(this);
        if (cached != null && System.currentTimeMillis() - cached.fetchedAt < WEATHER_MAX_AGE_MS) {
            showWeather(cached);
            return;
        }
        if (weatherFetching) return;
        weatherFetching = true;
        if (cached == null) showWeather(null);
        worker.execute(() -> {
            Weather fresh;
            try {
                fresh = Weather.fetch(this);
            } catch (Exception e) {
                fresh = null;
            }
            final Weather result = fresh != null ? fresh : Weather.cached(this);
            main.post(() -> {
                weatherFetching = false;
                showWeather(result);
            });
        });
    }

    private void showWeather(Weather w) {
        if (w == null) {
            weatherIcon.setImageDrawable(null);
            weatherTemp.setText("");
            weatherSummary.setText(weatherFetching
                    ? R.string.weather_loading : R.string.weather_offline);
            weatherRange.setText("");
            return;
        }
        weatherIcon.setImageResource(w.iconRes());
        weatherTemp.setText(w.temperature + "°");
        weatherSummary.setText(w.description() + "  ·  " + getString(R.string.weather_city));
        if (System.currentTimeMillis() - w.fetchedAt > WEATHER_STALE_MS) {
            String time = new java.text.SimpleDateFormat("h:mm a", Locale.ENGLISH)
                    .format(new Date(w.fetchedAt));
            weatherRange.setText(getString(R.string.weather_updated, time));
        } else {
            weatherRange.setText(getString(R.string.weather_high_low, w.high, w.low));
        }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
