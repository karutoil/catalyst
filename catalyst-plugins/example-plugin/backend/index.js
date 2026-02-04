/**
 * Example Plugin Backend
 * 
 * This plugin demonstrates all plugin capabilities:
 * - Custom API routes
 * - WebSocket message handlers
 * - Scheduled tasks (cron jobs)
 * - Event listeners
 * - Configuration management
 * - Persistent storage
 */

let context;
let requestCount = 0;

const plugin = {
  /**
   * Called when plugin is loaded (but not yet enabled)
   */
  async onLoad(ctx) {
    context = ctx;
    ctx.logger.info('Example plugin loaded');
    
    // Initialize plugin storage
    const initialized = await ctx.getStorage('initialized');
    if (!initialized) {
      await ctx.setStorage('initialized', true);
      await ctx.setStorage('installDate', new Date().toISOString());
      ctx.logger.info('Plugin initialized for the first time');
    }
    
    // Register routes during load (before Fastify starts)
    // Register custom API route
    ctx.registerRoute({
      method: 'GET',
      url: '/hello',
      handler: async (request, reply) => {
        requestCount++;
        const greeting = ctx.getConfig('greeting') || 'Hello!';
        
        return {
          success: true,
          message: greeting,
          requestCount,
          timestamp: new Date().toISOString(),
        };
      },
    });
    
    // Register another route with POST
    ctx.registerRoute({
      method: 'POST',
      url: '/echo',
      handler: async (request, reply) => {
        const body = request.body;
        
        ctx.logger.info({ body }, 'Echo request received');
        
        return {
          success: true,
          echoed: body,
          timestamp: new Date().toISOString(),
        };
      },
    });
    
    // Register route to get plugin stats
    ctx.registerRoute({
      method: 'GET',
      url: '/stats',
      handler: async (request, reply) => {
        const installDate = await ctx.getStorage('installDate');
        const lastTaskRun = await ctx.getStorage('lastTaskRun');
        const taskRunCount = (await ctx.getStorage('taskRunCount')) || 0;
        
        return {
          success: true,
          stats: {
            requestCount,
            installDate,
            lastTaskRun,
            taskRunCount,
            uptime: process.uptime(),
          },
        };
      },
    });
  },
  
  /**
   * Called when plugin is enabled
   */
  async onEnable(ctx) {
    context = ctx;
    ctx.logger.info('Example plugin enabled');
    
    // Register WebSocket message handler
    ctx.onWebSocketMessage('plugin_example_ping', async (data, clientId) => {
      ctx.logger.info({ data, clientId }, 'Received ping from client');
      
      // Send pong back
      if (clientId) {
        ctx.sendWebSocketMessage(clientId, {
          type: 'plugin_example_pong',
          timestamp: new Date().toISOString(),
          originalData: data,
        });
      }
    });
    
    // Schedule a task (runs every 5 minutes)
    const cronEnabled = ctx.getConfig('cronEnabled');
    if (cronEnabled) {
      ctx.scheduleTask('*/5 * * * *', async () => {
        ctx.logger.info('Example plugin scheduled task executed');
        
        const taskRunCount = (await ctx.getStorage('taskRunCount')) || 0;
        await ctx.setStorage('taskRunCount', taskRunCount + 1);
        await ctx.setStorage('lastTaskRun', new Date().toISOString());
        
        // Emit event that other plugins can listen to
        ctx.emit('example-plugin:task-completed', {
          count: taskRunCount + 1,
          timestamp: new Date().toISOString(),
        });
      });
    }
    
    // Listen to Catalyst events
    ctx.on('server:started', async (data) => {
      ctx.logger.info({ serverId: data.serverId }, 'Server started event received');
      
      // You could send a webhook here, update external systems, etc.
      const webhookUrl = ctx.getConfig('webhookUrl');
      if (webhookUrl) {
        // Send webhook notification
        ctx.logger.info({ webhookUrl }, 'Would send webhook (not implemented)');
      }
    });
    
    ctx.on('server:stopped', async (data) => {
      ctx.logger.info({ serverId: data.serverId }, 'Server stopped event received');
    });
    
    // Register middleware (runs on all plugin routes)
    ctx.registerMiddleware(async (request, reply, next) => {
      const startTime = Date.now();
      
      next();
      
      const duration = Date.now() - startTime;
      ctx.logger.debug({ path: request.url, duration }, 'Request completed');
    });
  },
  
  /**
   * Called when plugin is disabled
   */
  async onDisable(ctx) {
    ctx.logger.info('Example plugin disabled');
    
    // Cleanup resources
    requestCount = 0;
  },
  
  /**
   * Called when plugin is unloaded
   */
  async onUnload(ctx) {
    ctx.logger.info('Example plugin unloaded');
  },
};

export default plugin;
