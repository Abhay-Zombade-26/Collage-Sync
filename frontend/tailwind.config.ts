import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        /* ── Dynamic Design System Colors ── */
        border: 'var(--color-border, rgba(51, 65, 85, 0.4))',
        background: 'var(--color-bg, #030712)',
        surface: 'var(--color-surface, rgba(15, 23, 42, 0.60))',
        'surface-subtle': 'var(--color-surface-subtle, rgba(30, 41, 59, 0.40))',

        // Slate scale (unchanged, used for text and subtle elements)
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

        // Primary Energy: Electric Royal Blue
        accent: {
          DEFAULT: '#2563eb',   // blue-600
          hover: '#3b82f6',     // blue-500 (brighter on hover in dark)
          subtle: 'rgba(37, 99, 235, 0.12)', // blue glow subtle
        },

        // Feedback colors (dark-adapted)
        danger: {
          DEFAULT: '#f43f5e',   // rose-500 (neon rose)
          hover: '#e11d48',     // rose-600
          subtle: 'rgba(244, 63, 94, 0.12)',
          border: 'rgba(244, 63, 94, 0.3)',
        },
        success: {
          DEFAULT: '#10b981',   // emerald-500
          subtle: 'rgba(16, 185, 129, 0.12)',
          border: 'rgba(16, 185, 129, 0.3)',
        },
        warning: {
          DEFAULT: '#f59e0b',
          subtle: 'rgba(245, 158, 11, 0.12)',
        },
        cyan: {
          DEFAULT: '#06b6d4',
          glow: '#38bdf8',
        },
      },
      fontFamily: {
        display: ['"Plus Jakarta Sans"', 'sans-serif'],
        sans: ['"Plus Jakarta Sans"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '8px',
        sm: '6px',
        md: '8px',
        lg: '12px',
        xl: '16px',
        '2xl': '20px',
      },
      fontSize: {
        xs: ['0.75rem', { lineHeight: '1rem' }],
        sm: ['0.875rem', { lineHeight: '1.25rem' }],
        base: ['1rem', { lineHeight: '1.5rem' }],
        lg: ['1.125rem', { lineHeight: '1.75rem' }],
        xl: ['1.25rem', { lineHeight: '1.75rem' }],
        '2xl': ['1.5rem', { lineHeight: '2rem' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
      },
      boxShadow: {
        glow: '0 0 20px rgba(59, 130, 246, 0.35)',
        'glow-sm': '0 0 12px rgba(59, 130, 246, 0.25)',
        'glow-rose': '0 0 16px rgba(244, 63, 94, 0.3)',
        'glow-emerald': '0 0 12px rgba(16, 185, 129, 0.25)',
        glass: '0 8px 32px rgba(0, 0, 0, 0.4)',
        'glass-lg': '0 16px 48px rgba(0, 0, 0, 0.5)',
      },
      backdropBlur: {
        '2xl': '40px',
        '3xl': '64px',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'shimmer': 'shimmer 2s ease-in-out infinite',
        'spring-in': 'springReveal 0.7s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'glow-pulse': 'glowPulse 2s ease-in-out infinite',
      },
      keyframes: {
        shimmer: {
          '0%, 100%': { opacity: '0.5' },
          '50%': { opacity: '1' },
        },
        glowPulse: {
          '0%, 100%': { boxShadow: '0 0 12px rgba(59, 130, 246, 0.3)' },
          '50%': { boxShadow: '0 0 24px rgba(59, 130, 246, 0.6)' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
