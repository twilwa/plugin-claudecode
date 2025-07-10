import { Service, type IAgentRuntime, logger } from '@elizaos/core';
import { query, type SDKMessage } from '@anthropic-ai/claude-code';

export interface ClaudeCodeSession {
  id: string;
  startedAt: Date;
  lastActivityAt: Date;
  messages: SDKMessage[];
  abortController: AbortController;
  status: 'idle' | 'running' | 'completed' | 'error';
  workingDirectory?: string;
}

export interface QueryOptions {
  sessionId?: string;
  workingDirectory?: string;
  maxTurns?: number;
  systemPrompt?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
  outputFormat?: 'text' | 'json' | 'stream-json';
  verbose?: boolean;
}

/**
 * Service that manages Claude Code SDK integration
 * Handles session management, code execution, and result tracking
 */
export class ClaudeCodeService extends Service {
  static serviceType = 'claude-code';
  
  private sessions: Map<string, ClaudeCodeSession> = new Map();
  private defaultOptions: QueryOptions;
  
  capabilityDescription = 'Manages Claude Code SDK sessions for autonomous code analysis and modification';

  constructor(protected runtime: IAgentRuntime) {
    super(runtime);
    
    // Set default options from plugin config
    const config = runtime.getSetting('CLAUDE_CODE_CONFIG') || {};
    this.defaultOptions = {
      maxTurns: config.MAX_TURNS || 10,
      permissionMode: config.PERMISSION_MODE || 'acceptEdits',
    };
  }

  static async start(runtime: IAgentRuntime) {
    logger.info('Starting Claude Code service...');
    const service = new ClaudeCodeService(runtime);
    
    // Validate API key
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY environment variable is not set');
    }
    
    logger.info('Claude Code service started successfully');
    return service;
  }

  static async stop(runtime: IAgentRuntime) {
    logger.info('Stopping Claude Code service...');
    const service = runtime.getService(ClaudeCodeService.serviceType) as ClaudeCodeService;
    if (!service) {
      throw new Error('Claude Code service not found');
    }
    await service.stop();
  }

  async stop() {
    logger.info('Cleaning up Claude Code sessions...');
    
    // Abort all active sessions
    for (const [sessionId, session] of this.sessions) {
      if (session.status === 'running') {
        logger.info(`Aborting session ${sessionId}`);
        session.abortController.abort();
      }
    }
    
    this.sessions.clear();
    logger.info('Claude Code service stopped');
  }

  /**
   * Execute a Claude Code query with optional session management
   */
  async executeQuery(prompt: string, options: QueryOptions = {}): Promise<SDKMessage[]> {
    const sessionId = options.sessionId || this.generateSessionId();
    let session = this.sessions.get(sessionId);
    
    // Create new session if it doesn't exist
    if (!session) {
      session = this.createSession(sessionId, options.workingDirectory);
      this.sessions.set(sessionId, session);
    }
    
    // Update session status
    session.status = 'running';
    session.lastActivityAt = new Date();
    
    const messages: SDKMessage[] = [];
    
    try {
      // Merge options with defaults
      const queryOptions = {
        ...this.defaultOptions,
        ...options,
        abortController: session.abortController,
        cwd: session.workingDirectory,
      };
      
      logger.info(`Executing Claude Code query in session ${sessionId}`, {
        prompt: prompt.substring(0, 100) + '...',
        options: queryOptions,
      });
      
      // Execute the query
      // Note: The actual options structure may vary - check @anthropic-ai/claude-code documentation
      for await (const message of query({ 
        prompt, 
        abortController: queryOptions.abortController,
        options: {
          maxTurns: queryOptions.maxTurns || 10,
        },
      })) {
        messages.push(message);
        session.messages.push(message);
        
        // Log assistant messages
        if (message.type === 'assistant') {
          logger.debug('Claude Code response:', message.message);
        }
      }
      
      session.status = 'completed';
      logger.info(`Query completed successfully in session ${sessionId}`, {
        messageCount: messages.length,
      });
      
      return messages;
    } catch (error) {
      session.status = 'error';
      logger.error(`Error executing Claude Code query in session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Get or create a session for continuous conversation
   */
  getSession(sessionId: string): ClaudeCodeSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Create a new session
   */
  createSession(sessionId?: string, workingDirectory?: string): ClaudeCodeSession {
    const id = sessionId || this.generateSessionId();
    const session: ClaudeCodeSession = {
      id,
      startedAt: new Date(),
      lastActivityAt: new Date(),
      messages: [],
      abortController: new AbortController(),
      status: 'idle',
      workingDirectory,
    };
    
    this.sessions.set(id, session);
    logger.info(`Created new Claude Code session ${id}`);
    
    return session;
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): ClaudeCodeSession[] {
    return Array.from(this.sessions.values()).filter(
      session => session.status === 'running' || session.status === 'idle'
    );
  }

  /**
   * Clean up old sessions
   */
  cleanupSessions(maxAge: number = 3600000) { // 1 hour default
    const now = Date.now();
    const sessionsToRemove: string[] = [];
    
    for (const [id, session] of this.sessions) {
      const age = now - session.lastActivityAt.getTime();
      if (age > maxAge && session.status !== 'running') {
        sessionsToRemove.push(id);
      }
    }
    
    for (const id of sessionsToRemove) {
      this.sessions.delete(id);
      logger.debug(`Cleaned up old session ${id}`);
    }
    
    if (sessionsToRemove.length > 0) {
      logger.info(`Cleaned up ${sessionsToRemove.length} old sessions`);
    }
  }

  /**
   * Get service status
   */
  async getStatus() {
    const sessions = Array.from(this.sessions.values());
    return {
      totalSessions: sessions.length,
      activeSessions: sessions.filter(s => s.status === 'running').length,
      idleSessions: sessions.filter(s => s.status === 'idle').length,
      completedSessions: sessions.filter(s => s.status === 'completed').length,
      errorSessions: sessions.filter(s => s.status === 'error').length,
      apiKeyConfigured: !!process.env.ANTHROPIC_API_KEY,
    };
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    return `claude-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
} 