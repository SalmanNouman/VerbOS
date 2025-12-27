import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { platform, arch, release, hostname, homedir, tmpdir, totalmem, freemem, cpus, networkInterfaces } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const netInterfaces = networkInterfaces();

/**
 * SystemTool provides system information to the agent
 */
export class SystemTool {
  static getSystemInfo = new DynamicStructuredTool({
    name: 'get_system_info',
    description: 'Get information about the current operating system and environment',
    schema: z.object({}),
    func: async () => {
      // Errors will be caught by the AgentService
      const info = {
        platform: platform(),
        arch: arch(),
        os_release: release(),
        hostname: hostname(),
        home_directory: homedir(),
        temp_directory: tmpdir(),
        memory: {
          total: Math.round(totalmem() / 1024 / 1024) + ' MB',
          free: Math.round(freemem() / 1024 / 1024) + ' MB',
        },
        cpu: {
          model: cpus()[0]?.model || 'Unknown',
          cores: cpus().length,
        },
        network: {
          interfaces: Object.keys(netInterfaces).filter(iface => 
            netInterfaces[iface]?.some(addr => !addr.internal)
          ),
        },
      };

      // Add platform-specific info
      if (platform() === 'win32') {
        try {
          const { stdout } = await execAsync('wmic os get Caption,Version /value');
          const windowsInfo = stdout
            .split('\n')
            .filter(line => line.includes('='))
            .reduce((acc, line) => {
              const [key, value] = line.split('=');
              acc[key.trim().toLowerCase()] = value.trim();
              return acc;
            }, {} as Record<string, string>);
          (info as any)['windows_info'] = windowsInfo;
        } catch {
          // Ignore Windows-specific info errors, this is non-critical
        }
      }

      return JSON.stringify(info, null, 2);
    },
  });

  /**
   * Get all tools as an array
   */
  static getTools() {
    return [
      this.getSystemInfo,
    ];
  }
}
