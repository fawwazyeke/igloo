import type { CSSProperties, ReactNode } from "react";

const OPACITY = { subtle: 0.3, medium: 0.55, strong: 0.85 };
const DEFAULT_COLORS = ["#25B5A9", "#A0FF77"];

type AuroraProps = {
  colors?: string[];
  fade?: boolean;
  intensity?: keyof typeof OPACITY;
  speed?: number;
  className?: string;
  children?: ReactNode;
};

// Northern-lights backdrop: two layers of tilted colour bands slide past each other. CSS only, see globals.css.
export function Aurora({ colors = DEFAULT_COLORS, fade = true, intensity = "medium", speed = 1, className = "", children }: AuroraProps) {
  const palette = colors.length ? colors : DEFAULT_COLORS;
  const style = {
    "--aurora-opacity": OPACITY[intensity],
    "--aurora-speed": `${28 / speed}s`,
    ...Object.fromEntries([0, 1, 2, 3, 4].map((i) => [`--aurora-color-${i + 1}`, palette[i % palette.length]])),
  } as CSSProperties;

  return (
    <div data-slot="aurora" className={`aurora ${fade ? "aurora-fade" : ""} ${className}`} style={style}>
      <div className="aurora-light" aria-hidden="true">
        <span className="aurora-band aurora-band-a" />
        <span className="aurora-band aurora-band-b" />
      </div>
      {children}
    </div>
  );
}
