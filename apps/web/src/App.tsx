import { useCallback, useRef, useState } from "react";
import { AlphaTabRenderer } from "@stdbd/render";
import { colors, typography } from "@stdbd/ui";
import { demoScore } from "./demo/demoScore";

export function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<AlphaTabRenderer | null>(null);
  const [loaded, setLoaded] = useState(false);

  const handleLoad = useCallback(() => {
    if (!containerRef.current || rendererRef.current) return;
    const renderer = new AlphaTabRenderer(containerRef.current);
    renderer.mount();
    renderer.loadScore(demoScore);
    setLoaded(true);
    rendererRef.current = renderer;
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: colors.bg,
        color: colors.text,
        fontFamily: typography.fontFamily,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header
        style={{
          padding: "16px 24px",
          borderBottom: `1px solid ${colors.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <span style={{ fontSize: typography.sizeLg, fontWeight: 700 }}>stdBd</span>
          <span style={{ fontSize: typography.sizeSm, color: colors.textMuted }}>
            Phase 0 — vertical slice
          </span>
        </div>
        <button
          onClick={handleLoad}
          style={{
            background: loaded ? colors.bgPanel : colors.accent,
            color: colors.text,
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            padding: "8px 20px",
            fontSize: typography.sizeSm,
            cursor: "pointer",
          }}
        >
          {loaded ? "Score loaded" : "Load demo score"}
        </button>
      </header>
      <main style={{ flex: 1, padding: 24, overflow: "auto" }}>
        <div ref={containerRef} />
      </main>
    </div>
  );
}
