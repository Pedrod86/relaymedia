# Architecture rules
- Normalize media sign-in addresses with the shared normalizeServerInput helper before validation; retain explicit ports and use service defaults only for Plex, Emby and Jellyfin because Silo/IPTV ports vary by provider.

- Store custom CSS as device-local preferences and apply it through one root-mounted style element that also suspends the built-in theme class while active (theme selectors outrank user rules); keep Settings exempt so broken overrides cannot block recovery.
- Render custom CSS previews in a script-disabled iframe and assign CSS using textContent, never HTML interpolation, to isolate user styles from the settings editor.
- The Android device player authenticates media/stream URLs with a short-lived sealed `vt` token on absolute URLs, because it cannot read the WebView's httpOnly vault cookie.
- Stream redirects to a different host are never followed with media-server credentials; try once without them, then hand the address to the device, since CDNs reject foreign auth headers and often block server IPs.
- Sign every APK from 1.6 on with the persistent release key kept in Files under relay-signing/v2 (copy its keystore.properties into android/ only for the build, then delete it), so each new APK installs over the previous one.
- The built-in VPN is WireGuard via the native RelayVpn plugin; the config lives only in the APK's private SharedPreferences, never in web storage or our backend, because it holds a private key.
- Use one shared query-backed WireGuard status hook for home and Settings; query exit country directly from the device and keep only the country in memory, because a server-side lookup would locate Relay’s server instead of the VPN exit.
- Resolve RelayVpn through a dynamically imported Capacitor registerPlugin proxy after checking native availability; Java plugin registration need not populate the legacy window.Capacitor.Plugins map.
- Home and Settings share account-scoped collection queries and the same collection detail view; hide home collections in kids profiles because imported titles have no verified age ratings.
- Built-in MPV device player engine is selectable in Settings → Player and routed through the Media3Player plugin's playMpv, falling back to Media3 on older APKs; APK minSdk is 26 because libmpv requires it.
- Silo sign-in authenticates via Silo V2 (/api/v2/auth/login) and discovers the Jellyfin-compatible URL from /api/v2/compat/connect-info; library and playback still use that Jellyfin endpoint because the V2 playback protocol needs device-negotiated plans we cannot yet test.
