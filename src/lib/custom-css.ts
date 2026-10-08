export const CUSTOM_CSS_KEY = "relay:custom-css:v1";
export const CUSTOM_CSS_EVENT = "relay:custom-css-change";
export const CUSTOM_CSS_LIMIT = 30_000;
export type CustomCssPrefs = { css: string; enabled: boolean };

export function loadCustomCss(): CustomCssPrefs {
  try {
    const value = JSON.parse(localStorage.getItem(CUSTOM_CSS_KEY) ?? "null");
    return {
      css: typeof value?.css === "string" ? value.css.slice(0, CUSTOM_CSS_LIMIT) : "",
      enabled: value?.enabled === true,
    };
  } catch {
    return { css: "", enabled: false };
  }
}

export function saveCustomCss(value: CustomCssPrefs) {
  localStorage.setItem(CUSTOM_CSS_KEY, JSON.stringify(value));
  window.dispatchEvent(new Event(CUSTOM_CSS_EVENT));
}