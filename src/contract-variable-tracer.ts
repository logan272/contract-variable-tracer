import type { Address, PublicClient } from 'viem';
import { createPublicClient, getContract, http, parseAbi } from 'viem';

import { chunk } from './utils/chunk';
import { dedup } from './utils/dedup';
import { getChain } from './utils/get-chain';

/**
 * Configuration for tracing smart contract variables
 */
export interface ContractVariableTraceConfig {
  /** The contract address to trace */
  contractAddress: Address;
  /** The human readable contract ABI */
  abi: string[];
  /** The method name to call for reading the variable */
  methodName: string;
  /** Additional parameters to pass to the method (optional) */
  methodParams?: readonly unknown[];
  /** Events that can cause the variable to update */
  events: string[];
  /** Starting block number */
  fromBlock: bigint;
  /** Ending block number */
  toBlock: bigint;
  /** Maximum block range allowed per eth_getLogs RPC call, default `500` */
  maxBlockRangePerLogQuery?: bigint;
  /** Batch size for concurrent contract calls, default `10` */
  concurrentCallBatchSize?: number;
  /** Whether to remove duplicated ouput values, default `true` */
  dedup?: boolean;
}

/**
 * Result of a variable trace operation
 */
export interface TraceResult {
  blockNumber: string;
  value: string;
}

/**
 * Generic smart contract variable tracer
 */
export class ContractVariableTracer {
  private publicClient: PublicClient;

  constructor(opts?: { rpcUrl?: string; chainId?: number }) {
    const { rpcUrl, chainId = 1 } = opts ?? {};
    this.publicClient = createPublicClient({
      chain: getChain(chainId),
      transport: http(rpcUrl),
    });
  }

  /**
   * Get block numbers where specific events occurred that may have updated the variable
   */
  private async getBlockNumbersFromLogs(
    contractAddress: Address,
    events: string[],
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<string[]> {
    const logs = await this.publicClient.getLogs({
      address: contractAddress,
      events: parseAbi(events),
      fromBlock,
      toBlock,
    });

    return logs.map((log) => log.blockNumber.toString());
  }

  /**
   * Collect all block numbers where the variable may have changed
   * by scanning event logs in batches
   */
  public async collectBlockNumbers(
    config: ContractVariableTraceConfig,
  ): Promise<string[]> {
    const {
      contractAddress,
      events,
      fromBlock,
      toBlock,
      maxBlockRangePerLogQuery = 500n,
    } = config;

    let allBlockNumbers: string[] = [];

    // Process blocks in batches to avoid RPC limits
    for (
      let currentBlock = fromBlock;
      currentBlock < toBlock;
      currentBlock += maxBlockRangePerLogQuery
    ) {
      const endBlock =
        currentBlock + maxBlockRangePerLogQuery > toBlock
          ? toBlock
          : currentBlock + maxBlockRangePerLogQuery;

      const blockNumbers = await this.getBlockNumbersFromLogs(
        contractAddress,
        events,
        currentBlock,
        endBlock,
      );

      allBlockNumbers = allBlockNumbers.concat(blockNumbers);
    }

    // Remove duplicates and sort
    const uniqueBlockNumbers = [...new Set(allBlockNumbers)].sort(
      (a, b) => Number(a) - Number(b),
    );

    return uniqueBlockNumbers;
  }

  /**
   * Trace the variable values at specific block numbers
   */
  public async traceVariableValues(
    config: ContractVariableTraceConfig,
    blockNumbers: string[],
  ): Promise<TraceResult[]> {
    const {
      contractAddress,
      abi,
      methodName,
      methodParams = [],
      concurrentCallBatchSize = 10,
      dedup: isDedup = true,
    } = config;

    // Create contract instance
    const contract = getContract({
      address: contractAddress,
      abi: parseAbi(abi),
      client: this.publicClient,
    });

    // Validate that the method exists on the contract
    if (!contract.read[methodName]) {
      throw new Error(`Method '${methodName}' not found in contract ABI`);
    }

    let allValues: TraceResult[] = [];
    const chunks = chunk(blockNumbers, concurrentCallBatchSize);

    // Process chunks of block numbers concurrently
    for (const blockChunk of chunks) {
      const requests = blockChunk.map(async (blockNumber) => {
        try {
          const contractMethod = contract.read[methodName];
          // Call the contract method with the specified parameters at the specified block number
          const value = await contractMethod({
            ...(methodParams.length > 0 ? { args: methodParams } : {}),
            blockNumber: BigInt(blockNumber),
          });

          return {
            blockNumber,
            value: (value as bigint).toString(),
          };
        } catch (error) {
          console.warn(
            `Failed to read ${methodName} at block ${blockNumber}:`,
            error,
          );
          return {
            blockNumber,
            value: 'ERROR',
          };
        }
      });

      const values = await Promise.all(requests);
      allValues = allValues.concat(values);
    }

    // Filter out error values
    allValues = allValues.filter((v) => v.value !== 'ERROR');
    if (isDedup) {
      // Removes consecutive duplicate values from allValues
      allValues = dedup(allValues, (a, b) => a.value === b.value);
    }

    return allValues;
  }

  /**
   * Complete tracing workflow: collect block numbers and trace variable values
   */
  public async traceVariable(
    config: ContractVariableTraceConfig,
  ): Promise<TraceResult[]> {
    console.log('Collecting block numbers from event logs...');
    const blockNumbers = await this.collectBlockNumbers(config);

    console.log(
      `Found ${blockNumbers.length} blocks with potential variable changes`,
    );
    console.log('Tracing variable values...');

    return await this.traceVariableValues(config, blockNumbers);
  }
}
