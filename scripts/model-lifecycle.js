#!/usr/bin/env node
/**
 * Model Lifecycle Manager for NanoClaw
 * Loads gemma2:2b on-demand and auto-unloads after idle timeout
 * Run as: node scripts/model-lifecycle.js
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const MODEL_NAME = 'gemma2:2b';
const IDLE_TIMEOUT = parseInt(process.env.MODEL_IDLE_TIMEOUT || '300000', 10); // 5 minutes
const CHECK_INTERVAL = 30000; // Check every 30 seconds
const STATE_FILE = path.join(process.env.HOME || os.homedir(), '.nanoclaw-model-state.json');

let modelLoadedAt = null;
let lastAccessTime = null;

function log(msg) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${msg}`);
}

function getModelState() {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      return { loaded: false, loadedAt: null, lastAccess: null };
    }
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return { loaded: false, loadedAt: null, lastAccess: null };
  }
}

function setModelState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    log(`Warning: Failed to write state file: ${err.message}`);
  }
}

function isOllamaRunning() {
  try {
    const result = execSync(
      `curl -s ${OLLAMA_HOST}/api/tags || echo "error"`,
      { timeout: 5000 },
    ).toString();
    return result !== 'error' && !result.includes('connection refused');
  } catch {
    return false;
  }
}

function isModelLoaded() {
  try {
    const result = execSync(
      `curl -s ${OLLAMA_HOST}/api/tags`,
      { timeout: 5000 },
    ).toString();
    const tags = JSON.parse(result);
    return (
      tags.models &&
      tags.models.some((m) => m.name === MODEL_NAME || m.name.startsWith(MODEL_NAME))
    );
  } catch {
    return false;
  }
}

function loadModel() {
  try {
    log(`Loading model ${MODEL_NAME}...`);
    execSync(
      `curl -X POST ${OLLAMA_HOST}/api/generate -d '{"model":"${MODEL_NAME}","stream":false}' > /dev/null 2>&1`,
      { timeout: 60000 },
    );
    log(`Model ${MODEL_NAME} loaded successfully`);
    return true;
  } catch (err) {
    log(`Warning: Failed to load model: ${err.message}`);
    return false;
  }
}

function unloadModel() {
  try {
    log(`Unloading model ${MODEL_NAME}...`);
    execSync(`curl -X DELETE ${OLLAMA_HOST}/api/models/${MODEL_NAME} 2>/dev/null`, {
      timeout: 10000,
    });
    log(`Model ${MODEL_NAME} unloaded successfully`);
    return true;
  } catch (err) {
    // Model may not exist in Ollama's unload API, this is ok
    log(`Model unload status: ${err.message.slice(0, 50)}...`);
    return true;
  }
}

function checkAndManageModel() {
  if (!isOllamaRunning()) {
    log('Ollama is not running, skipping model management');
    return;
  }

  const state = getModelState();
  const now = Date.now();
  const timeSinceLastAccess = state.lastAccess ? now - state.lastAccess : Infinity;

  // If model is loaded and idle timeout exceeded, unload it
  if (state.loaded && timeSinceLastAccess > IDLE_TIMEOUT) {
    log(
      `Model idle for ${Math.round(timeSinceLastAccess / 1000)}s (threshold: ${Math.round(IDLE_TIMEOUT / 1000)}s), unloading...`,
    );
    unloadModel();
    setModelState({ loaded: false, loadedAt: null, lastAccess: null });
  } else if (state.loaded) {
    const timeUntilUnload = IDLE_TIMEOUT - timeSinceLastAccess;
    log(
      `Model loaded, idle for ${Math.round(timeSinceLastAccess / 1000)}s, will unload in ${Math.round(timeUntilUnload / 1000)}s`,
    );
  }
}

// Periodic check: run every CHECK_INTERVAL
setInterval(checkAndManageModel, CHECK_INTERVAL);

// Initial check
log(`Model Lifecycle Manager started`);
log(`  Ollama: ${OLLAMA_HOST}`);
log(`  Model: ${MODEL_NAME}`);
log(`  Idle timeout: ${Math.round(IDLE_TIMEOUT / 1000)}s`);
log(`  Check interval: ${Math.round(CHECK_INTERVAL / 1000)}s`);
checkAndManageModel();

// Graceful shutdown
process.on('SIGINT', () => {
  log('Shutting down gracefully...');
  process.exit(0);
});
process.on('SIGTERM', () => {
  log('Received SIGTERM, shutting down...');
  process.exit(0);
});
