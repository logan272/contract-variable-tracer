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
  verbose?: boolean;
}

/**
 * Load and validate configuration file
 */
async function loadConfig(
  configPath: string,
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
    if (typeof config.fromBlock === 'undefined') {
      throw new Error('Missing required field: fromBlock');
    }
    if (typeof config.toBlock === 'undefined') {
      throw new Error('Missing required field: toBlock');
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
 * Main CLI handler
 */
async function main(args: CliArgs) {
  try {
    if (args.verbose) {
      console.log('Loading configuration...');
    }

    const config = await loadConfig(args.config);
    if (args.verbose) {
      console.log(`Connecting to chain ${args.chainId} via ${args.rpc}`);
      console.log(`Config loaded successfully from: ${args.config}`);
      console.log(`Contract: ${config.contractAddress}`);
      console.log(`Method: ${config.methodAbi}`);
      console.log(`Block range: ${config.fromBlock} to ${config.toBlock}`);
    }

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
      saveToFile(results, args.output);
    } else {
      console.log('\n================Tracing Result START====================');
      console.log(JSON.stringify(results, null, 2));
      console.log('================Tracing Result EDN======================\n');
    }

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    console.log(`Trace completed successfully!`);
    console.log(`Traced ${results.length} data points in ${duration}s`);
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
    description:
      'Path to the output file, the tracing result to be save to this file when provided',
  })
  .option('verbose', {
    alias: 'v',
    type: 'boolean',
    default: false,
    description: 'Enable verbose logging',
  })
  .example(
    '$0 -c 1 -r https://eth-mainnet.alchemyapi.io/v2/YOUR-API-KEY -f ./config.json',
    'Trace contract variables on Ethereum mainnet',
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
