/**
 * Plugin manifest from backend
 */
export interface PluginManifest {
  name: string;
  version: string;
  displayName: string;
  description: string;
  author: string;
  status: string;
  enabled: boolean;
  loadedAt?: string;
  enabledAt?: string;
  error?: string;
  permissions: string[];
  hasBackend: boolean;
  hasFrontend: boolean;
}

/**
 * Plugin tab configuration
 */
export interface PluginTabConfig {
  id: string;
  label: string;
  icon?: string;
  component: React.ComponentType<any>;
  location: 'admin' | 'server';
  order?: number;
  requiredPermissions?: string[];
}

/**
 * Plugin route configuration
 */
export interface PluginRouteConfig {
  path: string;
  component: React.ComponentType<any>;
  requiredPermissions?: string[];
}

/**
 * Plugin component slot
 */
export interface PluginComponentSlot {
  slot: string;
  component: React.ComponentType<any>;
  order?: number;
}

/**
 * Loaded plugin state
 */
export interface LoadedPlugin {
  manifest: PluginManifest;
  routes: PluginRouteConfig[];
  tabs: PluginTabConfig[];
  components: PluginComponentSlot[];
  module?: any;
}
