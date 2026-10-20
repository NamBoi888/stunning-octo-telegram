package com.namboi.tvdashboard;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BlurMaskFilter;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PathMeasure;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.os.SystemClock;
import android.util.AttributeSet;
import android.view.View;

/**
 * The Riyadh Metro, traced from the official network map, with trains that
 * shuttle end to end and pause at every station.
 *
 * Coordinates are in the official map's own units (a 1403 x 2000 poster,
 * north up); the view scales them to fit. BRT bus lines are left out.
 */
public class MetroMapView extends View {

    /** The part of the poster we draw, labels included. */
    private static final RectF MAP = new RectF(-10, 20, 1420, 1745);

    private static final int BLUE = 0xFF1DA1E2;
    private static final int RED = 0xFFE8433F;
    private static final int ORANGE = 0xFFF5901E;
    private static final int YELLOW = 0xFFF7C52B;
    private static final int GREEN = 0xFF3DB04B;
    private static final int PURPLE = 0xFF9B4FC9;

    private static final class Line {
        final String name;
        final int color;
        final int trains;
        final float[] route;
        final float[] stations;
        Path path;
        PathMeasure measure;
        float[] stopDistance;

        Line(String name, int color, int trains, float[] route, float[] stations) {
            this.name = name;
            this.color = color;
            this.trains = trains;
            this.route = route;
            this.stations = stations;
        }
    }

    private static final Line[] LINES = {
            new Line("Blue", BLUE, 6,
                    new float[]{627, 358, 627, 1445, 640, 1458, 700, 1458, 712, 1470, 712, 1685},
                    new float[]{627, 358, 627, 436, 627, 636, 627, 707, 627, 753, 627, 788,
                            627, 830, 627, 868, 627, 908, 627, 959, 627, 988, 627, 1025,
                            627, 1098, 627, 1150, 627, 1178, 627, 1247, 627, 1276, 627, 1310,
                            627, 1345, 627, 1376, 627, 1408, 627, 1440, 712, 1490, 712, 1557,
                            712, 1685}),
            new Line("Red", RED, 4,
                    new float[]{460, 830, 1338, 830},
                    new float[]{460, 830, 502, 830, 534, 830, 567, 830, 630, 830, 673, 830,
                            712, 830, 757, 830, 835, 830, 895, 830, 1026, 830, 1097, 830,
                            1183, 830, 1260, 830, 1338, 830}),
            new Line("Orange", ORANGE, 6,
                    new float[]{37, 1250, 37, 1260, 47, 1270, 150, 1270, 160, 1280, 160, 1300,
                            170, 1310, 720, 1310, 790, 1238, 803, 1225, 1262, 1225},
                    new float[]{37, 1250, 111, 1270, 160, 1298, 200, 1310, 305, 1310, 392, 1310,
                            484, 1310, 537, 1310, 580, 1310, 620, 1310, 658, 1310, 676, 1310,
                            698, 1310, 735, 1295, 752, 1275, 788, 1240, 867, 1225, 957, 1225,
                            997, 1225, 1097, 1225, 1183, 1225, 1262, 1225}),
            new Line("Yellow", YELLOW, 3,
                    new float[]{638, 636, 638, 601, 650, 589, 943, 589, 1025, 515, 1025, 290,
                            1100, 215, 1100, 45},
                    new float[]{638, 636, 712, 589, 866, 589, 927, 589, 1025, 436, 1025, 383,
                            1100, 178, 1100, 123, 1100, 45}),
            new Line("Green", GREEN, 3,
                    new float[]{757, 830, 757, 893, 710, 945, 712, 955, 770, 1005, 770, 1030,
                            660, 1240, 648, 1250, 627, 1250},
                    new float[]{757, 830, 757, 885, 715, 962, 740, 982, 765, 1000, 765, 1040,
                            735, 1090, 715, 1130, 700, 1160, 685, 1193, 670, 1222, 627, 1250}),
            new Line("Purple", PURPLE, 3,
                    new float[]{650, 636, 650, 615, 662, 603, 937, 603, 948, 614, 948, 698,
                            958, 708, 1093, 708, 1103, 718, 1103, 1212, 1097, 1225},
                    new float[]{650, 636, 712, 603, 866, 603, 927, 603, 966, 708, 1103, 748,
                            1103, 830, 1103, 938, 1103, 1013, 1103, 1122, 1097, 1225}),
    };

