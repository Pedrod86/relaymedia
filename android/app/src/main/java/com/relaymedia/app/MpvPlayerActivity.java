package com.relaymedia.app;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.view.WindowManager;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import dev.jdtech.mpv.MPVLib;

/**
 * Full-screen MPV (libmpv) player. Plays practically any container/codec via
 * FFmpeg, renders styled ASS/SSA subtitles natively, and uses Android
 * MediaCodec hardware decoding when requested.
 *
 * Remote: OK/Space = play/pause, Left/Right = ±10s, Up/Down = ±60s,
 * Menu/Info = cycle subtitles, Back = close.
 */
public class MpvPlayerActivity extends AppCompatActivity implements SurfaceHolder.Callback, MPVLib.EventObserver {

    public static final String EXTRA_HWDEC = "hwdec";
    public static final String EXTRA_PASSTHROUGH = "passthrough";

    private static final int EVENT_END_FILE = 7;
    private static final int EVENT_FILE_LOADED = 8;

    private MPVLib mpv;
    private TextView osd;
    private TextView errorView;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Runnable hideOsd = () -> osd.setVisibility(View.GONE);
    private String url;
    private String subtitleUrl;
    private boolean loaded = false;
    private boolean started = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(R.layout.activity_mpv_player);
        osd = findViewById(R.id.mpv_osd);
        errorView = findViewById(R.id.mpv_error);

        url = getIntent().getStringExtra(Media3PlayerActivity.EXTRA_URL);
        if (url == null || url.isEmpty()) { finish(); return; }
        subtitleUrl = getIntent().getStringExtra(Media3PlayerActivity.EXTRA_SUBTITLE_URL);
        String hwdec = getIntent().getStringExtra(EXTRA_HWDEC);
        long startMs = getIntent().getLongExtra(Media3PlayerActivity.EXTRA_START_MS, 0L);
        String lang = getIntent().getStringExtra(Media3PlayerActivity.EXTRA_SUBTITLE_LANG);

        try {
            mpv = MPVLib.create(this);
            mpv.setOptionString("vo", "gpu");
            mpv.setOptionString("gpu-context", "android");
            mpv.setOptionString("opengl-es", "yes");
            mpv.setOptionString("hwdec", hwdec == null || hwdec.isEmpty() ? "mediacodec-copy" : hwdec);
            mpv.setOptionString("hwdec-codecs", "h264,hevc,mpeg4,mpeg2video,vp8,vp9,av1");
            mpv.setOptionString("ao", "audiotrack,opensles");
            if (getIntent().getBooleanExtra(EXTRA_PASSTHROUGH, false)) {
                mpv.setOptionString("audio-spdif", "ac3,eac3,dts,dts-hd,truehd");
            }
            mpv.setOptionString("tls-verify", "no");
            mpv.setOptionString("cache", "yes");
            mpv.setOptionString("demuxer-max-bytes", "64MiB");
            mpv.setOptionString("demuxer-max-back-bytes", "32MiB");
            mpv.setOptionString("network-timeout", "30");
            mpv.setOptionString("force-window", "no");
            mpv.setOptionString("keep-open", "no");
            mpv.setOptionString("save-position-on-quit", "no");
            mpv.setOptionString("sub-ass", "yes");
            if (lang != null && !lang.isEmpty() && !"und".equals(lang)) mpv.setOptionString("slang", lang);
            if (startMs > 0) mpv.setOptionString("start", String.valueOf(startMs / 1000.0));
            mpv.init();
            mpv.addObserver(this);
        } catch (Throwable t) {
            showError("MPV could not start: " + t.getMessage());
            return;
        }

