import {
  type Action,
  type Content,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  type State,
  logger,
} from '@elizaos/core';
import { ClaudeCodeService } from '../services/claude-code';
import { z } from 'zod';

const modifyFileSchema = z.object({
  fileName: z.string().describe('Name or path of the file to modify'),
  modification: z.string().describe('Description of the modification to make'),
  preserveStyle: z.boolean().optional().default(true).describe('Whether to preserve existing code style'),
  createBackup: z.boolean().optional().default(false).describe('Whether to create a backup before modifying'),
});

export const modifyFileAction: Action = {
  name: 'MODIFY_FILE',
  similes: ['EDIT_FILE', 'UPDATE_FILE', 'CHANGE_FILE', 'REFACTOR_FILE', 'FIX_FILE'],
  description: 'Modifies existing files by applying changes, fixes, or refactoring using Claude Code',

  validate: async (runtime: IAgentRuntime, message: Memory, state: State): Promise<boolean> => {
    const text = message.content.text?.toLowerCase() || '';
    
    // Check if the message contains modification related keywords
    const modifyKeywords = ['modify', 'edit', 'update', 'change', 'fix', 'refactor', 'improve', 'add', 'remove'];
    const fileKeywords = ['file', 'code', 'script', 'module', 'component', 'class', 'function'];
    
    const containsModifyKeyword = modifyKeywords.some(keyword => text.includes(keyword));
    const containsFileKeyword = fileKeywords.some(keyword => text.includes(keyword));
    
    // Also check for specific file mentions
    const mentionsFile = text.match(/\.[a-zA-Z]+/) !== null; // Has file extension
    
    return containsModifyKeyword && (containsFileKeyword || mentionsFile);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    _options: any,
    callback: HandlerCallback,
    _responses: Memory[]
  ) => {
    try {
      logger.info('Executing MODIFY_FILE action');
      
      // Get Claude Code service
      const service = runtime.getService(ClaudeCodeService.serviceType) as ClaudeCodeService;
      if (!service) {
        throw new Error('Claude Code service not available');
      }

      // Parse the input
      const text = message.content.text || '';
      const params = await extractModifyFileParams(text);
      
      logger.debug('Modify file parameters:', params);

      // Construct the modification prompt
      const modificationPrompt = constructModificationPrompt(params);
      
      // Execute the file modification
      const messages = await service.executeQuery(modificationPrompt, {
        maxTurns: 5,
        permissionMode: 'acceptEdits', // Allow file modifications
      });
      
      // Extract the result from messages
      let modificationResult = '';
      let fileModified = false;
      let changesApplied: string[] = [];
      
      for (const msg of messages) {
        if (msg.type === 'assistant') {
          modificationResult += msg.message.content;
          
          // Check if file was actually modified
          if (msg.message.content.includes('modified') || 
              msg.message.content.includes('updated') || 
              msg.message.content.includes('changed')) {
            fileModified = true;
          }
          
          // Extract changes made
          const changeMatches = msg.message.content.match(/(?:- |• |\d\. )(.+)/g);
          if (changeMatches) {
            changesApplied = changeMatches.map(match => match.replace(/^(?:- |• |\d\. )/, ''));
          }
        }
      }
      
      if (!modificationResult) {
        throw new Error('No result received from Claude Code');
      }

      // Format the response
      const responseContent: Content = {
        text: formatModificationResponse(modificationResult, params, fileModified, changesApplied),
        actions: ['MODIFY_FILE'],
        source: message.content.source,
        metadata: {
          fileName: params.fileName,
          modified: fileModified,
          changesApplied: changesApplied.length,
          timestamp: new Date().toISOString(),
        },
      };

      await callback(responseContent);
      return responseContent;
    } catch (error) {
      logger.error('Error in MODIFY_FILE action:', error);
      
      const errorContent: Content = {
        text: `I encountered an error while modifying the file: ${error.message}. Please ensure the file exists and try again.`,
        actions: ['MODIFY_FILE'],
        source: message.content.source,
      };
      
      await callback(errorContent);
      return errorContent;
    }
  },

  examples: [
    [
      {
        name: '{{user}}',
        content: {
          text: 'Add error handling to the processData function in utils.js',
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: 'I\'ll add error handling to the processData function in utils.js.\n\n✏️ **Modified file: `utils.js`**\n\nChanges applied:\n- Added try-catch block around main processing logic\n- Added input validation for null/undefined data\n- Added specific error messages for different failure scenarios\n- Implemented proper error logging\n- Added graceful fallback for recoverable errors\n\nExample of the changes:\n```javascript\ntry {\n  if (!data || typeof data !== \'object\') {\n    throw new Error(\'Invalid data: expected non-null object\');\n  }\n  // ... existing processing logic\n} catch (error) {\n  console.error(\'Error processing data:\', error.message);\n  // Graceful fallback or re-throw based on error type\n}\n```\n\nThe file has been successfully updated with comprehensive error handling.',
          actions: ['MODIFY_FILE'],
        },
      },
    ],
    [
      {
        name: '{{user}}',
        content: {
          text: 'Refactor the UserService class to use async/await instead of promises',
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: 'I\'ll refactor the UserService class to use async/await syntax.\n\n✏️ **Modified file: `UserService.js`** (or similar)\n\nRefactoring changes:\n- Converted all `.then()` chains to async/await syntax\n- Updated error handling from `.catch()` to try-catch blocks\n- Maintained the same functionality with cleaner syntax\n- Improved readability and error stack traces\n\nExample transformation:\n```javascript\n// Before:\ngetUser(id) {\n  return this.db.query(id)\n    .then(user => this.processUser(user))\n    .then(processed => this.addMetadata(processed))\n    .catch(err => this.handleError(err));\n}\n\n// After:\nasync getUser(id) {\n  try {\n    const user = await this.db.query(id);\n    const processed = await this.processUser(user);\n    return await this.addMetadata(processed);\n  } catch (err) {\n    return this.handleError(err);\n  }\n}\n```\n\nAll promise-based methods have been successfully converted to async/await.',
          actions: ['MODIFY_FILE'],
        },
      },
    ],
  ],
};

