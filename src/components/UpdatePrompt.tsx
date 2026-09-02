import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";
import {
  checkForUpdate,
  downloadAndInstall,
  openInstallPermission,
  skipRelease,
  type UpdateCheck,
} from "@/lib/app-update";

/**
 * Checks for a newer APK on launch (and when the app returns to the
 * foreground), then downloads and installs it on confirmation.
 * Renders nothing on the web.
 */
export function UpdatePrompt() {
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const result = await checkForUpdate();
      if (cancelled || !result?.updateAvailable) return;
      setCheck(result);
      setOpen(true);
    };
    // Give the WebView a moment to register native plugins.
    const t = setTimeout(run, 2500);
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const release = check?.release;
  if (!release) return null;

  const install = async () => {
    if (check && !check.canInstall) {
      toast.info("Allow Relay to install apps, then tap Update again.");
      await openInstallPermission();
      return;
    }
    setBusy(true);
    setPercent(0);
    const res = await downloadAndInstall(release.apkUrl, setPercent);
    setBusy(false);
    if (res.ok) {
      toast.success("Download complete — follow the installer to finish.");
      setOpen(false);
    } else {
      toast.error(res.error ?? "Update failed. Try again later.");
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(v) => (busy ? null : setOpen(v))}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Update available — v{release.versionName}</AlertDialogTitle>
          <AlertDialogDescription>
            You're on v{check?.currentVersionName}. {release.notes}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {busy ? (
          <div className="space-y-2">
            <Progress value={percent} />
            <p className="text-xs text-muted-foreground">Downloading… {percent}%</p>
          </div>
        ) : null}

        <AlertDialogFooter>
          {!release.mandatory ? (
            <AlertDialogCancel
              disabled={busy}
              onClick={() => {
                skipRelease(release.versionCode);
                setOpen(false);
              }}
            >
              Not now
            </AlertDialogCancel>
          ) : null}
          <AlertDialogAction
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              void install();
            }}
            autoFocus
          >
            {busy ? "Updating…" : "Update now"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
