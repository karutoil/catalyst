import type { FastifyInstance, FastifyRequest, FastifyReply, RouteOptions } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { WebSocketGateway } from '../websocket/gateway';

/**
 * Plugin manifest structure from plugin.json
 */
export interface PluginManifest {
  name: string;
  version: string;
  displayName: string;
  description: string;
  author: string;
  catalystVersion: string;
  permissions: string[];
  backend?: {
    entry: string;
  };
  frontend?: {
    entry: string;
  };
  dependencies?: Record<string, string>;
  config?: Record<string, any>;
}

/**
 * Plugin state in database
 */
export interface PluginState {
  name: string;
  enabled: boolean;
  version: string;
  installedAt: Date;
  enabledAt?: Date;
  config?: Record<string, any>;
}

/**
 * Plugin lifecycle status
 */
export enum PluginStatus {
  UNLOADED = 'unloaded',
  LOADING = 'loading',
  LOADED = 'loaded',
  ENABLED = 'enabled',
  DISABLED = 'disabled',
  ERROR = 'error',
}

/**
 * Route handler type
 */
export type PluginRouteHandler = (
  request: FastifyRequest,
  reply: FastifyReply
) => Promise<any> | any;

/**
 * Middleware handler type
 */
export type PluginMiddlewareHandler = (
  request: FastifyRequest,
  reply: FastifyReply,
  next: () => void
) => Promise<void> | void;

/**
 * WebSocket message handler
 */
export type PluginWebSocketHandler = (data: any, clientId?: string) => Promise<void> | void;

/**
 * Task handler for scheduled tasks
 */
export type PluginTaskHandler = () => Promise<void> | void;

/**
 * Event handler
 */
export type PluginEventHandler = (data: any) => Promise<void> | void;

/**
 * Plugin backend context provided to plugins
 */
export interface PluginBackendContext {
  // Plugin metadata
  manifest: PluginManifest;
  
  // Core services
  db: PrismaClient;
  logger: Logger;
  wsGateway: WebSocketGateway;
  
  // Route registration
  registerRoute(options: RouteOptions): void;
  
  // Middleware registration
  registerMiddleware(handler: PluginMiddlewareHandler): void;
  
  // WebSocket hooks
  onWebSocketMessage(type: string, handler: PluginWebSocketHandler): void;
  sendWebSocketMessage(target: string, message: any): void;
  
  // Task scheduling
  scheduleTask(cron: string, handler: PluginTaskHandler): void;
  
  // Events
  on(event: string, handler: PluginEventHandler): void;
  emit(event: string, data: any): void;
  
  // Configuration
  getConfig<T = any>(key: string): T | undefined;
  setConfig<T = any>(key: string, value: T): Promise<void>;
  
  // Storage (plugin-scoped key-value store)
  getStorage<T = any>(key: string): Promise<T | null>;
  setStorage<T = any>(key: string, value: T): Promise<void>;
  deleteStorage(key: string): Promise<void>;
}

/**
 * Plugin backend entry point
 */
export interface PluginBackend {
  onLoad?(context: PluginBackendContext): Promise<void> | void;
  onEnable?(context: PluginBackendContext): Promise<void> | void;
  onDisable?(context: PluginBackendContext): Promise<void> | void;
  onUnload?(context: PluginBackendContext): Promise<void> | void;
}

/**
 * Loaded plugin instance
 */
export interface LoadedPlugin {
  manifest: PluginManifest;
  status: PluginStatus;
  context: PluginBackendContext;
  backend?: PluginBackend;
  routes: RouteOptions[];
  middlewares: PluginMiddlewareHandler[];
  wsHandlers: Map<string, PluginWebSocketHandler>;
  tasks: Map<string, { cron: string; handler: PluginTaskHandler; job?: any }>;
  eventHandlers: Map<string, Set<PluginEventHandler>>;
  error?: Error;
  loadedAt?: Date;
  enabledAt?: Date;
}

/**
 * Plugin frontend tab configuration
 */
export interface PluginTabConfig {
  id: string;
  label: string;
  icon?: string;
  component: string;
  location: 'admin' | 'server';
  order?: number;
  requiredPermissions?: string[];
}

/**
 * Plugin frontend route configuration
 */
export interface PluginRouteConfig {
  path: string;
  component: string;
  requiredPermissions?: string[];
}

/**
 * Plugin frontend manifest
 */
export interface PluginFrontendManifest {
  routes?: PluginRouteConfig[];
  tabs?: PluginTabConfig[];
  components?: Record<string, string>;
}
