import type { Plugin } from '@elizaos/core';
import {
  type Action,
  type Content,
  type GenerateTextParams,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  ModelType,
  type Provider,
  type ProviderResult,
  Service,
  type State,
  logger,
} from '@elizaos/core';
import { z } from 'zod';
import { ClaudeCodeService } from './services/claude-code';
import { codeAnalysisAction } from './actions/code-analysis';
import { createFileAction } from './actions/create-file';
import { modifyFileAction } from './actions/modify-file';
import { projectInitAction } from './actions/project-init';
import { contextProvider } from './providers/context-provider';

/**
 * Defines the configuration schema for the Claude Code plugin
 */
const configSchema = z.object({
  ANTHROPIC_API_KEY: z
    .string()
    .min(1, 'Anthropic API key is required for Claude Code SDK')
    .transform((val) => {
      if (!val) {
        throw new Error('ANTHROPIC_API_KEY is required for Claude Code plugin');
      }
      return val;
    }),
  MAX_TURNS: z
    .number()
    .optional()
    .default(10)
    .transform((val) => Math.max(1, Math.min(val, 50))), // Clamp between 1 and 50
  PERMISSION_MODE: z
    .enum(['default', 'acceptEdits', 'bypassPermissions', 'plan'])
    .optional()
    .default('acceptEdits'),
});

/**
 * Example HelloWorld action
 * This demonstrates the simplest possible action structure
 */
/**
 * Action representing a hello world message.
 * @typedef {Object} Action
 * @property {string} name - The name of the action.
 * @property {string[]} similes - An array of related actions.
 * @property {string} description - A brief description of the action.
 * @property {Function} validate - Asynchronous function to validate the action.
 * @property {Function} handler - Asynchronous function to handle the action and generate a response.
 * @property {Object[]} examples - An array of example inputs and expected outputs for the action.
 */
const helloWorldAction: Action = {
  name: 'HELLO_WORLD',
  similes: ['GREET', 'SAY_HELLO'],
  description: 'Responds with a simple hello world message',

  validate: async (_runtime: IAgentRuntime, _message: Memory, _state: State): Promise<boolean> => {
    // Always valid
    return true;
  },

  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: any,
    callback: HandlerCallback,
    _responses: Memory[]
  ) => {
    try {
      logger.info('Handling HELLO_WORLD action');

      // Simple response content
      const responseContent: Content = {
        text: 'hello world!',
        actions: ['HELLO_WORLD'],
        source: message.content.source,
      };

      // Call back with the hello world message
      await callback(responseContent);

      return responseContent;
    } catch (error) {
      logger.error('Error in HELLO_WORLD action:', error);
      throw error;
    }
  },

  examples: [
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Can you say hello?',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'hello world!',
          actions: ['HELLO_WORLD'],
        },
      },
    ],
  ],
};

/**
 * Example Hello World Provider
 * This demonstrates the simplest possible provider implementation
 */
const helloWorldProvider: Provider = {
  name: 'HELLO_WORLD_PROVIDER',
  description: 'A simple example provider',

  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State
  ): Promise<ProviderResult> => {
    return {
      text: 'I am a provider',
      values: {},
      data: {},
    };
  },
};

export class StarterService extends Service {
  static serviceType = 'starter';
  capabilityDescription =
    'This is a starter service which is attached to the agent through the starter plugin.';
  constructor(protected runtime: IAgentRuntime) {
    super(runtime);
  }

  static async start(runtime: IAgentRuntime) {
    logger.info(`*** Starting starter service - MODIFIED: ${new Date().toISOString()} ***`);
    const service = new StarterService(runtime);
    return service;
  }

  static async stop(runtime: IAgentRuntime) {
    logger.info('*** TESTING DEV MODE - STOP MESSAGE CHANGED! ***');
    // get the service from the runtime
    const service = runtime.getService(StarterService.serviceType);
    if (!service) {
      throw new Error('Starter service not found');
    }
    service.stop();
  }

