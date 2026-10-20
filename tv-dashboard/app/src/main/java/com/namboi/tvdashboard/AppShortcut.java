package com.namboi.tvdashboard;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.drawable.Drawable;
import android.net.Uri;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * One app tile on the dashboard. Regional apps ship under different package
 * names, so each shortcut lists the names we know and falls back to matching
 * the installed app's label.
 */
final class AppShortcut {

    static final AppShortcut[] DASHBOARD = {
            new AppShortcut("YouTube", 0xFFE62117,
                    new String[]{"com.google.android.youtube.tv", "com.google.android.youtube.googletv"},
                    new String[]{"YouTube"}),
            new AppShortcut("Netflix", 0xFFB20710,
                    new String[]{"com.netflix.ninja"},
                    new String[]{"Netflix"}),
            new AppShortcut("Apple TV", 0xFF1C1C1E,
                    new String[]{"com.apple.atve.androidtv.appletv"},
                    new String[]{"Apple TV"}),
            new AppShortcut("Stremio", 0xFF5B3FA8,
                    new String[]{"com.stremio.one"},
                    new String[]{"Stremio"}),
            new AppShortcut("Shahid", 0xFF0B7A5B,
                    new String[]{"net.mbc.shahidTV", "net.mbc.shahid"},
                    new String[]{"Shahid", "شاهد"}),
            new AppShortcut("OSN+", 0xFF2B2B6F,
                    new String[]{"com.osn.go", "com.osn.plus", "com.osnplus.tv"},
                    new String[]{"OSN+", "OSN"}),
            new AppShortcut("stc tv", 0xFF4F008C,
                    new String[]{"com.stc.tv", "com.stc.iptv", "com.stctv.androidtv"},
                    new String[]{"stc tv", "STC TV"}),
    };

    final String label;
    final int brandColor;
    final String[] packages;
    final String[] labelMatches;

    /** Resolved on each refresh; null when the app isn't installed. */
    volatile String installedPackage;

    private AppShortcut(String label, int brandColor, String[] packages, String[] labelMatches) {
        this.label = label;
        this.brandColor = brandColor;
        this.packages = packages;
        this.labelMatches = labelMatches;
    }

    void resolve(PackageManager pm, List<ResolveInfo> launchable) {
        installedPackage = null;
        for (String pkg : packages) {
            if (isInstalled(pm, pkg)) {
                installedPackage = pkg;
                return;
            }
        }
        // Exact label first so "YouTube" doesn't grab "YouTube Kids".
        for (ResolveInfo ri : launchable) {
            String appLabel = ri.loadLabel(pm).toString().trim();
            for (String match : labelMatches) {
                if (appLabel.equalsIgnoreCase(match)) {
                    installedPackage = ri.activityInfo.packageName;
                    return;
                }
            }
        }
        for (ResolveInfo ri : launchable) {
            String appLabel = ri.loadLabel(pm).toString().toLowerCase(Locale.ROOT);
            for (String match : labelMatches) {
                if (match.length() > 3 && appLabel.startsWith(match.toLowerCase(Locale.ROOT))) {
                    installedPackage = ri.activityInfo.packageName;
                    return;
                }
            }
        }
    }

    /** The app's TV banner, or null if it isn't installed or has none. */
    Drawable banner(PackageManager pm) {
        if (installedPackage == null) return null;
        try {
            ApplicationInfo info = pm.getApplicationInfo(installedPackage, 0);
            Drawable d = pm.getApplicationBanner(info);
            if (d == null) d = activityBanner(pm, installedPackage);
            return d;
        } catch (PackageManager.NameNotFoundException e) {
            return null;
        }
    }

    Drawable icon(PackageManager pm) {
        if (installedPackage == null) return null;
        try {
            return pm.getApplicationIcon(installedPackage);
        } catch (PackageManager.NameNotFoundException e) {
            return null;
        }
    }

    /** Opens the app, or its Play Store page when it isn't installed. */
    boolean open(Context context) {
        if (installedPackage != null) {
            return launchPackage(context, installedPackage);
        }
        Uri store = Uri.parse("market://search?c=apps&q=" + Uri.encode(label));
        return startSafely(context, new Intent(Intent.ACTION_VIEW, store));
    }

    static boolean launchPackage(Context context, String pkg) {
        PackageManager pm = context.getPackageManager();
        Intent intent = pm.getLeanbackLaunchIntentForPackage(pkg);
        if (intent == null) intent = pm.getLaunchIntentForPackage(pkg);
        return intent != null && startSafely(context, intent);
    }

    static boolean startSafely(Context context, Intent intent) {
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            return false;
        }
    }

    /** Every app with a TV entry point, plus phone-only apps that were sideloaded. */
    static List<ResolveInfo> launchableApps(PackageManager pm) {
        List<ResolveInfo> result = new ArrayList<>(pm.queryIntentActivities(
                new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER), 0));
        List<String> seen = new ArrayList<>();
        for (ResolveInfo ri : result) seen.add(ri.activityInfo.packageName);
        for (ResolveInfo ri : pm.queryIntentActivities(
                new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0)) {
            if (!seen.contains(ri.activityInfo.packageName)) {
                seen.add(ri.activityInfo.packageName);
                result.add(ri);
            }
        }
        return result;
    }

    static Drawable activityBanner(PackageManager pm, String pkg) {
        Intent intent = pm.getLeanbackLaunchIntentForPackage(pkg);
        if (intent == null) return null;
        try {
            return pm.getActivityBanner(intent);
        } catch (PackageManager.NameNotFoundException e) {
            return null;
        }
    }

    private static boolean isInstalled(PackageManager pm, String pkg) {
        try {
            return pm.getApplicationInfo(pkg, 0).enabled;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }
}
