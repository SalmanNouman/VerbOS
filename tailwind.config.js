/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'cyber-black': '#0a0a0a',
        'cyber-gray': '#1a1a1a',
        'cyber-blue': '#00ffff',
        'cyber-green': '#00ff00',
        'cyber-purple': '#ff00ff',
      },
    },
  },
  plugins: [],
}
