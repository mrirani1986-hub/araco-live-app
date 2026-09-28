/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 50: '#eef5fc', 100: '#d7e7f7', 200: '#afcfee', 300: '#7aafe1', 400: '#3f86cc', 500: '#1f67ad', 600: '#15528f', 700: '#0f3d68', 800: '#0b2f51', 900: '#08223b' },
      },
      fontFamily: { sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
};
