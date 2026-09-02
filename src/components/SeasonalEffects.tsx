// Lightweight decorative overlay driven by the Personalization > Seasonal
// Effects preference. Purely visual, pointer-events none, no layout impact.
import { useMemo } from "react";
import { activeSeasonalEffect, usePersonalization } from "@/lib/personalization";

export function SeasonalEffects() {
  const { prefs } = usePersonalization();
  const effect = activeSeasonalEffect(prefs.seasonal);

  const particles = useMemo(
    () =>
      Array.from({ length: 24 }, (_, i) => ({
        left: (i * 37) % 100,
        delay: (i % 8) * 1.3,
        duration: 9 + ((i * 7) % 8),
        size: effect === "snow" ? 4 + (i % 4) * 2 : 3 + (i % 3) * 2,
      })),
    [effect],
  );

  if (!effect) return null;

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
      {particles.map((p, i) => (
        <span
          key={i}
          className={
            effect === "snow"
              ? "absolute top-[-10%] rounded-full bg-foreground/60 blur-[1px]"
              : "absolute top-[-10%] rounded-full bg-primary/70 blur-[1px]"
          }
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size,
            animation: `relay-fall ${p.duration}s linear ${p.delay}s infinite`,
          }}
        />
      ))}
      <style>{`@keyframes relay-fall{0%{transform:translateY(-10vh) translateX(0);opacity:0}10%{opacity:.9}100%{transform:translateY(110vh) translateX(30px);opacity:0}}`}</style>
    </div>
  );
}
