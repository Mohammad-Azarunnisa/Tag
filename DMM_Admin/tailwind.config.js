/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Tag brand accent — the ramp is anchored on the ACTUAL logo orange
        // #f15d27 (warmer and slightly redder than Tailwind's stock orange).
        brand: {
          50: '#fff6f1', 100: '#ffe9de', 200: '#ffcfb8', 300: '#fdaa85',
          400: '#f78154', 500: '#f15d27', 600: '#de4813', 700: '#b83a0f',
          800: '#933112', 900: '#772b13',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 1px 2px rgba(15,23,42,0.04), 0 2px 8px -4px rgba(15,23,42,0.06)',
        card: '0 1px 2px rgba(15,23,42,0.04), 0 4px 16px -8px rgba(15,23,42,0.08)',
        glow: '0 1px 3px rgba(15,23,42,0.05), 0 8px 24px -12px rgba(15,23,42,0.12)',
      },
      keyframes: {
        'fade-in': { from: { opacity: 0, transform: 'translateY(8px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
      },
      animation: {
        'fade-in': 'fade-in 0.4s ease-out',
      },
    },
  },
  plugins: [],
};
