import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { isNativeApp } from "./platform";

/**
 * Android hardware/remote BACK inside the APK.
 *
 * Default Capacitor behaviour closes the app whenever the WebView thinks it
 * cannot go back, which happens constantly with client-side routing. Here we
 * step back through router history instead, and only exit when we are already
 * on a top-level screen with nothing behind us.
 */
export function useAndroidBackButton() {
  const router = useRouter();

  useEffect(() => {
    if (!isNativeApp()) return;

    let cancelled = false;
    let remove: (() => void) | undefined;

    void (async () => {
      try {
        const { App } = await import("@capacitor/app");
        const handle = await App.addListener("backButton", () => {
          // Close any open dialog/sheet first.
          const overlay = document.querySelector<HTMLElement>(
            "[data-state='open'][role='dialog'],[data-state='open'][role='alertdialog']",
          );
          if (overlay) {
            document.dispatchEvent(
              new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
            );
            return;
          }

          const canGoBack = router.history.canGoBack();
          const path = router.state.location.pathname;

          if (canGoBack) {
            router.history.back();
            return;
          }

          // Nothing behind us: land on the library once, then allow exit.
          if (path !== "/library" && path !== "/login" && path !== "/") {
            void router.navigate({ to: "/library" });
            return;
          }

          void App.exitApp();
        });
        if (cancelled) void handle.remove();
        else remove = () => void handle.remove();
      } catch {
        // Plugin unavailable (older APK) — keep default behaviour.
      }
    })();

    return () => {
      cancelled = true;
      remove?.();
    };
  }, [router]);
}
