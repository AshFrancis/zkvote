/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "!./src/contracts/**/node_modules/**",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
