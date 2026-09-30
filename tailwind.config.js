
/** @type {import('tailwindcss').Config} */
export default {
  // Front sources only: the former "./**/*.{js,ts,jsx,tsx}" also scanned node_modules, dist and help/
  // (Tailwind warning), a memory peak of the Docker build that endangered Neo4j (2026-09-30).
  content: [
    "./index.html",
    "./*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./hooks/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Hanken Grotesk', 'system-ui', 'sans-serif'],
        // "pixel" kept as a legacy alias: now points to the display font
        pixel: ['Schibsted Grotesk', 'system-ui', 'sans-serif'],
        disp: ['Schibsted Grotesk', 'system-ui', 'sans-serif'],
      },
      colors: {
        // 2026 redesign palette — cream & soft yellow (variant 1B « barre latérale organique »)
        ink: '#1c1b19',
        accent: {
          DEFAULT: '#f4d24a',
          strong: '#eec93f',
        },
        cream: {
          50: '#f6f0da',
          100: '#f4f0e6',
          200: '#f2e8ce',
          300: '#f0ede4',
          400: '#e7e3d8',
          500: '#cfcabd',
        },
        muted: {
          DEFAULT: '#6f6a5e',
          light: '#8c8677',
          lighter: '#9a9486',
          faint: '#b3ad9f',
        },
        primary: {
          light: '#9a7bff',
          DEFAULT: '#7048e8',
          dark: '#1c1b19',
        },
        background: '#f4f0e6',
        surface: '#ffffff',
        // Old "pixel-*" tokens remapped to the new palette (compat with existing classes)
        'pixel-blue': '#3b5bdb',
        'pixel-gray': '#9a9486',
        'pixel-pink': '#e76f9a',
        'pixel-teal': '#2ea066',
        'pixel-cyan': '#20a4a4',
        'pixel-yellow': '#f4d24a',
        'pixel-violet': '#7048e8',
        'pixel-red': '#d64545',
        'pixel-teal-dark': '#1f7a4d',
        'pixel-raspberry': '#b23b3b',
        // Statuses
        status: {
          internal: '#1f7a4d',
          external: '#9a6a12',
          leaving: '#b23b3b',
        },
        // External identifiers
        orcid: '#A6CE39',
        scopus: '#E9711C',
      },
      boxShadow: {
        // Soft shadows (the "pixel" names are kept for compat)
        'pixel': '0 12px 30px -22px rgba(50, 42, 15, 0.5)',
        'pixel-hover': '0 20px 44px -26px rgba(50, 42, 15, 0.55)',
        'soft': '0 12px 30px -22px rgba(50, 42, 15, 0.5)',
        'soft-lg': '0 24px 54px -28px rgba(50, 42, 15, 0.55)',
        'nav-active': '0 12px 26px -14px rgba(20, 16, 6, 0.6)',
      },
      borderRadius: {
        'card': '20px',
        'panel': '24px',
        'hero': '28px',
      },
    },
  },
  plugins: [],
}
