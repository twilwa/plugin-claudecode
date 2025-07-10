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

const codeAnalysisSchema = z.object({
  filePath: z.string().optional().describe('Path to the file or directory to analyze'),
  codeSnippet: z.string().optional().describe('Code snippet to analyze directly'),
  analysisType: z
    .enum(['structure', 'quality', 'security', 'performance', 'general'])
    .optional()
    .default('general')
    .describe('Type of analysis to perform'),
  depth: z
    .enum(['summary', 'detailed', 'comprehensive'])
    .optional()
    .default('detailed')
    .describe('Depth of analysis'),
});

export const codeAnalysisAction: Action = {
  name: 'CODE_ANALYSIS',
  similes: ['ANALYZE_CODE', 'CODE_REVIEW', 'INSPECT_CODE', 'REVIEW_CODE'],
  description: 'Analyzes code structure, quality, and provides improvement suggestions using Claude Code',

  validate: async (runtime: IAgentRuntime, message: Memory, state: State): Promise<boolean> => {
    const text = message.content.text?.toLowerCase() || '';
    
    // Check if the message contains code analysis related keywords
    const analysisKeywords = [
      'analyze',
      'review',
      'inspect',
      'check',
      'examine',
      'evaluate',
      'assess',
      'code quality',
      'code structure',
      'improve',
      'suggestions',
    ];
    
    const containsKeyword = analysisKeywords.some(keyword => text.includes(keyword));
    const mentionsCode = text.includes('code') || text.includes('script') || text.includes('function');
    
    return containsKeyword && mentionsCode;
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
      logger.info('Executing CODE_ANALYSIS action');
      
      // Get Claude Code service
      const service = runtime.getService(ClaudeCodeService.serviceType) as ClaudeCodeService;
      if (!service) {
        throw new Error('Claude Code service not available');
      }

      // Parse the input
      const text = message.content.text || '';
      const params = await extractAnalysisParams(text);
      
      logger.debug('Analysis parameters:', params);

      // Construct the analysis prompt
      const analysisPrompt = constructAnalysisPrompt(params);
      
      // Execute the analysis
      const messages = await service.executeQuery(analysisPrompt, {
        maxTurns: 5,
      });
      
      // Extract the result from messages
      let analysisResult = '';
      for (const msg of messages) {
        if (msg.type === 'assistant') {
          analysisResult += msg.message.content;
        }
      }
      
      if (!analysisResult) {
        throw new Error('No analysis result received from Claude Code');
      }

      // Format the response
      const responseContent: Content = {
        text: formatAnalysisResponse(analysisResult, params),
        actions: ['CODE_ANALYSIS'],
        source: message.content.source,
        metadata: {
          analysisType: params.analysisType,
          depth: params.depth,
          timestamp: new Date().toISOString(),
        },
      };

      await callback(responseContent);
      return responseContent;
    } catch (error) {
      logger.error('Error in CODE_ANALYSIS action:', error);
      
      const errorContent: Content = {
        text: `I encountered an error while analyzing the code: ${error.message}. Please ensure the code or file path is valid and try again.`,
        actions: ['CODE_ANALYSIS'],
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
          text: 'Can you analyze this Python function and suggest improvements?\n```python\ndef calculate_sum(numbers):\n    total = 0\n    for i in range(len(numbers)):\n        total = total + numbers[i]\n    return total\n```',
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: 'I\'ll analyze your Python function and provide suggestions for improvement.\n\n**Code Analysis Results:**\n\n📊 **Structure**: The function follows a basic iterative pattern but can be optimized.\n\n🔍 **Quality Issues:**\n1. Using index-based iteration instead of direct iteration\n2. Can leverage Python\'s built-in functions\n\n✅ **Improvements:**\n```python\ndef calculate_sum(numbers):\n    return sum(numbers)\n```\n\nOr if you need custom logic:\n```python\ndef calculate_sum(numbers):\n    total = 0\n    for number in numbers:\n        total += number\n    return total\n```\n\n**Benefits:**\n- More Pythonic and readable\n- Better performance with built-in `sum()`\n- Direct iteration is cleaner than index-based',
          actions: ['CODE_ANALYSIS'],
        },
      },
    ],
    [
      {
        name: '{{user}}',
        content: {
          text: 'Please review the security of my login function',
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: 'I\'d be happy to review the security of your login function. However, I need to see the actual code to provide a meaningful security analysis. Could you please share the login function code? I\'ll examine it for common security vulnerabilities such as:\n\n- SQL injection risks\n- Password handling and storage\n- Input validation\n- Session management\n- Error handling that might leak information\n- Rate limiting and brute force protection\n\nPlease paste your code and I\'ll provide a detailed security review.',
          actions: ['CODE_ANALYSIS'],
        },
      },
    ],
  ],
};

