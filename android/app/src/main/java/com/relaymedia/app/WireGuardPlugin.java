package com.relaymedia.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.VpnService;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.wireguard.android.backend.GoBackend;
import com.wireguard.android.backend.Tunnel;
import com.wireguard.config.Config;
import com.wireguard.config.Interface;

import java.io.BufferedReader;
import java.io.StringReader;

/** Built-in WireGuard VPN. Config is kept only in this app's private storage. */
@CapacitorPlugin(name = "RelayVpn")
public class WireGuardPlugin extends Plugin {
    private static GoBackend backend;
    private static final RelayTunnel tunnel = new RelayTunnel();
    private static String lastError = "";

    static class RelayTunnel implements Tunnel {
        volatile State state = State.DOWN;
        @Override public String getName() { return "relay"; }
        @Override public void onStateChange(State s) { state = s; }
    }

    private GoBackend backend() {
        if (backend == null) backend = new GoBackend(getContext().getApplicationContext());
        return backend;
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences("relay_vpn", Context.MODE_PRIVATE);
    }

    private JSObject status() {
        JSObject r = new JSObject();
        r.put("available", true);
        r.put("connected", tunnel.state == Tunnel.State.UP);
        r.put("hasConfig", prefs().getString("config", null) != null);
        r.put("appOnly", prefs().getBoolean("appOnly", true));
        r.put("error", lastError);
        return r;
    }

    @PluginMethod
    public void getStatus(PluginCall call) { call.resolve(status()); }

    @PluginMethod
    public void saveConfig(PluginCall call) {
        String cfg = call.getString("config", "");
        boolean appOnly = Boolean.TRUE.equals(call.getBoolean("appOnly", true));
        try {
            Config.parse(new BufferedReader(new StringReader(cfg)));
        } catch (Exception e) {
            call.reject("That doesn't look like a valid WireGuard config: " + e.getMessage());
            return;
        }
        prefs().edit().putString("config", cfg).putBoolean("appOnly", appOnly).apply();
        call.resolve(status());
    }

    @PluginMethod
    public void clearConfig(PluginCall call) {
        try { backend().setState(tunnel, Tunnel.State.DOWN, null); } catch (Exception ignored) {}
        prefs().edit().clear().apply();
        call.resolve(status());
    }

    @PluginMethod
    public void connect(PluginCall call) {
        Intent intent = VpnService.prepare(getContext());
        if (intent != null) {
            startActivityForResult(call, intent, "onVpnPermission");
            return;
        }
        doConnect(call);
    }

    @ActivityCallback
    private void onVpnPermission(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK) {
            call.reject("VPN permission was not granted.");
            return;
        }
        doConnect(call);
    }

    private void doConnect(PluginCall call) {
        String raw = prefs().getString("config", null);
        if (raw == null) { call.reject("No VPN config saved."); return; }
        boolean appOnly = prefs().getBoolean("appOnly", true);
        new Thread(() -> {
            try {
                Config parsed = Config.parse(new BufferedReader(new StringReader(raw)));
                Config cfg = parsed;
                if (appOnly) {
                    Interface.Builder ib = new Interface.Builder();
                    Interface src = parsed.getInterface();
                    ib.addAddresses(src.getAddresses());
                    ib.addDnsServers(src.getDnsServers());
                    ib.setKeyPair(src.getKeyPair());
                    if (src.getListenPort().isPresent()) ib.setListenPort(src.getListenPort().get());
                    if (src.getMtu().isPresent()) ib.setMtu(src.getMtu().get());
                    ib.includeApplication(getContext().getPackageName());
                    cfg = new Config.Builder().setInterface(ib.build()).addPeers(parsed.getPeers()).build();
                }
                backend().setState(tunnel, Tunnel.State.UP, cfg);
                lastError = "";
                call.resolve(status());
            } catch (Exception e) {
                lastError = String.valueOf(e.getMessage());
                call.reject("Couldn't connect the VPN: " + lastError);
            }
        }).start();
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        new Thread(() -> {
            try { backend().setState(tunnel, Tunnel.State.DOWN, null); } catch (Exception ignored) {}
            call.resolve(status());
        }).start();
    }
}