    /** Interchange stations, drawn as white capsules from (x1,y1) to (x2,y2). */
    private static final float[][] INTERCHANGES = {
            {624, 636, 653, 636},   // KAFD: Blue, Yellow, Purple
            {712, 589, 712, 603},   // Ar Rabi: Yellow, Purple
            {866, 589, 866, 603},   // Uthman Bin Affan Road
            {927, 589, 927, 603},   // SABIC
            {627, 830, 630, 830},   // STC: Blue, Red
            {757, 830, 757, 830},   // Ministry of Education: Red, Green
            {1097, 830, 1103, 830}, // Al Hamra: Red, Purple
            {627, 1247, 627, 1250}, // National Museum: Blue, Green
            {620, 1310, 627, 1310}, // Qasr Al Hokm: Blue, Orange
            {1097, 1225, 1103, 1225}, // An Naseem: Orange, Purple
    };

    private static final class Label {
        final String text;
        final float x, y;
        final Paint.Align align;

        Label(String text, float x, float y, Paint.Align align) {
            this.text = text;
            this.x = x;
            this.y = y;
            this.align = align;
        }
    }

    private static final Label[] LABELS = {
            new Label("SAB", 600, 368, Paint.Align.RIGHT),
            new Label("KAFD", 604, 646, Paint.Align.RIGHT),
            new Label("Ar Rabi", 712, 566, Paint.Align.CENTER),
            new Label("SABIC", 927, 566, Paint.Align.CENTER),
            new Label("Airport", 1122, 55, Paint.Align.LEFT),
            new Label("King Saud\nUniversity", 460, 868, Paint.Align.CENTER),
            new Label("STC", 612, 812, Paint.Align.RIGHT),
            new Label("Ministry of Education", 778, 868, Paint.Align.LEFT),
            new Label("Al Hamra", 1118, 812, Paint.Align.LEFT),
            new Label("King Fahd\nSport City", 1338, 868, Paint.Align.CENTER),
            new Label("National Museum", 602, 1243, Paint.Align.RIGHT),
            new Label("Qasr Al Hokm", 605, 1345, Paint.Align.RIGHT),
            new Label("Jeddah Road", 20, 1228, Paint.Align.LEFT),
            new Label("An Naseem", 1097, 1265, Paint.Align.CENTER),
            new Label("Khashm\nAl An", 1262, 1265, Paint.Align.CENTER),
            new Label("Ad Dar Al Baida", 712, 1728, Paint.Align.CENTER),
    };

    private static final float SECONDS_PER_STOP = 4f;
    private static final float DWELL = 0.3f;
    /** Slow drift so a static map can't burn into the panel. */
    private static final float DRIFT_PX = 6f;

    private final Paint linePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint stopPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint capsuleFill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint capsuleRing = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint labelPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint trainPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint layerPaint = new Paint(Paint.FILTER_BITMAP_FLAG);
    private final float[] pos = new float[2];

    private final Matrix toScreen = new Matrix();
    private float scale = 1f;
    private Bitmap staticLayer;
    /** One pre-blurred glow sprite per line; blurring every frame is too slow for a TV stick. */
    private Bitmap[] glows;

    private boolean showLabels = true;
    private long frameDelayMs = 0;
    private final long startedAt = SystemClock.uptimeMillis();

    public MetroMapView(Context context) {
        this(context, null);
    }

    public MetroMapView(Context context, AttributeSet attrs) {
        super(context, attrs);
        linePaint.setStyle(Paint.Style.STROKE);
        linePaint.setStrokeCap(Paint.Cap.ROUND);
        linePaint.setStrokeJoin(Paint.Join.ROUND);
        stopPaint.setColor(0xFF0D0E11);
        capsuleFill.setStyle(Paint.Style.STROKE);
        capsuleFill.setStrokeCap(Paint.Cap.ROUND);
        capsuleFill.setColor(0xFF0D0E11);
        capsuleRing.setStyle(Paint.Style.STROKE);
        capsuleRing.setStrokeCap(Paint.Cap.ROUND);
        capsuleRing.setColor(Color.WHITE);
        labelPaint.setColor(0xE6FFFFFF);
        labelPaint.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        trainPaint.setColor(Color.WHITE);
    }

