# Architecture rules

- Store custom CSS as device-local preferences and apply it through one root-mounted style element; keep Settings exempt so broken overrides cannot block recovery.
- Render custom CSS previews in a script-disabled iframe and assign CSS using textContent, never HTML interpolation, to isolate user styles from the settings editor.
- The Android device player authenticates media/stream URLs with a short-lived sealed `vt` token on absolute URLs, because it cannot read the WebView's httpOnly vault cookie.
- Stream redirects to a different host are never followed with media-server credentials; try once without them, then hand the address to the device, since CDNs reject foreign auth headers and often block server IPs.
