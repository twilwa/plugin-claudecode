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

const projectInitSchema = z.object({
  projectName: z.string().describe('Name of the project to initialize'),
  projectType: z.string().describe('Type of project (e.g., react, node, python-flask)'),
  directory: z.string().optional().describe('Directory to create the project in'),
  features: z.array(z.string()).optional().describe('Additional features to include'),
  dependencies: z.array(z.string()).optional().describe('Additional dependencies to install'),
  gitInit: z.boolean().optional().default(true).describe('Initialize git repository'),
});

export const projectInitAction: Action = {
  name: 'PROJECT_INIT',
  similes: ['INIT_PROJECT', 'SCAFFOLD_PROJECT', 'BOOTSTRAP_PROJECT', 'SETUP_PROJECT', 'CREATE_PROJECT'],
  description: 'Initializes new projects with appropriate structure, configuration, and boilerplate code',

  validate: async (runtime: IAgentRuntime, message: Memory, state: State): Promise<boolean> => {
    const text = message.content.text?.toLowerCase() || '';
    
    // Check if the message contains project initialization related keywords
    const initKeywords = ['init', 'initialize', 'create', 'scaffold', 'bootstrap', 'setup', 'start'];
    const projectKeywords = ['project', 'app', 'application', 'repository', 'codebase'];
    
    const containsInitKeyword = initKeywords.some(keyword => text.includes(keyword));
    const containsProjectKeyword = projectKeywords.some(keyword => text.includes(keyword));
    
    // Also check for specific project types
    const projectTypes = ['react', 'vue', 'angular', 'node', 'express', 'django', 'flask', 'rails'];
    const mentionsProjectType = projectTypes.some(type => text.includes(type));
    
    return containsInitKeyword && (containsProjectKeyword || mentionsProjectType);
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
      logger.info('Executing PROJECT_INIT action');
      
      // Get Claude Code service
      const service = runtime.getService(ClaudeCodeService.serviceType) as ClaudeCodeService;
      if (!service) {
        throw new Error('Claude Code service not available');
      }

      // Parse the input
      const text = message.content.text || '';
      const params = await extractProjectInitParams(text);
      
      logger.debug('Project initialization parameters:', params);

      // Construct the initialization prompt
      const initPrompt = constructInitPrompt(params);
      
      // Execute the project initialization
      const messages = await service.executeQuery(initPrompt, {
        maxTurns: 10, // May need more turns for complete setup
        permissionMode: 'acceptEdits', // Allow file creation and modifications
      });
      
      // Extract the result from messages
      let initResult = '';
      let filesCreated: string[] = [];
      let commandsRun: string[] = [];
      
      for (const msg of messages) {
        if (msg.type === 'assistant') {
          initResult += msg.message.content + '\n';
          
          // Extract created files
          const fileMatches = msg.message.content.match(/(?:created?|generated?|wrote)\s+(?:file\s+)?([^\s]+\.[a-zA-Z]+)/gi);
          if (fileMatches) {
            filesCreated.push(...fileMatches.map(match => 
              match.replace(/(?:created?|generated?|wrote)\s+(?:file\s+)?/i, '')
            ));
          }
          
          // Extract commands run
          const cmdMatches = msg.message.content.match(/(?:running|executing|ran)\s+`([^`]+)`/gi);
          if (cmdMatches) {
            commandsRun.push(...cmdMatches.map(match => 
              match.replace(/(?:running|executing|ran)\s+`|`$/gi, '')
            ));
          }
        }
      }
      
      if (!initResult) {
        throw new Error('No result received from Claude Code');
      }

      // Format the response
      const responseContent: Content = {
        text: formatInitResponse(initResult, params, filesCreated, commandsRun),
        actions: ['PROJECT_INIT'],
        source: message.content.source,
        metadata: {
          projectName: params.projectName,
          projectType: params.projectType,
          filesCreated: filesCreated.length,
          directory: params.directory,
          timestamp: new Date().toISOString(),
        },
      };

      await callback(responseContent);
      return responseContent;
    } catch (error) {
      logger.error('Error in PROJECT_INIT action:', error);
      
      const errorContent: Content = {
        text: `I encountered an error while initializing the project: ${error.message}. Please check your requirements and try again.`,
        actions: ['PROJECT_INIT'],
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
          text: 'Initialize a new React project with TypeScript and Tailwind CSS',
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: 'I\'ll initialize a new React project with TypeScript and Tailwind CSS.\n\n🚀 **Project Initialized Successfully!**\n\n**Project:** react-typescript-app\n**Stack:** React + TypeScript + Tailwind CSS\n\n**Created files:**\n- `package.json` - Project configuration\n- `tsconfig.json` - TypeScript configuration\n- `tailwind.config.js` - Tailwind CSS configuration\n- `src/App.tsx` - Main application component\n- `src/index.tsx` - Application entry point\n- `src/index.css` - Global styles with Tailwind directives\n- `public/index.html` - HTML template\n- `.gitignore` - Git ignore patterns\n- `README.md` - Project documentation\n\n**Commands executed:**\n```bash\nnpx create-react-app . --template typescript\nnpm install -D tailwindcss postcss autoprefixer\nnpx tailwindcss init -p\n```\n\n**Next steps:**\n1. Run `npm start` to start the development server\n2. Open http://localhost:3000 to view your app\n3. Start building your components in the `src` directory\n\nThe project is ready for development! 🎉',
          actions: ['PROJECT_INIT'],
        },
      },
    ],
    [
      {
        name: '{{user}}',
        content: {
          text: 'Create a new Express.js API project with MongoDB integration',
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: 'I\'ll create a new Express.js API project with MongoDB integration.\n\n🚀 **Project Initialized Successfully!**\n\n**Project:** express-mongodb-api\n**Stack:** Express.js + MongoDB + Mongoose\n\n**Project structure created:**\n```\nexpress-mongodb-api/\n├── src/\n│   ├── models/\n│   │   └── User.js\n│   ├── routes/\n│   │   ├── auth.js\n│   │   └── users.js\n│   ├── middleware/\n│   │   └── auth.js\n│   ├── config/\n│   │   └── database.js\n│   └── app.js\n├── .env.example\n├── .gitignore\n├── package.json\n└── README.md\n```\n\n**Key features included:**\n- Express server setup with middleware\n- MongoDB connection configuration\n- User model with Mongoose\n- Authentication routes\n- JWT middleware\n- Environment variable configuration\n- Error handling middleware\n\n**Dependencies installed:**\n- express, mongoose, dotenv\n- jsonwebtoken, bcryptjs\n- cors, helmet, compression\n- nodemon (dev dependency)\n\n**To get started:**\n1. Copy `.env.example` to `.env` and add your MongoDB URI\n2. Run `npm run dev` for development\n3. API will be available at http://localhost:5000\n\nYour Express API is ready! 🎉',
          actions: ['PROJECT_INIT'],
        },
      },
    ],
  ],
};

// Helper functions

async function extractProjectInitParams(text: string): Promise<z.infer<typeof projectInitSchema>> {
  const params: any = {};
  
  // Extract project name
  const nameMatch = text.match(/(?:called|named|project)\s+([a-zA-Z0-9_\-]+)/);
  if (nameMatch) {
    params.projectName = nameMatch[1];
  } else {
    // Generate a default name based on project type
    params.projectName = 'my-project';
  }
  
  // Detect project type
  const projectTypes = {
    'react': ['react', 'react app', 'react application'],
    'vue': ['vue', 'vue app', 'vue application'],
    'angular': ['angular', 'angular app'],
    'node': ['node', 'nodejs', 'node.js'],
    'express': ['express', 'express api', 'express server'],
    'django': ['django', 'django app'],
    'flask': ['flask', 'flask api'],
    'rails': ['rails', 'ruby on rails'],
    'next': ['next', 'nextjs', 'next.js'],
    'nuxt': ['nuxt', 'nuxtjs', 'nuxt.js'],
    'gatsby': ['gatsby', 'gatsby site'],
    'svelte': ['svelte', 'sveltekit'],
  };
  
  for (const [type, keywords] of Object.entries(projectTypes)) {
    if (keywords.some(keyword => text.toLowerCase().includes(keyword))) {
      params.projectType = type;
      break;
    }
  }
  
  if (!params.projectType) {
    params.projectType = 'node'; // Default to Node.js
  }
  
  // Extract features
  const features: string[] = [];
  if (text.includes('typescript') || text.includes('ts')) features.push('typescript');
  if (text.includes('tailwind')) features.push('tailwind');
  if (text.includes('sass') || text.includes('scss')) features.push('sass');
  if (text.includes('eslint')) features.push('eslint');
  if (text.includes('prettier')) features.push('prettier');
  if (text.includes('jest') || text.includes('testing')) features.push('jest');
  if (text.includes('docker')) features.push('docker');
  if (text.includes('mongodb') || text.includes('mongo')) features.push('mongodb');
  if (text.includes('postgres') || text.includes('postgresql')) features.push('postgresql');
  if (text.includes('mysql')) features.push('mysql');
  
  if (features.length > 0) {
    params.features = features;
  }
  
  // Extract directory
  const dirMatch = text.match(/(?:in|at|directory|folder)\s+([^\s]+)/);
  if (dirMatch) {
    params.directory = dirMatch[1];
  }
  
  return projectInitSchema.parse(params);
}

function constructInitPrompt(params: z.infer<typeof projectInitSchema>): string {
  const { projectName, projectType, directory, features, dependencies, gitInit } = params;
  
  let prompt = `Initialize a new ${projectType} project named "${projectName}"`;
  
  if (directory) {
    prompt += ` in the directory "${directory}"`;
  }
  
  prompt += '\n\nProject requirements:';
  prompt += `\n- Project type: ${projectType}`;
  prompt += '\n- Include standard project structure and configuration files';
  prompt += '\n- Add appropriate .gitignore file';
  prompt += '\n- Create a comprehensive README.md';
  
  if (features && features.length > 0) {
    prompt += `\n- Include these features: ${features.join(', ')}`;
  }
  
  if (dependencies && dependencies.length > 0) {
    prompt += `\n- Install these additional dependencies: ${dependencies.join(', ')}`;
  }
  
  if (gitInit) {
    prompt += '\n- Initialize a git repository';
  }
  
  prompt += '\n\nPlease create all necessary files and folders, install dependencies, and provide a complete project setup ready for development.';
  
  return prompt;
}

function formatInitResponse(
  result: string, 
  params: z.infer<typeof projectInitSchema>, 
  filesCreated: string[],
  commandsRun: string[]
): string {
  let response = `🚀 **Successfully initialized ${params.projectType} project: ${params.projectName}**\n\n`;
  
  if (filesCreated.length > 0) {
    response += '**Files created:**\n';
    // Deduplicate and sort files
    const uniqueFiles = [...new Set(filesCreated)].sort();
    uniqueFiles.forEach(file => {
      response += `• ${file}\n`;
    });
    response += '\n';
  }
  
  if (commandsRun.length > 0) {
    response += '**Commands executed:**\n';
    commandsRun.forEach(cmd => {
      response += `• \`${cmd}\`\n`;
    });
    response += '\n';
  }
  
  response += '**Project Summary:**\n' + result;
  
  return response;
} 