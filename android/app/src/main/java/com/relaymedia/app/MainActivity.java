package com.relaymedia.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // AndroidX Media3 / ExoPlayer bridge for MKV, E-AC3 and HDR playback.
        registerPlugin(Media3PlayerPlugin.class);
        // In-app APK update checker / installer.
        registerPlugin(AppUpdaterPlugin.class);
        // Built-in WireGuard VPN.
        registerPlugin(WireGuardPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
