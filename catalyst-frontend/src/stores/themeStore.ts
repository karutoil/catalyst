import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PublicThemeSettings } from '../services/api/theme';

type Theme = 'light' | 'dark';

interface ThemeState {
  // Local UI state
  theme: Theme;
  sidebarCollapsed: boolean;

  // Server-side theme settings (from API)
  themeSettings: PublicThemeSettings | null;

  // Custom CSS element
  customCssElement: HTMLStyleElement | null;

  // Actions
  setTheme: (theme: Theme) => void;
  toggleSidebar: () => void;
  setThemeSettings: (settings: PublicThemeSettings, customCss?: string | null) => void;
  applyTheme: () => void;
  injectCustomCss: (css: string | null) => void;
}

const defaultThemeSettings: PublicThemeSettings = {
  panelName: 'Catalyst',
  logoUrl: null,
  faviconUrl: null,
  defaultTheme: 'dark',
  enabledThemes: ['light', 'dark'],
  primaryColor: '#3b82f6',
  secondaryColor: '#8b5cf6',
  accentColor: '#06b6d4',
};

// Convert hex to HSL for Tailwind
function hexToHSL(hex: string): string {
  // Remove # if present
  hex = hex.replace('#', '');

  // Convert to RGB
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  h = Math.round(h * 360);
  s = Math.round(s * 100);
  const lPercent = Math.round(l * 100);

  return `${h} ${s}% ${lPercent}%`;
}

// Generate color scale from base HSL
function generateColorScale(baseHSL: string): Record<string, string> {
  const [h, s, l] = baseHSL.split(' ');
  const hue = parseInt(h);
  const sat = parseInt(s);
  const baseLightness = parseInt(l);

  return {
    '50': `${hue} ${Math.min(sat + 10, 100)}% 95%`,
    '100': `${hue} ${Math.min(sat + 10, 100)}% 90%`,
    '200': `${hue} ${Math.min(sat + 5, 100)}% 80%`,
    '300': `${hue} ${sat}% 70%`,
    '400': `${hue} ${sat}% 60%`,
    '500': baseHSL, // The base color
    '600': `${hue} ${sat}% ${Math.max(baseLightness - 10, 20)}%`,
    '700': `${hue} ${Math.min(sat + 5, 100)}% ${Math.max(baseLightness - 20, 15)}%`,
    '800': `${hue} ${Math.min(sat + 10, 100)}% ${Math.max(baseLightness - 30, 10)}%`,
    '900': `${hue} ${Math.min(sat + 15, 100)}% ${Math.max(baseLightness - 40, 5)}%`,
  };
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      sidebarCollapsed: false,
      themeSettings: null,
      customCssElement: null,

      setTheme: (theme) => {
        set({ theme });
        get().applyTheme();
      },

      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

      setThemeSettings: (settings, customCss) => {
        set({ themeSettings: settings });
        // Apply theme immediately when settings are loaded
        get().applyTheme();
        // Inject custom CSS if provided
        if (customCss !== undefined) {
          get().injectCustomCss(customCss);
        }
      },

      injectCustomCss: (css) => {
        const { customCssElement } = get();

        // Remove existing custom CSS element
        if (customCssElement && customCssElement.parentNode) {
          customCssElement.parentNode.removeChild(customCssElement);
        }

        // Inject new custom CSS if provided
        if (css && css.trim()) {
          const style = document.createElement('style');
          style.id = 'catalyst-custom-css';
          style.textContent = css;
          document.head.appendChild(style);
          set({ customCssElement: style });
        } else {
          set({ customCssElement: null });
        }
      },

      applyTheme: () => {
        const { theme, themeSettings } = get();
        const settings = themeSettings || defaultThemeSettings;

        // Apply theme class to root element
        const root = document.documentElement;
        root.classList.remove('light', 'dark');
        root.classList.add(theme);

        // Convert hex colors to HSL for Tailwind CSS variables
        const primaryHSL = hexToHSL(settings.primaryColor);
        const accentHSL = hexToHSL(settings.accentColor);

        // Generate full color scale for primary color
        const primaryScale = generateColorScale(primaryHSL);

        // Apply primary color and all its shades
        root.style.setProperty('--primary', primaryHSL);
        Object.entries(primaryScale).forEach(([shade, value]) => {
          root.style.setProperty(`--primary-${shade}`, value);
        });

        // Update primary foreground based on theme
        root.style.setProperty('--primary-foreground', theme === 'dark' ? '220 30% 12%' : '220 18% 15%');

        // Set accent colors
        root.style.setProperty('--accent', accentHSL);

        // Also set ring color to match primary
        root.style.setProperty('--ring', primaryHSL);

        // Update document title
        document.title = settings.panelName;

        // Update favicon if provided
        if (settings.faviconUrl) {
          let favicon = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
          if (!favicon) {
            favicon = document.createElement('link');
            favicon.rel = 'icon';
            document.head.appendChild(favicon);
          }
          favicon.href = settings.faviconUrl;
        }
      },
    }),
    {
      name: 'catalyst-theme',
      partialize: (state) => ({ theme: state.theme, sidebarCollapsed: state.sidebarCollapsed }),
    }
  )
);