    /** Fade the whole map, e.g. 0.5 behind the dashboard. */
    public void setDim(float alpha) {
        int a = Math.round(255 * alpha);
        layerPaint.setAlpha(a);
        trainPaint.setAlpha(a);
        invalidate();
    }

    /** Hide station names (used behind the dashboard). */
    public void setShowLabels(boolean show) {
        showLabels = show;
        staticLayer = null;
        invalidate();
    }

    /** Throttle animation, e.g. 33ms for ~30fps; 0 = every frame. */
    public void setFrameDelay(long ms) {
        frameDelayMs = ms;
    }

    @Override
    protected void onSizeChanged(int w, int h, int oldw, int oldh) {
        super.onSizeChanged(w, h, oldw, oldh);
        float availW = w - getPaddingLeft() - getPaddingRight() - 2 * DRIFT_PX;
        float availH = h - getPaddingTop() - getPaddingBottom() - 2 * DRIFT_PX;
        scale = Math.min(availW / MAP.width(), availH / MAP.height());
        float left = getPaddingLeft() + DRIFT_PX + (availW - MAP.width() * scale) / 2f;
        float top = getPaddingTop() + DRIFT_PX + (availH - MAP.height() * scale) / 2f;
        toScreen.setTranslate(-MAP.left, -MAP.top);
        toScreen.postScale(scale, scale);
        toScreen.postTranslate(left, top);

        for (Line line : LINES) {
            float[] route = line.route.clone();
            toScreen.mapPoints(route);
            Path p = new Path();
            p.moveTo(route[0], route[1]);
            for (int i = 2; i < route.length; i += 2) p.lineTo(route[i], route[i + 1]);
            line.path = p;
            line.measure = new PathMeasure(p, false);

            float[] stations = line.stations.clone();
            toScreen.mapPoints(stations);
            line.stopDistance = new float[stations.length / 2];
            for (int i = 0; i < line.stopDistance.length; i++) {
                line.stopDistance[i] = nearestDistance(route, stations[2 * i], stations[2 * i + 1]);
            }
        }
        recycleBitmaps();
    }

    private void recycleBitmaps() {
        if (staticLayer != null) staticLayer.recycle();
        staticLayer = null;
        if (glows != null) for (Bitmap g : glows) if (g != null) g.recycle();
        glows = null;
    }

    private Bitmap[] renderGlows(float trainR) {
        Bitmap[] out = new Bitmap[LINES.length];
        float blur = Math.max(1f, 9f * scale);
        int size = (int) Math.ceil(2 * (trainR * 2.2f + blur * 2));
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setMaskFilter(new BlurMaskFilter(blur, BlurMaskFilter.Blur.NORMAL));
        for (int i = 0; i < LINES.length; i++) {
            out[i] = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            p.setColor(LINES[i].color);
            new Canvas(out[i]).drawCircle(size / 2f, size / 2f, trainR * 2.2f, p);
        }
        return out;
    }

    @Override
    protected void onDetachedFromWindow() {
        super.onDetachedFromWindow();
        recycleBitmaps();
    }

    @Override
    public void onVisibilityAggregated(boolean isVisible) {
        super.onVisibilityAggregated(isVisible);
        if (isVisible) invalidate();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        if (getWidth() == 0 || LINES[0].path == null) return;
        if (staticLayer == null) staticLayer = renderStatic();

        float seconds = (SystemClock.uptimeMillis() - startedAt) / 1000f;
        canvas.save();
        canvas.translate(DRIFT_PX * (float) Math.sin(seconds / 97f),
                DRIFT_PX * (float) Math.sin(seconds / 131f));
        if (staticLayer != null) canvas.drawBitmap(staticLayer, 0, 0, layerPaint);

        float trainR = Math.max(2f, 7f * scale);
        if (glows == null) glows = renderGlows(trainR);
        for (int l = 0; l < LINES.length; l++) {
            Line line = LINES[l];
            Bitmap glow = glows[l];
            int hops = line.stopDistance.length - 1;
            float roundTrip = 2f * hops * SECONDS_PER_STOP;
            for (int t = 0; t < line.trains; t++) {
                float phase = (seconds + roundTrip * t / line.trains) % roundTrip;
                float stops = phase / SECONDS_PER_STOP;          // 0 .. 2*hops
                if (stops > hops) stops = 2f * hops - stops;     // ping-pong
                line.measure.getPosTan(distanceAt(line, stops), pos, null);
                canvas.drawBitmap(glow, pos[0] - glow.getWidth() / 2f,
                        pos[1] - glow.getHeight() / 2f, layerPaint);
                canvas.drawCircle(pos[0], pos[1], trainR, trainPaint);
            }
        }
        canvas.restore();

        if (isShown()) {
            if (frameDelayMs > 0) postInvalidateDelayed(frameDelayMs);
            else postInvalidateOnAnimation();
        }
    }

