/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ['JetBrains Mono', 'IBM Plex Mono', 'Courier New', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        'rld': {
          bg: '#080808',
          surface: '#0b0b0b',
          card: '#0d0d0d',
          'card-alt': '#111',
          border: '#141414',
          text: '#ffffff',
          secondary: '#999',
          body: '#666',
          label: '#555',
          structural: '#333',
        }
      },
      animation: {
        'blink': 'blink 1.2s step-end infinite',
        'fade-in-up': 'fadeInUp 0.9s ease-out forwards',
      },
      keyframes: {
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
        fadeInUp: {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
