import type { LoadedPlugin, PluginManifest, PluginStatus } from './types';
import EventEmitter from 'events';

/**
 * Central registry for all loaded plugins
 */
export class PluginRegistry extends EventEmitter {
  private plugins: Map<string, LoadedPlugin> = new Map();
  
  /**
   * Register a plugin
   */
  register(plugin: LoadedPlugin): void {
    this.plugins.set(plugin.manifest.name, plugin);
    this.emit('plugin:registered', plugin.manifest.name);
  }
  
  /**
   * Unregister a plugin
   */
  unregister(name: string): void {
    this.plugins.delete(name);
    this.emit('plugin:unregistered', name);
  }
  
  /**
   * Get a plugin by name
   */
  get(name: string): LoadedPlugin | undefined {
    return this.plugins.get(name);
  }
  
  /**
   * Get all plugins
   */
  getAll(): LoadedPlugin[] {
    return Array.from(this.plugins.values());
  }
  
  /**
   * Get plugins by status
   */
  getByStatus(status: PluginStatus): LoadedPlugin[] {
    return this.getAll().filter((p) => p.status === status);
  }
  
  /**
   * Check if plugin exists
   */
  has(name: string): boolean {
    return this.plugins.has(name);
  }
  
  /**
   * Update plugin status
   */
  updateStatus(name: string, status: PluginStatus): void {
    const plugin = this.get(name);
    if (plugin) {
      plugin.status = status;
      this.emit('plugin:status-changed', name, status);
    }
  }
  
  /**
   * Get plugin count
   */
  count(): number {
    return this.plugins.size;
  }
  
  /**
   * Get all plugin manifests
   */
  getManifests(): PluginManifest[] {
    return this.getAll().map((p) => p.manifest);
  }
  
  /**
   * Get enabled plugins
   */
  getEnabled(): LoadedPlugin[] {
    return this.getByStatus('enabled' as PluginStatus);
  }
  
  /**
   * Clear all plugins
   */
  clear(): void {
    this.plugins.clear();
    this.emit('plugins:cleared');
  }
}
