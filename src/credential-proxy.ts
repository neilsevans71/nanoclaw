/**
 * Credential proxy for container isolation.
 * Containers connect here instead of directly to the Anthropic API.
 * The proxy injects real credentials so containers never see them.
 *
 * Three auth modes:
 *   API key:      Proxy injects x-api-key on every request.
 *   OAuth:        Container CLI exchanges placeholder token for a temp
 *                 API key via /api/oauth/claude_cli/create_api_key.
 *                 Proxy injects real OAuth token on exchange request;
 *                 subsequent requests use temp key.
 *   Claude CLI:   Proxy detects CLI auth and uses OAuth flow.
 *                 Configured via NANOCLAW_AUTH_METHOD=claude-cli in .env.
 */
import { createServer, Server } from 'http';
import { request as httpsRequest } from 'https';
import { request as httpRequest, RequestOptions } from 'http';

import { readEnvFile } from './env.js';
import { logger } from './logger.js';

export type AuthMode = 'api-key' | 'oauth' | 'claude-cli';

export interface ProxyConfig {
  authMode: AuthMode;
}

export function startCredentialProxy(
  port: number,
  host = '127.0.0.1',
): Promise<Server> {
  const secrets = readEnvFile([
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
    'NANOCLAW_AUTH_METHOD',
  ]);

  // Determine auth mode from config
  let authMode: AuthMode = 'api-key';
  let apiKey = secrets.ANTHROPIC_API_KEY;
  let oauthToken =
    secrets.CLAUDE_CODE_OAUTH_TOKEN || secrets.ANTHROPIC_AUTH_TOKEN;

  const configuredMethod = secrets.NANOCLAW_AUTH_METHOD || 'api-key';

  if (configuredMethod === 'claude-cli') {
    // Claude CLI mode: use OAuth flow (containers exchange placeholder token)
    authMode = 'claude-cli';
    // Claude CLI will handle auth via ANTHROPIC_AUTH_TOKEN
    if (!oauthToken) {
      logger.warn(
        'NANOCLAW_AUTH_METHOD=claude-cli but no OAuth token detected. ' +
          'Ensure Claude CLI is authenticated with: claude setup-token',
      );
    }
  } else if (apiKey) {
    // API key mode (default)
    authMode = 'api-key';
  } else if (oauthToken) {
    // OAuth mode (backwards compatibility)
    authMode = 'oauth';
  }

  logger.info(
    { configuredMethod, detectedMode: authMode },
    'Credential proxy auth mode',
  );

  const upstreamUrl = new URL(
    secrets.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  );
  const isHttps = upstreamUrl.protocol === 'https:';
  const makeRequest = isHttps ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const headers: Record<string, string | number | string[] | undefined> =
          {
            ...(req.headers as Record<string, string>),
            host: upstreamUrl.host,
            'content-length': body.length,
          };

        // Strip hop-by-hop headers that must not be forwarded by proxies
        delete headers['connection'];
        delete headers['keep-alive'];
        delete headers['transfer-encoding'];

        if (authMode === 'api-key') {
          // API key mode: inject x-api-key on every request
          delete headers['x-api-key'];
          headers['x-api-key'] = apiKey;
        } else if (authMode === 'claude-cli' || authMode === 'oauth') {
          // OAuth / Claude CLI mode: replace placeholder Bearer token with real one.
          // Container CLI exchanges placeholder token for a temp API key via
          // /api/oauth/claude_cli/create_api_key endpoint.
          // Proxy injects real OAuth token on that exchange request;
          // subsequent requests use temp key which is valid as-is.
          if (headers['authorization']) {
            delete headers['authorization'];
            if (oauthToken) {
              headers['authorization'] = `Bearer ${oauthToken}`;
            }
          }
        }

        const upstream = makeRequest(
          {
            hostname: upstreamUrl.hostname,
            port: upstreamUrl.port || (isHttps ? 443 : 80),
            path: req.url,
            method: req.method,
            headers,
          } as RequestOptions,
          (upRes) => {
            res.writeHead(upRes.statusCode!, upRes.headers);
            upRes.pipe(res);
          },
        );

        upstream.on('error', (err) => {
          logger.error(
            { err, url: req.url },
            'Credential proxy upstream error',
          );
          if (!res.headersSent) {
            res.writeHead(502);
            res.end('Bad Gateway');
          }
        });

        upstream.write(body);
        upstream.end();
      });
    });

    server.listen(port, host, () => {
      const modeDesc =
        authMode === 'api-key'
          ? 'API Key (usage-based billing)'
          : authMode === 'claude-cli'
            ? 'Claude CLI (Pro subscription quota)'
            : 'OAuth (container token exchange)';
      logger.info(
        { port, host, authMode, description: modeDesc },
        'Credential proxy started',
      );
      resolve(server);
    });

    server.on('error', reject);
  });
}

/** Detect which auth mode the host is configured for. */
export function detectAuthMode(): AuthMode {
  const secrets = readEnvFile([
    'NANOCLAW_AUTH_METHOD',
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_AUTH_TOKEN',
  ]);

  const configuredMethod = secrets.NANOCLAW_AUTH_METHOD;

  // If explicitly configured, use that
  if (configuredMethod === 'claude-cli') {
    return 'claude-cli';
  }
  if (configuredMethod === 'api-key' || configuredMethod === 'oauth') {
    return configuredMethod;
  }

  // Otherwise, auto-detect (backwards compatibility)
  if (secrets.ANTHROPIC_API_KEY) {
    return 'api-key';
  }
  if (secrets.CLAUDE_CODE_OAUTH_TOKEN || secrets.ANTHROPIC_AUTH_TOKEN) {
    return 'oauth';
  }

  // Default to api-key if nothing is configured
  return 'api-key';
}
