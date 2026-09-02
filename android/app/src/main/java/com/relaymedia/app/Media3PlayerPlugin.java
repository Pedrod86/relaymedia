package com.relaymedia.app;

import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bridges the web player to AndroidX Media3 / ExoPlayer.
 *
 * The WebView can only play what Chromium's demuxers support. ExoPlayer uses the
 * platform MediaCodec stack directly, so MKV, E-AC3 / Dolby Digital+, HEVC 10-bit
 * HDR10 and Dolby Vision play without the server transcoding them.
 */
@CapacitorPlugin(name = "Media3Player")
public class Media3PlayerPlugin extends Plugin {

    /** Tells the web layer that native ExoPlayer playback is available here. */
    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", true);
        call.resolve(ret);
    }

    /** Opens the full-screen Media3 player on the given stream URL. */
    @PluginMethod
    public void play(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("A stream url is required");
            return;
        }

        Intent intent = new Intent(getContext(), Media3PlayerActivity.class);
        intent.putExtra(Media3PlayerActivity.EXTRA_URL, url);
        intent.putExtra(Media3PlayerActivity.EXTRA_TITLE, call.getString("title", ""));
        intent.putExtra(Media3PlayerActivity.EXTRA_SUBTITLE_URL, call.getString("subtitleUrl", ""));
        intent.putExtra(Media3PlayerActivity.EXTRA_SUBTITLE_LANG, call.getString("subtitleLang", "und"));
        Long startMs = call.getLong("startPositionMs", 0L);
        intent.putExtra(Media3PlayerActivity.EXTRA_START_MS, startMs == null ? 0L : startMs);
        intent.putExtra(Media3PlayerActivity.EXTRA_TUNNELING, Boolean.TRUE.equals(call.getBoolean("tunneling", true)));
        getActivity().startActivity(intent);

        call.resolve();
    }
}
