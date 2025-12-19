/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#0c0c0e',
        surface: {
          DEFAULT: '#121214',
          raised: '#1a1a1d',
          overlay: '#222225',
        },
        border: {
          DEFAULT: '#2a2a2e',
          subtle: '#1e1e21',
          strong: '#3a3a3f',
        },
        text: {
          primary: '#f5f5f4',
          secondary: '#a8a8a3',
          muted: '#6b6b66',
          dim: '#4a4a46',
        },
        brand: {
          primary: '#e5c07b',
          secondary: '#d19a66',
          accent: '#c9a227',
          'primary-hover': '#f0d090',
          'primary-muted': 'rgba(229, 192, 123, 0.12)',
          'secondary-muted': 'rgba(209, 154, 102, 0.12)',
        }
      },
      borderRadius: {
        'premium': '8px',
        'xl': '12px',
        '2xl': '16px',
      },
      boxShadow: {
        'glass': '0 4px 30px rgba(0, 0, 0, 0.1)',
        'premium-sm': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        'premium-md': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        'floating': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
        display: ['Outfit', 'Inter', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'pulse-subtle': 'pulseSubtle 2s infinite ease-in-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        pulseSubtle: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
