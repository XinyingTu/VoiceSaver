/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        void: "#05060d",
        panel: "#0b0e1c",
        paneledge: "#161b34",
        cyan: {
          glow: "#22d3ee",
          soft: "#67e8f9",
        },
        magenta: {
          glow: "#f0338d",
          soft: "#ff6bb3",
        },
        neonlime: "#a3e635",
        amberflag: "#f59e0b",
      },
      fontFamily: {
        mono: ["'JetBrains Mono'", "'SF Mono'", "ui-monospace", "monospace"],
        display: ["'Orbitron'", "'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      boxShadow: {
        neon: "0 0 18px rgba(34,211,238,0.35), inset 0 0 12px rgba(34,211,238,0.08)",
        magenta: "0 0 24px rgba(240,51,141,0.4)",
        panel: "0 0 0 1px rgba(34,211,238,0.08), 0 24px 60px -20px rgba(0,0,0,0.9)",
      },
      keyframes: {
        pulseglow: {
          "0%, 100%": { opacity: "0.55" },
          "50%": { opacity: "1" },
        },
        flicker: {
          "0%, 19%, 21%, 55%, 57%, 100%": { opacity: "1" },
          "20%, 56%": { opacity: "0.4" },
        },
        scan: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100%)" },
        },
        risein: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        pulseglow: "pulseglow 2.2s ease-in-out infinite",
        flicker: "flicker 3s linear infinite",
        scan: "scan 6s linear infinite",
        risein: "risein 0.35s ease-out both",
      },
    },
  },
  plugins: [],
};
