import {
  type Provider,
  type ProviderResult,
  type IAgentRuntime,
  type Memory,
  type State,
  logger,
} from '@elizaos/core';
import { ClaudeCodeService } from '../services/claude-code';

export const contextProvider: Provider = {
  name: 'CLAUDE_CODE_CONTEXT',
  description: 'Provides code analysis context, session information, and project insights from Claude Code',

  get: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State
  ): Promise<ProviderResult> => {
    try {
      const service = runtime.getService(ClaudeCodeService.serviceType) as ClaudeCodeService;
      if (!service) {
        logger.warn('Claude Code service not available');
        return {
          text: 'Claude Code service is not available',
          values: {},
          data: {},
        };
      }

      // Get active sessions
      const activeSessions = service.getActiveSessions();
      
      // Get service status
      const serviceStatus = await service.getStatus();
      
      // Build context information as a string
      let contextInfo = 'Claude Code Context:\n';
      contextInfo += `- Service Status: ${serviceStatus.apiKeyConfigured ? 'Configured' : 'Not Configured'}\n`;
      contextInfo += `- Active Sessions: ${activeSessions.length}\n`;
      
      if (activeSessions.length > 0) {
        contextInfo += '\nActive Sessions:\n';
        activeSessions.forEach(session => {
          contextInfo += `  - Session ${session.id}: ${session.status}`;
          if (session.workingDirectory) {
            contextInfo += ` (in ${session.workingDirectory})`;
          }
          contextInfo += '\n';
        });
      }
      
      contextInfo += '\nCapabilities: code analysis, file creation/modification, project initialization\n';
      
      // If there's a specific code context request in the message
      const text = message.content.text?.toLowerCase() || '';
      if (text.includes('current project') || text.includes('working directory')) {
        const currentSession = activeSessions[0]; // Get most recent session
        if (currentSession && currentSession.workingDirectory) {
          contextInfo += `\nCurrent Working Directory: ${currentSession.workingDirectory}`;
        }
      }

      // Return the context in the expected format
      return {
        text: contextInfo,
        values: {
          claudeCodeAvailable: true,
          activeSessionCount: activeSessions.length,
          configured: serviceStatus.apiKeyConfigured,
        },
        data: {
          serviceStatus,
          activeSessions: activeSessions.map(session => ({
            id: session.id,
            status: session.status,
            workingDirectory: session.workingDirectory,
            messageCount: session.messages.length,
          })),
        },
      };
    } catch (error) {
      logger.error('Error in Claude Code context provider:', error);
      return {
        text: 'Error retrieving Claude Code context',
        values: {},
        data: {},
      };
    }
  },
};

// Helper function to extract recent activity summary
function getRecentActivity(sessions: any[]): any {
  const recentMessages: any[] = [];
  
  // Get last 5 messages across all sessions
  sessions.forEach(session => {
    if (session.messages && session.messages.length > 0) {
      const lastMessages = session.messages.slice(-3);
      lastMessages.forEach((msg: any) => {
        if (msg.type === 'assistant' && msg.message?.content) {
          recentMessages.push({
            sessionId: session.id,
            type: 'code_operation',
            summary: msg.message.content.substring(0, 100) + '...',
            timestamp: msg.timestamp || new Date().toISOString(),
          });
        }
      });
    }
  });
  
  // Sort by timestamp and return most recent
  return recentMessages
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 5);
} 