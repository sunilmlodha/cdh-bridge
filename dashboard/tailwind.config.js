/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Default theme
        'pega-blue':  '#0063AB',
        'pega-dark':  '#003A61',
        'pega-light': '#E8F3FB',

        // DCS Editorial dot palette
        'dcs-red':    '#C0392B',
        'dcs-amber':  '#D4872A',
        'dcs-green':  '#4A7C59',
        'dcs-blue':   '#3D6B8E',
        'dcs-cream':  '#FAF9F7',
        'dcs-warm':   '#FBF9F5',
        'dcs-ink':    '#1B1B1A',
        'dcs-border': '#E5E2DA',
        'dcs-muted':  '#6B6860',
      },
      fontFamily: {
        sans:       ['Hanken Grotesk', 'Inter', 'system-ui', 'sans-serif'],
        editorial:  ['Newsreader', 'Georgia', 'serif'],
        body:       ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        'editorial': '8px',
      },
      // CSS var-driven tokens (used via var() in components)
      backgroundColor: {
        theme:      'var(--bg)',
        card:       'var(--bg-card)',
        sidebar:    'var(--bg-sidebar)',
      },
      textColor: {
        theme:      'var(--text)',
        muted:      'var(--text-muted)',
      },
      borderColor: {
        theme:      'var(--border)',
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
};