// Helper functions

async function extractModifyFileParams(text: string): Promise<z.infer<typeof modifyFileSchema>> {
  const params: any = {};
  
  // Extract file name or path
  const fileMatch = text.match(/(?:file|in|to|of)\s+([a-zA-Z0-9_\-/]+\.[a-zA-Z]+)/);
  if (fileMatch) {
    params.fileName = fileMatch[1];
  } else {
    // Try to find any file extension
    const extensionMatch = text.match(/([a-zA-Z0-9_\-]+\.[a-zA-Z]+)/);
    if (extensionMatch) {
      params.fileName = extensionMatch[1];
    } else {
      // Look for class or module names
      const classMatch = text.match(/(?:class|module|component)\s+([A-Z][a-zA-Z0-9]+)/);
      if (classMatch) {
        params.fileName = classMatch[1];
      } else {
        params.fileName = 'unknown_file';
      }
    }
  }
  
  // The modification is essentially the entire request
  params.modification = text;
  
  // Check for style preservation hints
  if (text.includes('keep style') || text.includes('preserve style') || text.includes('maintain style')) {
    params.preserveStyle = true;
  }
  
  // Check for backup hints
  if (text.includes('backup') || text.includes('save copy')) {
    params.createBackup = true;
  }
  
  return modifyFileSchema.parse(params);
}

function constructModificationPrompt(params: z.infer<typeof modifyFileSchema>): string {
  const { fileName, modification, preserveStyle, createBackup } = params;
  
  let prompt = `Modify the file "${fileName}" with the following changes:\n\n${modification}`;
  
  if (preserveStyle) {
    prompt += '\n\nImportant: Preserve the existing code style, formatting, and conventions used in the file.';
  }
  
  if (createBackup) {
    prompt += '\n\nCreate a backup of the original file before making changes.';
  }
  
  prompt += '\n\nEnsure that:\n';
  prompt += '- The modifications maintain backward compatibility where possible\n';
  prompt += '- All tests continue to pass after the changes\n';
  prompt += '- The code remains readable and well-documented\n';
  prompt += '- Any new functionality includes appropriate error handling';
  
  return prompt;
}

function formatModificationResponse(
  result: string, 
  params: z.infer<typeof modifyFileSchema>, 
  fileModified: boolean,
  changesApplied: string[]
): string {
  let response = '';
  
  if (fileModified) {
    response = `✅ Successfully modified file: **${params.fileName}**\n\n`;
    
    if (changesApplied.length > 0) {
      response += '**Changes applied:**\n';
      changesApplied.forEach(change => {
        response += `• ${change}\n`;
      });
      response += '\n';
    }
    
    response += result;
  } else {
    response = `📝 Modification plan for **${params.fileName}**:\n\n${result}\n\n*Note: The file may need to be manually updated with these changes.*`;
  }
  
  return response;
} 