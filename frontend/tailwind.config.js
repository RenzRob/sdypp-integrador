/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      colors: {
        bg: '#070708',
        surface: '#121214',
        'surface-2': '#18181b',
        accent: '#6c63ff',
        text: '#f4f4f5',
        'text-muted': '#a1a1aa',
        success: '#22c55e',
        error: '#ef4444',
        warning: '#f59e0b',
        border: 'rgba(255, 255, 255, 0.06)',
      },
    },
  },
  plugins: [],
}
