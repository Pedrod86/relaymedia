# Architecture rules

- Store custom CSS as device-local preferences and apply it through one root-mounted style element; keep Settings exempt so broken overrides cannot block recovery.
- Render custom CSS previews in a script-disabled iframe and assign CSS using textContent, never HTML interpolation, to isolate user styles from the settings editor.