    /** Trains wait at each station for part of the hop, then ease to the next. */
    private static float distanceAt(Line line, float stops) {
        int hops = line.stopDistance.length - 1;
        int i = Math.min((int) Math.floor(stops), hops - 1);
        float f = Math.min(1f, stops - i);
        f = f < DWELL ? 0f : (f - DWELL) / (1f - DWELL);
        f = f * f * (3f - 2f * f);
        return line.stopDistance[i] + (line.stopDistance[i + 1] - line.stopDistance[i]) * f;
    }

    /** Distance along a polyline to the point on it closest to (px, py). */
    private static float nearestDistance(float[] route, float px, float py) {
        float best = Float.MAX_VALUE, bestAlong = 0, walked = 0;
        for (int i = 0; i + 3 < route.length; i += 2) {
            float ax = route[i], ay = route[i + 1], bx = route[i + 2], by = route[i + 3];
            float dx = bx - ax, dy = by - ay;
            float len2 = dx * dx + dy * dy;
            float len = (float) Math.sqrt(len2);
            float t = len2 == 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
            float cx = ax + t * dx - px, cy = ay + t * dy - py;
            float d2 = cx * cx + cy * cy;
            if (d2 < best) {
                best = d2;
                bestAlong = walked + t * len;
            }
            walked += len;
        }
        return bestAlong;
    }

    private Bitmap renderStatic() {
        Bitmap bmp;
        try {
            bmp = Bitmap.createBitmap(getWidth(), getHeight(), Bitmap.Config.ARGB_8888);
        } catch (OutOfMemoryError e) {
            return null;
        }
        Canvas c = new Canvas(bmp);

        linePaint.setStrokeWidth(Math.max(2f, 6f * scale));
        for (Line line : LINES) {
            linePaint.setColor(line.color);
            c.drawPath(line.path, linePaint);
        }

        float stopR = Math.max(1f, 2.6f * scale);
        float[] pt = new float[2];
        for (Line line : LINES) {
            for (int i = 0; i < line.stopDistance.length; i++) {
                line.measure.getPosTan(line.stopDistance[i], pt, null);
                c.drawCircle(pt[0], pt[1], stopR, stopPaint);
            }
        }

        float capsule = Math.max(6f, 24f * scale);
        capsuleRing.setStrokeWidth(capsule);
        capsuleFill.setStrokeWidth(capsule - Math.max(2f, 6f * scale));
        float[] ends = new float[4];
        for (float[] ix : INTERCHANGES) {
            System.arraycopy(ix, 0, ends, 0, 4);
            toScreen.mapPoints(ends);
            c.drawLine(ends[0], ends[1], ends[2], ends[3], capsuleRing);
            c.drawLine(ends[0], ends[1], ends[2], ends[3], capsuleFill);
        }

        if (showLabels) {
            labelPaint.setTextSize(Math.max(10f, 27f * scale));
            for (Label label : LABELS) {
                pt[0] = label.x;
                pt[1] = label.y;
                toScreen.mapPoints(pt);
                labelPaint.setTextAlign(label.align);
                float lineHeight = labelPaint.getTextSize() * 1.15f;
                String[] rows = label.text.split("\n");
                for (int r = 0; r < rows.length; r++) {
                    c.drawText(rows[r], pt[0], pt[1] + r * lineHeight, labelPaint);
                }
            }
        }
        return bmp;
    }

    static int lineCount() {
        return LINES.length;
    }

    static String lineName(int i) {
        return LINES[i].name;
    }

    static int lineColor(int i) {
        return LINES[i].color;
    }
}
