import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { CUSTOM_CSS_EVENT, CUSTOM_CSS_KEY, loadCustomCss } from "@/lib/custom-css";
import { applyTheme, loadTheme } from "@/lib/theme";

/** Settings stays unstyled so a bad override can always be disabled there. */
export function CustomCss() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  useEffect(() => {
    const style = document.createElement("style");
    style.id = "relay-custom-css";
    document.head.appendChild(style);
    const sync = () => {
      const prefs = loadCustomCss();
      const active = pathname !== "/settings" && prefs.enabled && prefs.css.trim() !== "";
      style.textContent = active ? prefs.css : "";
      // Built-in themes style body/headings with class selectors that outrank
      // plain user rules, so active custom CSS replaces the theme entirely.
      applyTheme(active ? "default" : loadTheme());
    };
    const storage = (event: StorageEvent) => {
      if (event.key === CUSTOM_CSS_KEY || event.key === null) sync();
    };
    sync();
    window.addEventListener(CUSTOM_CSS_EVENT, sync);
    window.addEventListener("storage", storage);
    return () => {
      style.remove();
      applyTheme(loadTheme());
      window.removeEventListener(CUSTOM_CSS_EVENT, sync);
      window.removeEventListener("storage", storage);
    };
  }, [pathname]);
  return null;
}