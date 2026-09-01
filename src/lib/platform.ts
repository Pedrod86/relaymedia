// Lightweight, browser-only platform detection.
//
// Used to adapt the UI when the app runs inside the Capacitor APK, and to turn
// on the 10-foot (TV) layout automatically on Android TV / Fire TV boxes.

export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
  return Boolean(w.Capacitor?.isNativePlatform?.());
}

/**
 * True on Android TV, Google TV, Fire TV and similar leanback devices.
 * Signals: TV keywords in the UA, plus "no fine pointer / no hover" which is
 * true for remote-controlled devices but not for phones with touch.
 */
export function isTvDevice(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/\b(Android\s?TV|Google\s?TV|SMART-?TV|SmartTV|GoogleTV|AFT[A-Z0-9]+|BRAVIA|Web0S|WEBOS|Tizen|CrKey|HbbTV|NetCast|AppleTV)\b/i.test(ua))
    return true;
  // Fire TV / many boxes only expose the model in the UA (e.g. "AFTKA").
  if (/Android/i.test(ua) && !/Mobile/i.test(ua) && window.matchMedia?.("(hover: none) and (pointer: coarse)").matches === false)
    return true;
  return false;
}
