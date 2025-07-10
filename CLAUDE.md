# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

### Build and Development
```bash
# Start development with hot-reloading (recommended)
elizaos dev

# Build the plugin
npm run build

# Start without hot-reloading (requires rebuild after changes)
elizaos start
```

### Testing
```bash
# Run all tests (component + e2e)
npm test

# Run component tests only
npm run test:component

# Run e2e tests only  
npm run test:e2e

# Run a single test file
npx vitest run __tests__/plugin.test.ts
```

### Code Formatting
```bash
# Format code
npm run format

# Check formatting without changing files
npm run format:check

# Lint code (also formats)
npm run lint
```

### Publishing
```bash
# Test publishing requirements
elizaos publish --test

# Publish to npm + GitHub + registry (initial only)
elizaos publish

# Update version (after initial publish)
npm version patch/minor/major
npm publish
```

## Architecture Overview

This is an ElizaOS plugin following the official plugin architecture. The plugin exports a single default export that implements the `Plugin` interface from `@elizaos/core`.

### Key Components

1. **Plugin Entry Point** (`src/index.ts`)
   - Exports `starterPlugin` as the main plugin object
   - Defines configuration schema using Zod validation
   - Registers actions, providers, services, models, routes, and event handlers

2. **Services** 
   - `StarterService` extends the base `Service` class
   - Services are long-running background processes attached to the agent
   - Implement `start()` and `stop()` lifecycle methods

3. **Actions**
   - Actions define commands the agent can execute
   - Must implement `validate()` and `handler()` methods
   - Include examples for training/documentation

4. **Providers**
   - Providers supply contextual data to the agent
   - Implement a `get()` method returning `ProviderResult`

5. **Models**
   - Plugin can override text generation models
   - Supports `TEXT_SMALL` and `TEXT_LARGE` model types

6. **Routes**
   - HTTP endpoints exposed by the plugin
   - Define path, method, and handler function

7. **Events**
   - Subscribe to ElizaOS events like `MESSAGE_RECEIVED`, `VOICE_MESSAGE_RECEIVED`
   - Event handlers receive params with event-specific data

### Testing Structure

- **Component Tests** (`__tests__/`): Unit and integration tests using Vitest
- **E2E Tests** (`e2e/`): Full runtime tests implementing `TestSuite` interface
- Mock utilities provided in `__tests__/test-utils.ts`

### Build Configuration

- Uses `tsup` for building with ESM output
- TypeScript compilation configured in `tsconfig.build.json`
- External dependencies: `@elizaos/core`, `zod`, Node.js built-ins
- Outputs to `dist/` with source maps and type definitions