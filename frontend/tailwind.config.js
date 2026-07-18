/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // WCAG 2.1 AA palette — background and body-text kept separate so
        // contrast never depends on colored-text-on-colored-background.
        surface: "#0D1117", // deep obsidian grey (base)
        panel: "#161B22", // raised panel
        panel2: "#1C2230", // nested surface
        edge: "#30363D", // borders
        body: "#E6EDF3", // near-white body text (~15.8:1 on surface)
        muted: "#9DA7B3", // secondary text (>= 4.5:1 on surface)
        success: "#10B981", // emerald — icon/border/badge only
        danger: "#EF4444", // crimson — icon/border/badge only
        access: "#F59E0B", // amber gold — ADA active state
        info: "#58A6FF", // links / neutral accent
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["'JetBrains Mono'", "'SF Mono'", "ui-monospace", "monospace"],
      },
      fontSize: {
        // Body minimum 16px per the spec.
        base: ["16px", "1.55"],
      },
      keyframes: {
        softpulse: { "0%,100%": { opacity: "0.6" }, "50%": { opacity: "1" } },
        tumble: { "0%": { transform: "translateY(-40%)", opacity: "0" }, "100%": { transform: "translateY(0)", opacity: "1" } },
        risein: { "0%": { opacity: "0", transform: "translateY(6px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
      },
      animation: {
        softpulse: "softpulse 2.4s ease-in-out infinite",
        tumble: "tumble 0.5s ease-out both",
        risein: "risein 0.3s ease-out both",
      },
    },
  },
  plugins: [],
};