        SurfaceView surface = findViewById(R.id.mpv_surface);
        surface.getHolder().addCallback(this);
        surface.setFocusable(true);
        surface.requestFocus();
    }

    private void showError(String msg) {
        ui.post(() -> { errorView.setText(msg); errorView.setVisibility(View.VISIBLE); });
    }

    private void flash(String text) {
        ui.post(() -> {
            osd.setText(text);
            osd.setVisibility(View.VISIBLE);
            ui.removeCallbacks(hideOsd);
            ui.postDelayed(hideOsd, 2000);
        });
    }

    private static String fmt(Double s) {
        if (s == null) return "--:--";
        long t = (long) Math.max(0, s);
        long h = t / 3600, m = (t % 3600) / 60, sec = t % 60;
        return h > 0 ? String.format("%d:%02d:%02d", h, m, sec) : String.format("%d:%02d", m, sec);
    }

    private void showPosition(String prefix) {
        if (mpv == null) return;
        flash(prefix + fmt(mpv.getPropertyDouble("time-pos")) + " / " + fmt(mpv.getPropertyDouble("duration")));
    }

    // ── Surface ───────────────────────────────────────────────────────────
    @Override
    public void surfaceCreated(SurfaceHolder holder) {
        if (mpv == null) return;
        mpv.attachSurface(holder.getSurface());
        mpv.setOptionString("force-window", "yes");
        if (!started) {
            started = true;
            mpv.command(new String[]{"loadfile", url});
        } else {
            mpv.setPropertyString("vo", "gpu");
        }
    }

    @Override
    public void surfaceChanged(SurfaceHolder holder, int format, int w, int h) {
        if (mpv != null) mpv.setPropertyString("android-surface-size", w + "x" + h);
    }

    @Override
    public void surfaceDestroyed(SurfaceHolder holder) {
        if (mpv == null) return;
        mpv.setPropertyString("vo", "null");
        mpv.setOptionString("force-window", "no");
        mpv.detachSurface();
    }

    // ── Events ────────────────────────────────────────────────────────────
    @Override public void eventProperty(String p) {}
    @Override public void eventProperty(String p, long v) {}
    @Override public void eventProperty(String p, double v) {}
    @Override public void eventProperty(String p, boolean v) {}
    @Override public void eventProperty(String p, String v) {}

    @Override
    public void event(int id) {
        if (id == EVENT_FILE_LOADED) {
            loaded = true;
            if (subtitleUrl != null && !subtitleUrl.isEmpty() && mpv != null) {
                mpv.command(new String[]{"sub-add", subtitleUrl, "select"});
            }
        } else if (id == EVENT_END_FILE) {
            if (!loaded) showError("Playback error: MPV could not open this stream.");
            else ui.post(this::finish);
        }
    }

    // ── Remote / keyboard ─────────────────────────────────────────────────
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (mpv == null) return super.onKeyDown(keyCode, event);
        switch (keyCode) {
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_SPACE:
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
                mpv.command(new String[]{"cycle", "pause"});
                Boolean paused = mpv.getPropertyBoolean("pause");
                showPosition(Boolean.TRUE.equals(paused) ? "Paused  " : "Playing  ");
                return true;
            case KeyEvent.KEYCODE_MEDIA_PLAY:
                mpv.setPropertyBoolean("pause", false); showPosition("Playing  "); return true;
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
                mpv.setPropertyBoolean("pause", true); showPosition("Paused  "); return true;
            case KeyEvent.KEYCODE_DPAD_RIGHT:
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
                mpv.command(new String[]{"seek", "10", "relative"}); showPosition("» "); return true;
            case KeyEvent.KEYCODE_DPAD_LEFT:
            case KeyEvent.KEYCODE_MEDIA_REWIND:
                mpv.command(new String[]{"seek", "-10", "relative"}); showPosition("« "); return true;
            case KeyEvent.KEYCODE_DPAD_UP:
                mpv.command(new String[]{"seek", "60", "relative"}); showPosition("»» "); return true;
            case KeyEvent.KEYCODE_DPAD_DOWN:
                mpv.command(new String[]{"seek", "-60", "relative"}); showPosition("«« "); return true;
            case KeyEvent.KEYCODE_MENU:
            case KeyEvent.KEYCODE_INFO:
            case KeyEvent.KEYCODE_CAPTIONS:
                mpv.command(new String[]{"cycle", "sub"});
                String sid = mpv.getPropertyString("sid");
                flash("Subtitles: " + (sid == null || "no".equals(sid) ? "off" : sid));
                return true;
            case KeyEvent.KEYCODE_MEDIA_AUDIO_TRACK:
                mpv.command(new String[]{"cycle", "audio"});
                flash("Audio track: " + mpv.getPropertyString("aid"));
                return true;
            case KeyEvent.KEYCODE_MEDIA_STOP:
                finish(); return true;
            default:
                return super.onKeyDown(keyCode, event);
        }
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacksAndMessages(null);
        if (mpv != null) {
            try { mpv.removeObserver(this); mpv.destroy(); } catch (Throwable ignored) {}
            mpv = null;
        }
        super.onDestroy();
    }
}
