import type { FastifyInstance } from 'fastify';
import type { PluginLoader } from '../plugins/loader';
import type { RbacMiddleware } from '../middleware/rbac';
import { z } from 'zod';

const EnablePluginSchema = z.object({
  enabled: z.boolean(),
});

const UpdatePluginConfigSchema = z.object({
  config: z.record(z.any()),
});

/**
 * Plugin management routes
 */
export async function pluginRoutes(app: FastifyInstance, pluginLoader: PluginLoader) {
  const rbac = (app as any).rbac as RbacMiddleware;
  
  /**
   * GET /api/plugins
   * List all plugins
   */
  app.get(
    '/api/plugins',
    {
      onRequest: rbac.checkPermission('admin.read'),
    },
    async (request, reply) => {
      const registry = pluginLoader.getRegistry();
      const plugins = registry.getAll();
      
      const pluginList = plugins.map((p) => ({
        name: p.manifest.name,
        version: p.manifest.version,
        displayName: p.manifest.displayName,
        description: p.manifest.description,
        author: p.manifest.author,
        status: p.status,
        enabled: p.status === 'enabled',
        loadedAt: p.loadedAt,
        enabledAt: p.enabledAt,
        error: p.error?.message,
        permissions: p.manifest.permissions,
        hasBackend: !!p.manifest.backend,
        hasFrontend: !!p.manifest.frontend,
      }));
      
      return {
        success: true,
        data: pluginList,
      };
    }
  );
  
  /**
   * GET /api/plugins/:name
   * Get plugin details
   */
  app.get(
    '/api/plugins/:name',
    {
      onRequest: rbac.checkPermission('admin.read'),
    },
    async (request, reply) => {
      const { name } = request.params as { name: string };
      const registry = pluginLoader.getRegistry();
      const plugin = registry.get(name);
      
      if (!plugin) {
        return reply.status(404).send({
          success: false,
          error: 'Plugin not found',
        });
      }
      
      return {
        success: true,
        data: {
          name: plugin.manifest.name,
          version: plugin.manifest.version,
          displayName: plugin.manifest.displayName,
          description: plugin.manifest.description,
          author: plugin.manifest.author,
          catalystVersion: plugin.manifest.catalystVersion,
          status: plugin.status,
          enabled: plugin.status === 'enabled',
          loadedAt: plugin.loadedAt,
          enabledAt: plugin.enabledAt,
          error: plugin.error?.message,
          permissions: plugin.manifest.permissions,
          config: plugin.manifest.config,
          hasBackend: !!plugin.manifest.backend,
          hasFrontend: !!plugin.manifest.frontend,
          routes: plugin.routes.map((r) => ({ method: r.method, url: r.url })),
          wsHandlers: Array.from(plugin.wsHandlers.keys()),
          tasks: Array.from(plugin.tasks.values()).map((t) => ({ cron: t.cron })),
        },
      };
    }
  );
  
  /**
   * POST /api/plugins/:name/enable
   * Enable or disable a plugin
   */
  app.post(
    '/api/plugins/:name/enable',
    {
      onRequest: rbac.checkPermission('admin.write'),
    },
    async (request, reply) => {
      const { name } = request.params as { name: string };
      const body = EnablePluginSchema.parse(request.body);
      
      try {
        if (body.enabled) {
          await pluginLoader.enablePlugin(name);
        } else {
          await pluginLoader.disablePlugin(name);
        }
        
        return {
          success: true,
          message: `Plugin ${body.enabled ? 'enabled' : 'disabled'} successfully`,
        };
      } catch (error: any) {
        return reply.status(400).send({
          success: false,
          error: error.message,
        });
      }
    }
  );
  
  /**
   * POST /api/plugins/:name/reload
   * Reload a plugin (hot-reload)
   */
  app.post(
    '/api/plugins/:name/reload',
    {
      onRequest: rbac.checkPermission('admin.write'),
    },
    async (request, reply) => {
      const { name } = request.params as { name: string };
      
      try {
        await pluginLoader.reloadPlugin(name);
        
        return {
          success: true,
          message: 'Plugin reloaded successfully',
        };
      } catch (error: any) {
        return reply.status(400).send({
          success: false,
          error: error.message,
        });
      }
    }
  );
  
  /**
   * PUT /api/plugins/:name/config
   * Update plugin configuration
   */
  app.put(
    '/api/plugins/:name/config',
    {
      onRequest: rbac.checkPermission('admin.write'),
    },
    async (request, reply) => {
      const { name } = request.params as { name: string };
      const body = UpdatePluginConfigSchema.parse(request.body);
      
      const registry = pluginLoader.getRegistry();
      const plugin = registry.get(name);
      
      if (!plugin) {
        return reply.status(404).send({
          success: false,
          error: 'Plugin not found',
        });
      }
      
      try {
        // Update each config key
        for (const [key, value] of Object.entries(body.config)) {
          await plugin.context.setConfig(key, value);
        }
        
        return {
          success: true,
          message: 'Plugin configuration updated',
        };
      } catch (error: any) {
        return reply.status(400).send({
          success: false,
          error: error.message,
        });
      }
    }
  );
  
  /**
   * GET /api/plugins/:name/frontend-manifest
   * Get plugin frontend manifest
   */
  app.get('/api/plugins/:name/frontend-manifest', async (request, reply) => {
    const { name } = request.params as { name: string };
    const registry = pluginLoader.getRegistry();
    const plugin = registry.get(name);
    
    if (!plugin) {
      return reply.status(404).send({
        success: false,
        error: 'Plugin not found',
      });
    }
    
    if (!plugin.manifest.frontend) {
      return reply.status(404).send({
        success: false,
        error: 'Plugin has no frontend',
      });
    }
    
    // Read frontend manifest if exists
    // For now, return placeholder
    return {
      success: true,
      data: {
        routes: [],
        tabs: [],
        components: {},
      },
    };
  });
}
