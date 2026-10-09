import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        border: '#e2e8f0', // slate-200 (1px standard border)
        background: '#f8fafc', // slate-50 (page canvas)
        surface: '#ffffff', // white (card & table background)

        // Slate scale
        slate: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
          950: '#020617',
        },

        // Sole Accent: Royal Blue
        accent: {
          DEFAULT: '#2563eb', // blue-600
          hover: '#1d4ed8', // blue-700
          subtle: '#eff6ff', // blue-50 (active nav tint)
        },

        // Feedback colors
        danger: {
          DEFAULT: '#dc2626', // red-600
          hover: '#b91c1c', // red-700
          subtle: '#fef2f2', // red-50
          border: '#fecaca', // red-200
        },
        success: {
          DEFAULT: '#16a34a', // green-600
          subtle: '#f0fdf4', // green-50
          border: '#bbf7d0', // green-200
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        sans: ['"DM Sans"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '4px',
        sm: '3px',
        md: '4px',
        lg: '6px',
      },
      fontSize: {
        xs: ['0.75rem', { lineHeight: '1rem' }], // 12px
        sm: ['0.875rem', { lineHeight: '1.25rem' }], // 14px (admin base)
        base: ['1rem', { lineHeight: '1.5rem' }], // 16px
        lg: ['1.125rem', { lineHeight: '1.75rem' }], // 18px
        xl: ['1.25rem', { lineHeight: '1.75rem' }], // 20px
        '2xl': ['1.5rem', { lineHeight: '2rem' }], // 24px
      },
    },
  },
  plugins: [],
} satisfies Config;
