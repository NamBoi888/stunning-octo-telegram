package com.namboi.tvdashboard;

import android.service.dreams.DreamService;
import android.view.Gravity;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Screensaver: the animated Riyadh Metro map, with a line legend and clock. */
public class MetroDreamService extends DreamService {

    @Override
    public void onAttachedToWindow() {
        super.onAttachedToWindow();
        setInteractive(false);
        setFullscreen(true);
        setContentView(R.layout.dream_metro);

        LinearLayout legend = findViewById(R.id.legend);
        float density = getResources().getDisplayMetrics().density;
        for (int i = 0; i < MetroMapView.lineCount(); i++) {
            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setPadding(0, Math.round(5 * density), 0, Math.round(5 * density));

            View swatch = new View(this);
            swatch.setBackgroundColor(MetroMapView.lineColor(i));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    Math.round(28 * density), Math.round(6 * density));
            lp.setMarginEnd(Math.round(14 * density));
            row.addView(swatch, lp);

            TextView name = new TextView(this);
            name.setText(getString(R.string.metro_line, i + 1, MetroMapView.lineName(i)));
            name.setTextColor(getColor(R.color.text_secondary));
            name.setTextSize(17);
            row.addView(name);
            legend.addView(row);
        }

        ((TextView) findViewById(R.id.dream_date)).setText(
                new SimpleDateFormat("EEEE, d MMMM", Locale.ENGLISH).format(new Date()));
    }
}
