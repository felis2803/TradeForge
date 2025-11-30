import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#0A0E17',
        surface: '#141B2B',
        surfaceHighlight: '#1E2837',
        primary: '#3B82F6',
        primaryHover: '#2563EB',
        secondary: '#60A5FA',
        accent: '#93C5FD',
        text: '#F1F5F9',
        textMuted: '#94A3B8',
        border: '#334155',
        success: '#10B981',
        error: '#EF4444',
        warning: '#F59E0B',
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out',
        'slide-up': 'slideUp 0.5s ease-out',
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        glow: 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        glow: {
          '0%': { boxShadow: '0 0 5px #7000FF, 0 0 10px #7000FF' },
          '100%': { boxShadow: '0 0 20px #7000FF, 0 0 30px #7000FF' },
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'hero-glow':
          'conic-gradient(from 180deg at 50% 50%, #2a8af6 0deg, #a853ba 180deg, #e92a67 360deg)',
      },
    },
  },
  plugins: [],
};

export default config;
