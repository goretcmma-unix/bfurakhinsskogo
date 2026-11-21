/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0A0C0C',
        bgGradient: 'radial-gradient(circle at top right, #162322 0%, #0A0C0C 70%)',
        sidebar: '#0F1312',
        card: '#121817',
        cardAlt: '#19201F',
        accent: '#40E0D0',
        accentDeep: '#155E59',
        accentMuted: '#2C8F85',
        text: '#F2F5F4',
        muted: '#8B9693',
        border: '#252D2B',
        borderStrong: '#333E3B'
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(64,224,208,0.12), 0 8px 30px rgba(64,224,208,0.08)',
        card: '0 10px 30px rgba(0,0,0,0.35)'
      },
      borderRadius: {
        xl: '14px',
        '2xl': '18px'
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
}
