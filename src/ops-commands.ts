/**
 * Operations commands for NanoClaw
 * Fast commands that don't require model inference
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export interface OpsCommandResult {
  command: string;
  output: string;
  timestamp: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
}

function parseVmStat(): Record<string, number> {
  try {
    const output = execSync('vm_stat').toString();
    const result: Record<string, number> = {};
    for (const line of output.split('\n')) {
      // Match lines like "Pages free:                                9404."
      // or "Pageins:                               75380716."
      const match = line.match(/^(.*?):\s+(\d+)\.?\s*$/);
      if (match) {
        const key = match[1].trim().replace(/^["']|["']$/g, ''); // Remove quotes if present
        result[key] = parseInt(match[2], 10);
      }
    }
    return result;
  } catch {
    return {};
  }
}

function getMemoryStatus(): string {
  try {
    const stats = parseVmStat();
    if (Object.keys(stats).length === 0) return 'Unable to read memory stats';

    // vm_stat reports in pages (4KB on ARM, 16KB on some systems)
    // Default to 16KB based on vm_stat header "page size of 16384 bytes"
    const pageSize = 16384;
    const free = (stats['Pages free'] || 0) * pageSize;
    const active = (stats['Pages active'] || 0) * pageSize;
    const inactive = (stats['Pages inactive'] || 0) * pageSize;
    const wired = (stats['Pages wired down'] || 0) * pageSize;
    const compressed = (stats['Pages stored in compressor'] || 0) * pageSize;

    const pageins = stats['Pageins'] || 0;
    const pageouts = stats['Pageouts'] || 0;

    return `Memory Status:
Free: ${formatBytes(free)}
Active: ${formatBytes(active)}
Inactive: ${formatBytes(inactive)}
Wired: ${formatBytes(wired)}
Compressed: ${formatBytes(compressed)}
Pressure (pageins/outs): ${pageins}/${pageouts}`;
  } catch (err) {
    return `Error reading memory: ${String(err)}`;
  }
}

function getDiskStatus(): string {
  try {
    const output = execSync('df -h').toString();
    return `Disk Status:\n${output}`;
  } catch (err) {
    return `Error reading disk: ${String(err)}`;
  }
}

function getProcessStatus(): string {
  try {
    const output = execSync('ps aux | sort -k3 -nr | head -10').toString();
    return `Top Processes by Memory:\n${output}`;
  } catch (err) {
    return `Error reading processes: ${String(err)}`;
  }
}

function getServiceStatus(): string {
  const services = [
    { name: 'PostgreSQL', pidPattern: /postgres/ },
    { name: 'Ollama', pidPattern: /ollama/ },
    { name: 'NanoClaw', pidPattern: /nanoclaw/ },
    { name: 'RSS daemon', pidPattern: /rss-digest/ },
  ];

  let status = 'Service Status:\n';
  for (const service of services) {
    try {
      const output = execSync(
        `pgrep -f "${service.pidPattern.source}" | wc -l`,
      ).toString();
      const count = parseInt(output.trim(), 10);
      status += `${service.name}: ${count > 0 ? '✓ running' : '✗ stopped'}\n`;
    } catch {
      status += `${service.name}: ✗ unknown\n`;
    }
  }
  return status;
}

function getLogsTail(logFile: string, lines: number = 20): string {
  try {
    if (!fs.existsSync(logFile)) {
      return `Log file not found: ${logFile}`;
    }
    const output = execSync(`tail -n ${lines} "${logFile}"`).toString();
    return `Last ${lines} lines of ${path.basename(logFile)}:\n${output}`;
  } catch (err) {
    return `Error reading logs: ${String(err)}`;
  }
}

function getHealthDiagnostic(): string {
  const diagnostics = [
    getServiceStatus(),
    '',
    getMemoryStatus(),
    '',
    getDiskStatus(),
  ];
  return diagnostics.join('\n');
}

function getHelpText(): string {
  return `Available ops commands (fast, no LLM needed):

/status   — Service health (PostgreSQL, Ollama, NanoClaw, RSS daemon)
/memory   — Memory breakdown (free, active, inactive, compressed, pressure)
/disk     — Disk usage by volume
/logs     — Last 30 lines of NanoClaw logs
/processes — Top 10 processes by memory usage
/health   — Full system diagnostic (status + memory + disk)
/help     — This message`;
}

export function isOpsCommand(text: string): boolean {
  // formatMessages wraps messages in XML, so search within <message> tags
  const messageMatch = text.match(/<message[^>]*>([^<]+)<\/message>/);
  if (messageMatch) {
    const messageContent = messageMatch[1].trim();
    return /^\/\w+/.test(messageContent);
  }
  // Fallback for raw commands (not wrapped in XML)
  return /^\/\w+/.test(text.trim());
}

export function parseOpsCommand(text: string): string | null {
  // formatMessages wraps messages in XML, so search within <message> tags
  const messageMatch = text.match(/<message[^>]*>([^<]+)<\/message>/);
  const content = messageMatch ? messageMatch[1].trim() : text.trim();
  const match = content.match(/^\/(\w+)/);
  return match ? match[1].toLowerCase() : null;
}

export async function executeOpsCommand(
  command: string,
  groupFolder: string,
): Promise<OpsCommandResult | null> {
  const cmd = command.toLowerCase();

  switch (cmd) {
    case 'status':
      return {
        command,
        output: getServiceStatus(),
        timestamp: Date.now(),
      };

    case 'memory':
      return {
        command,
        output: getMemoryStatus(),
        timestamp: Date.now(),
      };

    case 'disk':
      return {
        command,
        output: getDiskStatus(),
        timestamp: Date.now(),
      };

    case 'processes':
      return {
        command,
        output: getProcessStatus(),
        timestamp: Date.now(),
      };

    case 'logs':
      // Try to read NanoClaw logs
      const logsDir = path.join(process.cwd(), 'groups', groupFolder, 'logs');
      const logFile = path.join(logsDir, 'nanoclaw.log');
      return {
        command,
        output: getLogsTail(logFile, 30),
        timestamp: Date.now(),
      };

    case 'health':
      return {
        command,
        output: getHealthDiagnostic(),
        timestamp: Date.now(),
      };

    case 'help':
      return {
        command,
        output: getHelpText(),
        timestamp: Date.now(),
      };

    default:
      return null;
  }
}
