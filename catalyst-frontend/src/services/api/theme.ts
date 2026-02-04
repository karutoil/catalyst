import apiClient from './client';

export interface PublicThemeSettings {
  panelName: string;
  logoUrl?: string | null;
  faviconUrl?: string | null;
  defaultTheme: string;
  enabledThemes: string[];
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
}

export interface ThemeSettings extends PublicThemeSettings {
  customCss?: string | null;
  metadata?: any;
}

type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

export const themeApi = {
  getPublicSettings: async () => {
    const { data } = await apiClient.get<ApiResponse<PublicThemeSettings>>(
      '/api/theme-settings/public'
    );
    return data.data!;
  },
};
