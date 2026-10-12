/** Colours come from CSS variables (src/theme.css) so the same utility classes serve the light and dark themes. */
const scale = (name) =>
  Object.fromEntries(
    [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((s) => [
      s,
      `rgb(var(--${name}-${s}) / <alpha-value>)`,
    ]),
  );

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        white: 'rgb(var(--white) / <alpha-value>)',
        slate: scale('slate'),
        sky: scale('sky'),
        red: scale('red'),
        amber: scale('amber'),
        green: scale('green'),
        emerald: scale('emerald'),
        orange: scale('orange'),
      },
    },
  },
  plugins: [],
};
