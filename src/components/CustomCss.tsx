import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { CUSTOM_CSS_EVENT, CUSTOM_CSS_KEY, loadCustomCss } from "@/lib/custom-css";

/** Settings stays unstyled so a bad override can always be disabled there. */
export function CustomCss() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  useEffect(() => {
    const style = document.createElement("style");
    style.id = "relay-custom-css";
    document.head.appendChild(style);
    const sync = () => {
      const prefs = loadCustomCss();
      style.textContent = pathname !== "/settings" && prefs.enabled ? prefs.css : "";
    };
    const storage = (event: StorageEvent) => {
      if (event.key === CUSTOM_CSS_KEY || event.key === null) sync();
    };
    sync();
    window.addEventListener(CUSTOM_CSS_EVENT, sync);
    window.addEventListener("storage", storage);
    return () => {
      style.remove();
      window.removeEventListener(CUSTOM_CSS_EVENT, sync);
      window.removeEventListener("storage", storage);
    };
  }, [pathname]);
  return null;
}