// Helper functions

async function extractAnalysisParams(text: string): Promise<z.infer<typeof codeAnalysisSchema>> {
  // Simple extraction logic - can be enhanced with more sophisticated parsing
  const params: any = {};
  
  // Check if there's a code block in the text
  const codeBlockMatch = text.match(/```[\s\S]*?```/);
  if (codeBlockMatch) {
    params.codeSnippet = codeBlockMatch[0].replace(/```\w*\n?/g, '').trim();
  }
  
  // Detect analysis type from keywords
  if (text.includes('security')) params.analysisType = 'security';
  else if (text.includes('performance')) params.analysisType = 'performance';
  else if (text.includes('structure')) params.analysisType = 'structure';
  else if (text.includes('quality')) params.analysisType = 'quality';
  
  // Detect depth
  if (text.includes('comprehensive') || text.includes('detailed')) params.depth = 'comprehensive';
  else if (text.includes('summary') || text.includes('brief')) params.depth = 'summary';
  
  return codeAnalysisSchema.parse(params);
}

function constructAnalysisPrompt(params: z.infer<typeof codeAnalysisSchema>): string {
  const { filePath, codeSnippet, analysisType, depth } = params;
  
  let prompt = `Please perform a ${depth} ${analysisType} analysis`;
  
  if (filePath) {
    prompt += ` of the file at ${filePath}`;
  } else if (codeSnippet) {
    prompt += ` of the following code:\n\n${codeSnippet}`;
  } else {
    prompt += ' of the codebase in the current directory';
  }
  
  prompt += '\n\nProvide insights on:';
  
  switch (analysisType) {
    case 'structure':
      prompt += '\n- Code organization and architecture\n- Module dependencies\n- Design patterns used\n- Suggestions for better structure';
      break;
    case 'quality':
      prompt += '\n- Code readability and maintainability\n- Best practices adherence\n- Code smells and anti-patterns\n- Refactoring opportunities';
      break;
    case 'security':
      prompt += '\n- Security vulnerabilities\n- Input validation issues\n- Authentication/authorization problems\n- Data exposure risks\n- Recommended security fixes';
      break;
    case 'performance':
      prompt += '\n- Performance bottlenecks\n- Algorithmic complexity\n- Memory usage patterns\n- Optimization opportunities';
      break;
    default:
      prompt += '\n- Overall code quality\n- Potential issues or bugs\n- Best practice violations\n- Improvement suggestions';
  }
  
  if (depth === 'comprehensive') {
    prompt += '\n\nPlease provide detailed explanations, code examples, and specific recommendations.';
  } else if (depth === 'summary') {
    prompt += '\n\nPlease provide a concise summary of the main findings.';
  }
  
  return prompt;
}

function formatAnalysisResponse(result: string, params: z.infer<typeof codeAnalysisSchema>): string {
  const header = `## Code Analysis Report\n\n**Analysis Type:** ${params.analysisType}\n**Depth:** ${params.depth}\n\n`;
  return header + result;
} 