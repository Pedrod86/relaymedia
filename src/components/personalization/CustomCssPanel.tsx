import { useEffect, useRef, useState } from "react";
import { Eye, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CUSTOM_CSS_LIMIT, loadCustomCss, saveCustomCss } from "@/lib/custom-css";

const EXAMPLE = `:root {
  --background: oklch(0.18 0.02 220);
  --card: oklch(0.24 0.03 220);
  --primary: oklch(0.78 0.15 175);
}

body {
  background-color: var(--background);
}
`;
const PREVIEW = `<!doctype html><html><head></head><body><main><h1>Relay Media</h1><p>Your library</p><section class="bg-card"><h2>Recently added</h2><p class="text-muted-foreground">Movies &amp; TV shows</p><button class="bg-primary">Play</button></section></main></body></html>`;

export function CustomCssPanel() {
  const [css, setCss] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [preview, setPreview] = useState("");
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const saved = loadCustomCss();
    setCss(saved.css);
    setEnabled(saved.enabled);
    setPreview(saved.css);
  }, []);

  function renderPreview() {
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    let style = doc.getElementById("preview-css");
    if (!style) {
      style = doc.createElement("style");
      style.id = "preview-css";
      doc.head.appendChild(style);
    }
    const tokens = getComputedStyle(document.documentElement);
    const vars = ["background", "foreground", "card", "primary", "primary-foreground", "muted-foreground", "border"]
      .map((name) => `--${name}:${tokens.getPropertyValue(`--${name}`)};`).join("");
    style.textContent = `:root{${vars}}body{margin:0;background:var(--background);color:var(--foreground);font-family:system-ui}main{padding:24px}h1{font-size:24px}h2{font-size:18px}section{padding:20px;border:1px solid var(--border);border-radius:8px}.bg-card{background:var(--card)}.text-muted-foreground{color:var(--muted-foreground)}.bg-primary{background:var(--primary);color:var(--primary-foreground);border:0;padding:10px 20px;border-radius:6px}${preview}`;
  }

  useEffect(renderPreview, [preview]);

  function persist(nextCss: string, nextEnabled: boolean) {
    try {
      saveCustomCss({ css: nextCss, enabled: nextEnabled });
      setEnabled(nextEnabled);
      toast.success("Custom CSS saved on this device");
    } catch {
      toast.error("Couldn't save your changes. Device storage may be full.");
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <label htmlFor="custom-css-enabled" className="text-sm font-medium">Enable custom CSS</label>
        <Switch id="custom-css-enabled" checked={enabled} onCheckedChange={(value) => persist(css, value)} />
      </div>
      <div className="space-y-2">
        <label htmlFor="custom-css-editor" className="text-sm font-medium">Stylesheet</label>
        <Textarea id="custom-css-editor" value={css} onChange={(event) => setCss(event.target.value)}
          maxLength={CUSTOM_CSS_LIMIT} spellCheck={false} autoCapitalize="off" autoCorrect="off"
          className="min-h-72 resize-y font-mono text-sm" placeholder={EXAMPLE} />
        <p className="text-xs text-muted-foreground">{css.length.toLocaleString()} / {CUSTOM_CSS_LIMIT.toLocaleString()} characters</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => persist(css, enabled)}><Save className="size-4" />Save</Button>
        <Button variant="outline" onClick={() => setPreview(css)}><Eye className="size-4" />Preview</Button>
        <Button variant="outline" onClick={() => { setCss(EXAMPLE); setPreview(EXAMPLE); }}>Load example</Button>
        <Button variant="ghost" onClick={() => { persist("", false); setCss(""); setPreview(""); }}><RotateCcw className="size-4" />Reset</Button>
      </div>
      <iframe ref={frame} title="Custom CSS preview" sandbox="allow-same-origin" srcDoc={PREVIEW}
        onLoad={renderPreview} className="h-80 w-full rounded-lg border bg-background" />
      <p className="text-xs text-muted-foreground">Saved on this device. Settings always keeps its original appearance so you can disable or reset your CSS. External images and fonts may contact their hosting websites.</p>
    </section>
  );
}