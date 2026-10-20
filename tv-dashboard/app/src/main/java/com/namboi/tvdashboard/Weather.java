package com.namboi.tvdashboard;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Riyadh weather from Open-Meteo (free, no API key), cached for offline starts. */
final class Weather {

    private static final String URL_RIYADH = "https://api.open-meteo.com/v1/forecast"
            + "?latitude=24.7136&longitude=46.6753"
            + "&current=temperature_2m,weather_code,is_day"
            + "&daily=temperature_2m_max,temperature_2m_min"
            + "&timezone=Asia%2FRiyadh&forecast_days=1";

    private static final String PREFS = "weather";
    private static final String KEY_JSON = "json";
    private static final String KEY_TIME = "fetched_at";

    final int temperature;
    final int high;
    final int low;
    final int code;
    final boolean isDay;
    final long fetchedAt;

    private Weather(JSONObject json, long fetchedAt) throws JSONException {
        JSONObject current = json.getJSONObject("current");
        JSONObject daily = json.getJSONObject("daily");
        this.temperature = (int) Math.round(current.getDouble("temperature_2m"));
        this.code = current.getInt("weather_code");
        this.isDay = current.optInt("is_day", 1) == 1;
        this.high = (int) Math.round(daily.getJSONArray("temperature_2m_max").getDouble(0));
        this.low = (int) Math.round(daily.getJSONArray("temperature_2m_min").getDouble(0));
        this.fetchedAt = fetchedAt;
    }

    /** Blocking network call; run off the main thread. */
    static Weather fetch(Context context) throws IOException, JSONException {
        HttpURLConnection conn = (HttpURLConnection) new URL(URL_RIYADH).openConnection();
        conn.setConnectTimeout(10_000);
        conn.setReadTimeout(10_000);
        try {
            if (conn.getResponseCode() != 200) {
                throw new IOException("HTTP " + conn.getResponseCode());
            }
            String body = readAll(conn.getInputStream());
            long now = System.currentTimeMillis();
            Weather weather = new Weather(new JSONObject(body), now);
            prefs(context).edit().putString(KEY_JSON, body).putLong(KEY_TIME, now).apply();
            return weather;
        } finally {
            conn.disconnect();
        }
    }

    static Weather cached(Context context) {
        SharedPreferences p = prefs(context);
        String body = p.getString(KEY_JSON, null);
        if (body == null) return null;
        try {
            return new Weather(new JSONObject(body), p.getLong(KEY_TIME, 0));
        } catch (JSONException e) {
            return null;
        }
    }

    /** WMO weather interpretation codes, as used by Open-Meteo. */
    String description() {
        if (code == 0) return isDay ? "Sunny" : "Clear";
        if (code == 1) return "Mostly clear";
        if (code == 2) return "Partly cloudy";
        if (code == 3) return "Cloudy";
        if (code == 45 || code == 48) return "Fog";
        if (code >= 51 && code <= 57) return "Drizzle";
        if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "Rain";
        if ((code >= 71 && code <= 77) || code == 85 || code == 86) return "Snow";
        if (code >= 95) return "Thunderstorm";
        return "—";
    }

    int iconRes() {
        if (code == 0 || code == 1) return isDay ? R.drawable.wx_clear_day : R.drawable.wx_clear_night;
        if (code == 2) return isDay ? R.drawable.wx_partly_day : R.drawable.wx_partly_night;
        if (code == 3) return R.drawable.wx_cloudy;
        if (code == 45 || code == 48) return R.drawable.wx_fog;
        if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return R.drawable.wx_rain;
        if ((code >= 71 && code <= 77) || code == 85 || code == 86) return R.drawable.wx_snow;
        if (code >= 95) return R.drawable.wx_storm;
        return R.drawable.wx_cloudy;
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static String readAll(InputStream in) throws IOException {
        try (InputStream stream = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = stream.read(buf)) != -1) out.write(buf, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }
}
