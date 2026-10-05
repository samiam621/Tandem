/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: Object.fromEntries([
        'canvas', 'sidebar', 'raised', 'hover', 'selected', 'line', 'control',
        'primary', 'secondary', 'muted', 'action', 'action-ink', 'accent',
        'success', 'warning', 'danger',
      ].map((name) => [name, `rgb(var(--color-${name}) / <alpha-value>)`])),
      fontFamily: {
        sans: ['var(--font-ui)'],
        prose: ['var(--font-prose)'],
        mono: ['var(--font-code)'],
      },
      fontSize: {
        ui: ['13px', '20px'],
        message: ['15px', '24px'],
        prose: ['16px', '26px'],
      },
    },
  },
  plugins: [],
}
