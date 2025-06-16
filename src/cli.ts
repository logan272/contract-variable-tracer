import fs from 'node:fs/promises';
import path from 'node:path';

import cliProgress from 'cli-progress';
import yargs from 'yargs';
// eslint-disable-next-line import/no-unresolved
import { hideBin } from 'yargs/helpers';

import type {
  ContractVariableTraceConfig,
  OnProgressCallback,
} from './contract-variable-tracer';
import { ContractVariableTracer } from './contract-variable-tracer';
import { removeComments } from './utils/remove-comments';

/**
 * CLI arguments interface
 */
interface CliArgs {
  chainId: number;
  rpc: string;
  output: string; // The output file path
  config: string;
  watch?: boolean; // Watch mode
  verbose?: boolean;
}

/**
 * Load and validate configuration file
 */
async function loadConfig(
  configPath: string,
  isWatchMode: boolean = false,
): Promise<ContractVariableTraceConfig> {
  try {
    // Resolve the config file path
    const resolvedPath = path.resolve(configPath);

    // Check if file exists
    await fs.access(resolvedPath);

    // Read and parse the config file
    const configContent = await fs.readFile(resolvedPath, 'utf-8');
    const config = JSON.parse(
      removeComments(configContent),
    ) as ContractVariableTraceConfig;

    // Basic validation
    if (!config.contractAddress) {
      throw new Error('Missing required field: contractAddress');
    }
    if (!config.methodAbi) {
      throw new Error('Missing required field: methodAbi');
    }
    if (!config.events || !Array.isArray(config.events)) {
      throw new Error('Missing or invalid field: events (must be an array)');
    }
    // For watch mode, fromBlock and toBlock are not required
    if (!isWatchMode) {
      if (typeof config.fromBlock === 'undefined') {
        throw new Error('Missing required field: fromBlock');
      }
      if (typeof config.toBlock === 'undefined') {
        throw new Error('Missing required field: toBlock');
      }
    }

    config.fromBlock = Number(config.fromBlock);
    config.toBlock = Number(config.toBlock);
    if (config.maxBlockRangePerLogQuery) {
      config.maxBlockRangePerLogQuery = Number(config.maxBlockRangePerLogQuery);
    }

    return config;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in config file: ${error.message}`);
    }
    if ((error as { code: string }).code === 'ENOENT') {
      throw new Error(`Config file not found: ${configPath}`);
    }
    throw error;
  }
}

/**
 * Format timestamp for logging
 */
function formatTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Save data to a JSON file
 */
async function saveToFile(data: unknown, filename: string): Promise<void> {
  try {
    await fs.writeFile(filename, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`Failed to save to ${filename}:`, error);
  }
}

/**
 * Watch mode handler
 */
async function handleWatchMode(
  args: CliArgs,
  config: ContractVariableTraceConfig,
) {
  console.log('👀 Starting watch mode...');
  console.log(`Contract: ${config.contractAddress}`);
  console.log(`Method: ${config.methodAbi}`);
  console.log(`Events:\n\t${config.events.join('\n\t')}`);
  console.log('✅ Watch mode active. Press Ctrl+C to stop.');
  console.log('---');

  const tracer = new ContractVariableTracer({
    chainId: args.chainId,
    rpcUrl: args.rpc,
  });

  let changeCount = 0;
  const startTime = Date.now();

  const cleanup = await tracer.watch(
    config,
    async (prev, curr) => {
      changeCount++;
      const timestamp = formatTimestamp();

      // Simple output to stdout
      if (prev) {
        console.log(
          `[${timestamp}] ${prev.value} → ${curr.value} (block ${curr.blockNumber})`,
        );
      } else {
        console.log(
          `[${timestamp}] 🎯 Initial: ${curr.value} (block ${curr.blockNumber})`,
        );
      }
    },
    {
      onError: async (error) => {
        const timestamp = formatTimestamp();
        console.error(`[${timestamp}] ❌ Error: ${error.message}`);

        if (args.verbose) {
          console.error('Details:', error);
        }
      },
      onReconnect: async () => {
        const timestamp = formatTimestamp();
        console.log(`[${timestamp}] 🔄 Reconnected`);
      },
    },
  );

  // Handle graceful shutdown
  const handleShutdown = async (_signal: string) => {
    const timestamp = formatTimestamp();
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(
      `\n[${timestamp}] 🛑 Shutting down... (${duration}s, ${changeCount} changes)`,
    );

    cleanup();
    process.exit(0);
  };

  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));

  // Keep the process alive
  return new Promise<void>(() => {}); // Never resolves, keeps watching
}

/**
 * Trace mode handler (original functionality)
 */
async function handleTraceMode(
  args: CliArgs,
  config: ContractVariableTraceConfig,
) {
  const tracer = new ContractVariableTracer({
    chainId: args.chainId,
    rpcUrl: args.rpc,
  });

  console.log('🚀 Starting contract variable trace...');
  const startTime = Date.now();

  const bars: Record<string, cliProgress.SingleBar> = {};
  const onProgress: OnProgressCallback = ({
    key,
    description,
    current,
    total,
  }) => {
    if (!bars[key]) {
      console.log(description);
      bars[key] = new cliProgress.SingleBar(
        {
          clearOnComplete: true,
        },
        cliProgress.Presets.shades_classic,
      );
      bars[key].start(total, 0);
    } else {
      bars[key].update(current);
    }

    if (total === current) {
      bars[key].stop();
    }
  };

  const results = await tracer.trace(config, onProgress);

  if (args.output) {
    await saveToFile(results, args.output);
    console.log(`Results saved to: ${args.output}`);
  } else {
    console.log('\n================Tracing Result START====================');
    console.log(JSON.stringify(results, null, 2));
    console.log('================Tracing Result END======================\n');
  }

  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);

  console.log(`Trace completed successfully!`);
  console.log(`Traced ${results.length} data points in ${duration}s`);
}

/**
 * Main CLI handler
 */
async function main(args: CliArgs) {
  try {
    if (args.verbose) {
      console.log('Loading configuration...');
    }

    const config = await loadConfig(args.config, args.watch);

    if (args.verbose) {
      console.log(`Connecting to chain ${args.chainId} via ${args.rpc}`);
      console.log(`Config loaded successfully from: ${args.config}`);
    }

    if (args.watch) {
      await handleWatchMode(args, config);
    } else {
      await handleTraceMode(args, config);
    }
  } catch (error) {
    console.error(
      '❌ Error:',
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
}

/**
 * Setup CLI with yargs
 */
const cli = yargs(hideBin(process.argv))
  .scriptName('contract-tracer')
  .usage('$0 [options]', 'Trace smart contract variable changes over time')
  .option('chainId', {
    alias: 'c',
    type: 'number',
    default: 1,
    demandOption: false,
    description: 'Chain ID of the blockchain network',
  })
  .option('rpc', {
    alias: 'r',
    type: 'string',
    demandOption: false,
    description: 'RPC URL for the blockchain network',
  })
  .option('config', {
    alias: 'f',
    type: 'string',
    demandOption: false,
    default: 'cvt.config.json',
    description: 'Path to the configuration JSON file',
  })
  .option('output', {
    alias: 'o',
    type: 'string',
    demandOption: false,
    description: 'Path to the output file for trace mode results',
  })
  .option('verbose', {
    alias: 'v',
    type: 'boolean',
    default: false,
    description: 'Enable verbose logging',
  })
  .option('watch', {
    alias: 'w',
    type: 'boolean',
    default: false,
    description: 'Enable watch mode for real-time monitoring',
  })
  .example(
    '$0 -c 1 -r https://eth-mainnet.alchemyapi.io/v2/YOUR-API-KEY -f ./config.json',
    'Trace contract variables on Ethereum mainnet',
  )
  .example(
    '$0 --watch --chainId 1 --rpc https://eth-mainnet.alchemyapi.io/v2/YOUR-API-KEY -f ./config.json',
    'Start real-time monitoring (watch mode)',
  )
  .example(
    '$0 --chainId 42161 --rpc https://arb1.arbitrum.io/rpc --config ./arbitrum-config.json --verbose',
    'Trace on Arbitrum with verbose logging',
  )
  .help()
  .alias('help', 'h')
  .version()
  .alias('version', 'V');

// Run the CLI
const args = cli.parse();
main(args as CliArgs).catch((error) => {
  console.error('CLI Error:', error);
  process.exit(1);
});
