package com.namboi.tvdashboard;

import android.app.Activity;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Outline;
import android.graphics.drawable.Drawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewOutlineProvider;
import android.widget.AbsListView;
import android.widget.BaseAdapter;
import android.widget.GridView;
import android.widget.ImageView;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Every installed app, for anything that isn't pinned to the dashboard. */
public class AllAppsActivity extends Activity {

    private static final class Entry {
        String pkg;
        String label;
        Drawable banner;
        Drawable icon;
    }

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<Entry> entries = new ArrayList<>();
    private Adapter adapter;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_all_apps);
        GridView grid = findViewById(R.id.grid);
        adapter = new Adapter();
        grid.setAdapter(adapter);
        grid.setOnItemClickListener((parent, view, position, id) ->
                AppShortcut.launchPackage(this, entries.get(position).pkg));
        grid.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
            private View last;

            @Override
            public void onItemSelected(android.widget.AdapterView<?> parent, View view, int pos, long id) {
                if (last != null) last.animate().scaleX(1f).scaleY(1f).setDuration(120).start();
                view.animate().scaleX(1.06f).scaleY(1.06f).setDuration(120).start();
                last = view;
            }

            @Override
            public void onNothingSelected(android.widget.AdapterView<?> parent) {
                if (last != null) last.animate().scaleX(1f).scaleY(1f).setDuration(120).start();
                last = null;
            }
        });
        load();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        worker.shutdownNow();
    }

    private void load() {
        worker.execute(() -> {
            PackageManager pm = getPackageManager();
            List<Entry> loaded = new ArrayList<>();
            for (ResolveInfo ri : AppShortcut.launchableApps(pm)) {
                String pkg = ri.activityInfo.packageName;
                if (pkg.equals(getPackageName())) continue;
                Entry e = new Entry();
                e.pkg = pkg;
                e.label = ri.loadLabel(pm).toString();
                e.banner = ri.activityInfo.applicationInfo.loadBanner(pm);
                if (e.banner == null) e.banner = AppShortcut.activityBanner(pm, pkg);
                if (e.banner == null) e.icon = ri.loadIcon(pm);
                loaded.add(e);
            }
            loaded.sort(Comparator.comparing(e -> e.label.toLowerCase(Locale.ROOT)));
            main.post(() -> {
                entries.clear();
                entries.addAll(loaded);
                adapter.notifyDataSetChanged();
            });
        });
    }

    private final class Adapter extends BaseAdapter {
        @Override
        public int getCount() {
            return entries.size();
        }

        @Override
        public Object getItem(int position) {
            return entries.get(position);
        }

        @Override
        public long getItemId(int position) {
            return position;
        }

        @Override
        public View getView(int position, View convertView, ViewGroup parent) {
            View tile = convertView;
            if (tile == null) {
                tile = LayoutInflater.from(AllAppsActivity.this)
                        .inflate(R.layout.view_tile, parent, false);
                // GridView items take AbsListView params, and it handles focus itself.
                tile.setLayoutParams(new AbsListView.LayoutParams(
                        getResources().getDimensionPixelSize(R.dimen.tile_w),
                        getResources().getDimensionPixelSize(R.dimen.tile_h)));
                tile.setFocusable(false);
                tile.setClickable(false);
                final float radius = getResources().getDimension(R.dimen.tile_radius);
                tile.setOutlineProvider(new ViewOutlineProvider() {
                    @Override
                    public void getOutline(View view, Outline outline) {
                        outline.setRoundRect(0, 0, view.getWidth(), view.getHeight(), radius);
                    }
                });
                tile.setClipToOutline(true);
            }
            Entry e = entries.get(position);
            ImageView banner = tile.findViewById(R.id.tile_banner);
            View fallback = tile.findViewById(R.id.tile_fallback);
            ImageView icon = tile.findViewById(R.id.tile_icon);
            TextView label = tile.findViewById(R.id.tile_label);
            tile.setContentDescription(e.label);
            if (e.banner != null) {
                banner.setImageDrawable(e.banner);
                banner.setVisibility(View.VISIBLE);
                fallback.setVisibility(View.GONE);
            } else {
                banner.setVisibility(View.GONE);
                fallback.setVisibility(View.VISIBLE);
                icon.setImageDrawable(e.icon);
                icon.setVisibility(e.icon != null ? View.VISIBLE : View.GONE);
                label.setText(e.label);
                label.setTextSize(15);
            }
            return tile;
        }
    }
}