  async stop() {
    logger.info('*** THIRD CHANGE - TESTING FILE WATCHING! ***');
  }
}

/**
 * Claude Code ElizaOS Plugin
 * 
 * This plugin integrates Claude Code SDK capabilities into ElizaOS agents,
 * enabling autonomous code analysis, modification, and project management.
 */
export const claudeCodePlugin: Plugin = {
  name: 'plugin-claudecode',
  description: 'ElizaOS plugin for autonomous codebase modification using Claude Code SDK',
  config: {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    MAX_TURNS: process.env.MAX_TURNS ? parseInt(process.env.MAX_TURNS) : 10,
    PERMISSION_MODE: process.env.PERMISSION_MODE || 'acceptEdits',
  },

  async init(config: Record<string, any>) {
    logger.info('Initializing Claude Code plugin...');
    
    try {
      const validatedConfig = await configSchema.parseAsync(config);

      // Validate Claude Code SDK availability
      try {
        const { query } = await import('@anthropic-ai/claude-code');
        logger.info('Claude Code SDK successfully imported');
      } catch (error) {
        throw new Error('Failed to import Claude Code SDK. Ensure @anthropic-ai/claude-code is installed.');
      }

      // Set environment variables for Claude Code SDK
      process.env.ANTHROPIC_API_KEY = validatedConfig.ANTHROPIC_API_KEY;
      
      // Store config for use by services and actions
      this.config = validatedConfig;
      
      logger.info('Claude Code plugin initialized successfully', {
        maxTurns: validatedConfig.MAX_TURNS,
        permissionMode: validatedConfig.PERMISSION_MODE,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(
          `Invalid Claude Code plugin configuration: ${error.errors.map((e) => e.message).join(', ')}`
        );
      }
      throw error;
    }
  },

  // Services that manage Claude Code sessions
  services: [ClaudeCodeService],

  // Actions for code operations
  actions: [
    codeAnalysisAction,
    createFileAction,
    modifyFileAction,
    projectInitAction,
  ],

  // Providers for context and memory
  providers: [contextProvider],

  // API routes for external integration
  routes: [
    {
      name: 'claude-code-status',
      path: '/claude-code/status',
      type: 'GET',
      handler: async (req: any, res: any) => {
        try {
          const runtime = req.runtime as IAgentRuntime;
          const service = runtime.getService(ClaudeCodeService.serviceType) as ClaudeCodeService;
          
          if (!service) {
            return res.status(503).json({
              status: 'error',
              message: 'Claude Code service not available',
            });
          }

          const status = await service.getStatus();
          res.json({
            status: 'active',
            ...status,
          });
        } catch (error) {
          logger.error('Error getting Claude Code status:', error);
          res.status(500).json({
            status: 'error',
            message: 'Failed to get service status',
          });
        }
      },
    },
    {
      name: 'claude-code-execute',
      path: '/claude-code/execute',
      type: 'POST',
      handler: async (req: any, res: any) => {
        try {
          const runtime = req.runtime as IAgentRuntime;
          const service = runtime.getService(ClaudeCodeService.serviceType) as ClaudeCodeService;
          
          if (!service) {
            return res.status(503).json({
              status: 'error',
              message: 'Claude Code service not available',
            });
          }

          const { prompt, options } = req.body;
          
          if (!prompt) {
            return res.status(400).json({
              status: 'error',
              message: 'Prompt is required',
            });
          }

          const result = await service.executeQuery(prompt, options || {});
          res.json({
            status: 'success',
            result,
          });
        } catch (error) {
          logger.error('Error executing Claude Code query:', error);
          res.status(500).json({
            status: 'error',
            message: 'Failed to execute query',
          });
        }
      },
    },
  ],

  // Event handlers for plugin lifecycle
  events: {
    MESSAGE_RECEIVED: [
      async (params) => {
        logger.debug('Claude Code plugin: MESSAGE_RECEIVED event', {
          userId: params.userId,
          roomId: params.roomId,
        });
      },
    ],
  },
};

export default claudeCodePlugin;
