import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { platform, arch, release, homedir, tmpdir, totalmem, freemem, cpus, networkInterfaces } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * SystemTool provides system information to the agent
 */
export class SystemTool {
  static getSystemInfo = new DynamicStructuredTool({
    name: 'get_system_info',
    description: 'Get information about the current operating system and environment',
    schema: z.object({}),
    func: async () => {
      try {
        const info = {
          platform: platform(),
          arch: arch(),
          os_release: release(),
          hostname: require('os').hostname(),
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
            interfaces: Object.keys(networkInterfaces()).filter(iface => 
              networkInterfaces()[iface]?.some(addr => !addr.internal)
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
            // Ignore Windows-specific info errors
          }
        }

        return JSON.stringify(info, null, 2);
      } catch (error) {
        if (error instanceof Error) {
          return `Error: ${error.message}`;
        }
        return 'Unknown error occurred while getting system info';
      }
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
