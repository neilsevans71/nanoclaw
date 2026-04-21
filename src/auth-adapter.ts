/**
 * Auth adapter — switches between API Key and Claude CLI
 * based on NANOCLAW_AUTH_METHOD in .env
 *
 * Exported config is used by:
 * - credential-proxy.ts (injects credentials into proxy)
 * - container-runner.ts (configures container env)
 * - index.ts (startup health check logging)
 */

import { execSync } from 'child_process';
import { readEnvFile } from './env.js';

export interface AuthConfig {
  method: 'api-key' | 'claude-cli';
  apiKey?: string;
  backend?: string;
  description: string;
  cliVersion?: string;
  healthCheck: () => boolean;
}

// Read auth method from .env file (not from process.env, which isn't auto-populated)
function getConfiguredAuthMethod(): string {
  const config = readEnvFile(['NANOCLAW_AUTH_METHOD']);
  return config.NANOCLAW_AUTH_METHOD || 'api-key';
}

export function getAuthConfig(): AuthConfig {
  const authMethod = getConfiguredAuthMethod();

  switch (authMethod) {
    case 'claude-cli':
      return getClaudeCliAuth();
    case 'api-key':
    default:
      return getApiKeyAuth();
  }
}

function getApiKeyAuth(): AuthConfig {
  const config = readEnvFile(['ANTHROPIC_API_KEY']);
  const apiKey = config.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error(
      'NANOCLAW_AUTH_METHOD=api-key but ANTHROPIC_API_KEY not set in .env',
    );
  }

  return {
    method: 'api-key',
    apiKey: apiKey,
    description: 'API Key (usage-based billing)',
    healthCheck: () => {
      // Verify API key format (starts with sk-ant-)
      return Boolean(apiKey && apiKey.startsWith('sk-ant'));
    },
  };
}

function getClaudeCliAuth(): AuthConfig {
  // Verify Claude CLI is installed
  let cliVersion = '';
  try {
    cliVersion = execSync('claude --version', { encoding: 'utf-8' }).trim();
    console.log(`✓ Claude CLI detected: ${cliVersion}`);
  } catch (error) {
    throw new Error(
      'NANOCLAW_AUTH_METHOD=claude-cli but Claude CLI not found. ' +
        'Install with: npm install -g @anthropic-ai/claude',
    );
  }

  // Verify Claude CLI is authenticated
  try {
    execSync('claude auth status', {
      encoding: 'utf-8',
      stdio: 'pipe',
    });
  } catch (error) {
    throw new Error(
      'Claude CLI found but not authenticated. Run: claude setup-token',
    );
  }

  return {
    method: 'claude-cli',
    backend: 'claude-cli',
    description: 'Claude CLI (Pro subscription quota)',
    cliVersion: cliVersion,
    healthCheck: () => {
      try {
        execSync('claude auth status', { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    },
  };
}

export const METHODS = {
  API_KEY: 'api-key',
  CLAUDE_CLI: 'claude-cli',
};
