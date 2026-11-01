/**
 * @file tailwind.config.js
 * @description Tailwind CSS configuration — content globs and the dashboard's themeable (CSS-variable) design tokens.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          0: "rgb(var(--surface-0) / <alpha-value>)",
          1: "rgb(var(--surface-1) / <alpha-value>)",
          2: "rgb(var(--surface-2) / <alpha-value>)",
          3: "rgb(var(--surface-3) / <alpha-value>)",
          4: "rgb(var(--surface-4) / <alpha-value>)",
          5: "rgb(var(--surface-5) / <alpha-value>)",
        },
        gray: {
          50: "rgb(var(--gray-50) / <alpha-value>)",
          100: "rgb(var(--gray-100) / <alpha-value>)",
          200: "rgb(var(--gray-200) / <alpha-value>)",
          300: "rgb(var(--gray-300) / <alpha-value>)",
          400: "rgb(var(--gray-400) / <alpha-value>)",
          500: "rgb(var(--gray-500) / <alpha-value>)",
          600: "rgb(var(--gray-600) / <alpha-value>)",
          700: "rgb(var(--gray-700) / <alpha-value>)",
          800: "rgb(var(--gray-800) / <alpha-value>)",
          900: "rgb(var(--gray-900) / <alpha-value>)",
          950: "rgb(var(--gray-950) / <alpha-value>)",
        },
        border: {
          DEFAULT: "rgb(var(--border) / <alpha-value>)",
          light: "rgb(var(--border-light) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          hover: "rgb(var(--accent-hover) / <alpha-value>)",
          muted: "rgb(var(--accent) / 0.15)",
        },
        emerald: {
          100: "rgb(var(--c-emerald-100) / <alpha-value>)",
          200: "rgb(var(--c-emerald-200) / <alpha-value>)",
          300: "rgb(var(--c-emerald-300) / <alpha-value>)",
          400: "rgb(var(--c-emerald-400) / <alpha-value>)",
        },
        red: {
          100: "rgb(var(--c-red-100) / <alpha-value>)",
          200: "rgb(var(--c-red-200) / <alpha-value>)",
          300: "rgb(var(--c-red-300) / <alpha-value>)",
          400: "rgb(var(--c-red-400) / <alpha-value>)",
        },
        violet: {
          100: "rgb(var(--c-violet-100) / <alpha-value>)",
          200: "rgb(var(--c-violet-200) / <alpha-value>)",
          300: "rgb(var(--c-violet-300) / <alpha-value>)",
          400: "rgb(var(--c-violet-400) / <alpha-value>)",
        },
        amber: {
          100: "rgb(var(--c-amber-100) / <alpha-value>)",
          200: "rgb(var(--c-amber-200) / <alpha-value>)",
          300: "rgb(var(--c-amber-300) / <alpha-value>)",
          400: "rgb(var(--c-amber-400) / <alpha-value>)",
        },
        blue: {
          100: "rgb(var(--c-blue-100) / <alpha-value>)",
          200: "rgb(var(--c-blue-200) / <alpha-value>)",
          300: "rgb(var(--c-blue-300) / <alpha-value>)",
          400: "rgb(var(--c-blue-400) / <alpha-value>)",
        },
        yellow: {
          100: "rgb(var(--c-yellow-100) / <alpha-value>)",
          200: "rgb(var(--c-yellow-200) / <alpha-value>)",
          300: "rgb(var(--c-yellow-300) / <alpha-value>)",
          400: "rgb(var(--c-yellow-400) / <alpha-value>)",
        },
        sky: {
          100: "rgb(var(--c-sky-100) / <alpha-value>)",
          200: "rgb(var(--c-sky-200) / <alpha-value>)",
          300: "rgb(var(--c-sky-300) / <alpha-value>)",
          400: "rgb(var(--c-sky-400) / <alpha-value>)",
        },
        cyan: {
          100: "rgb(var(--c-cyan-100) / <alpha-value>)",
          200: "rgb(var(--c-cyan-200) / <alpha-value>)",
          300: "rgb(var(--c-cyan-300) / <alpha-value>)",
          400: "rgb(var(--c-cyan-400) / <alpha-value>)",
        },
        indigo: {
          100: "rgb(var(--c-indigo-100) / <alpha-value>)",
          200: "rgb(var(--c-indigo-200) / <alpha-value>)",
          300: "rgb(var(--c-indigo-300) / <alpha-value>)",
          400: "rgb(var(--c-indigo-400) / <alpha-value>)",
        },
        orange: {
          100: "rgb(var(--c-orange-100) / <alpha-value>)",
          200: "rgb(var(--c-orange-200) / <alpha-value>)",
          300: "rgb(var(--c-orange-300) / <alpha-value>)",
          400: "rgb(var(--c-orange-400) / <alpha-value>)",
        },
        rose: {
          100: "rgb(var(--c-rose-100) / <alpha-value>)",
          200: "rgb(var(--c-rose-200) / <alpha-value>)",
          300: "rgb(var(--c-rose-300) / <alpha-value>)",
          400: "rgb(var(--c-rose-400) / <alpha-value>)",
        },
        teal: {
          100: "rgb(var(--c-teal-100) / <alpha-value>)",
          200: "rgb(var(--c-teal-200) / <alpha-value>)",
          300: "rgb(var(--c-teal-300) / <alpha-value>)",
          400: "rgb(var(--c-teal-400) / <alpha-value>)",
        },
        pink: {
          100: "rgb(var(--c-pink-100) / <alpha-value>)",
          200: "rgb(var(--c-pink-200) / <alpha-value>)",
          300: "rgb(var(--c-pink-300) / <alpha-value>)",
          400: "rgb(var(--c-pink-400) / <alpha-value>)",
        },
        fuchsia: {
          100: "rgb(var(--c-fuchsia-100) / <alpha-value>)",
          200: "rgb(var(--c-fuchsia-200) / <alpha-value>)",
          300: "rgb(var(--c-fuchsia-300) / <alpha-value>)",
          400: "rgb(var(--c-fuchsia-400) / <alpha-value>)",
        },
        green: {
          100: "rgb(var(--c-green-100) / <alpha-value>)",
          200: "rgb(var(--c-green-200) / <alpha-value>)",
          300: "rgb(var(--c-green-300) / <alpha-value>)",
          400: "rgb(var(--c-green-400) / <alpha-value>)",
        },
        slate: {
          100: "rgb(var(--c-slate-100) / <alpha-value>)",
          200: "rgb(var(--c-slate-200) / <alpha-value>)",
          300: "rgb(var(--c-slate-300) / <alpha-value>)",
          400: "rgb(var(--c-slate-400) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "Consolas", "monospace"],
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fadeIn 0.3s ease-out",
        "slide-up": "slideUp 0.3s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
