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
  const tv = /(Android\s?TV|Google\s?TV|SMART-?TV|SmartTV|GoogleTV|AFT[A-Z0-9]+|SHIELD|NVIDIA|mdarcy|darcy|foster|BRAVIA|AQUOS|Philips|Chromecast|Web0S|WEBOS|Tizen|CrKey|HbbTV|NetCast|AppleTV|ATV|OTT|STB|BOX|Freebox|Bouygues|SFR|Sagem|Humax|Arris|Sky|TiVo|Roku|RokuTV|FireTV|MiTV|XiaomiTV|TCL|Hisense|Skyworth|SonyTV|Vizio|Viera|Panasonic|LG\s?TV|web0s|PhilipsTV|AsusTV|RealmeTV|OnePlusTV|MotorolaTV|NokiaTV|HonorTV|SharpTV|JVC|Hitachi|Grundig|Telefunken|BangOlufsen|Loewe|Metz|Blu\s?Star|iStar|MAG)/i.test(
    ua,
  );
  if (tv) return true;
  // Generic Android without "Mobile"/"Tablet" strongly implies a leanback TV box.
  if (/Android/i.test(ua) && !/Mobile/i.test(ua) && !/Tablet/i.test(ua)) return true;
  return false;
}

/** True when the device is an Android TV / Google TV / Fire TV style box. */
export function isAndroidTvBox(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (isTvDevice() && isAndroid()) return true;
  // Catch generic Android boxes that only expose a model name without "TV".
  return /Android/i.test(ua) && !/Mobile/i.test(ua) && !/Tablet/i.test(ua) && !/Wear/i.test(ua);
}

/** True on any Android browser or WebView. */
export function isAndroid(): boolean {
  if (typeof window === "undefined") return false;
  return /Android/i.test(navigator.userAgent || "");
}

/** True inside the Capacitor APK running on Android (phone, tablet or TV). */
export function isAndroidNative(): boolean {
  return isNativeApp() && isAndroid();
}
