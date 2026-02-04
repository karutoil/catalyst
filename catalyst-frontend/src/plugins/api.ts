import axios from 'axios';
import type { PluginManifest } from './types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

/**
 * Fetch all plugins
 */
export async function fetchPlugins(): Promise<PluginManifest[]> {
  const response = await axios.get(`${API_BASE}/api/plugins`, {
    withCredentials: true,
  });
  return response.data.data;
}

/**
 * Fetch plugin details
 */
export async function fetchPluginDetails(name: string): Promise<any> {
  const response = await axios.get(`${API_BASE}/api/plugins/${name}`, {
    withCredentials: true,
  });
  return response.data.data;
}

/**
 * Enable or disable plugin
 */
export async function togglePlugin(name: string, enabled: boolean): Promise<void> {
  await axios.post(
    `${API_BASE}/api/plugins/${name}/enable`,
    { enabled },
    { withCredentials: true }
  );
}

/**
 * Reload plugin
 */
export async function reloadPlugin(name: string): Promise<void> {
  await axios.post(
    `${API_BASE}/api/plugins/${name}/reload`,
    {},
    { withCredentials: true }
  );
}

/**
 * Update plugin config
 */
export async function updatePluginConfig(
  name: string,
  config: Record<string, any>
): Promise<void> {
  await axios.put(
    `${API_BASE}/api/plugins/${name}/config`,
    { config },
    { withCredentials: true }
  );
}

/**
 * Fetch plugin frontend manifest
 */
export async function fetchPluginFrontendManifest(name: string): Promise<any> {
  const response = await axios.get(
    `${API_BASE}/api/plugins/${name}/frontend-manifest`,
    { withCredentials: true }
  );
  return response.data.data;
}
