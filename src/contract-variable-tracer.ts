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
  /**
   * The human readable method ABI for reading the variable
   * @example "function balanceOf(address) view returns (uint256)"
   */
  methodAbi: string;
  /** Additional parameters to pass to the method (optional) */
  methodParams?: unknown[];
  /** All the events that can cause the variable to update */
  events: string[];
  /** Starting block number */
  fromBlock: number;
  /** Ending block number */
  toBlock: number;
  /** Maximum block range allowed per eth_getLogs RPC call, default `500` */
  maxBlockRangePerLogQuery?: number;
  /** Batch size for concurrent contract calls, default `10` */
  concurrentCallBatchSize?: number;
  /** Whether to remove duplicated ouput values, default `true` */
  dedup?: boolean;
  /** Whether to print log to stdio, default `false` */
  enableLog?: boolean;
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

  private log(enableLog = false, ...args: unknown[]) {
    if (enableLog) {
      console.log(...args);
    }
  }

  private extractFunctionNameFromAbi(abi: string): string {
    const regex = /function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/;
    const match = abi.match(regex);
    const fnName = match?.[1];
    if (!fnName) {
      throw new Error(`Invalid ABI: ${abi}`);
    }
    return fnName;
  }

  /**
   * Get block numbers where specific events occurred that may have updated the variable
   */
  private async getBlockNumbersFromLogs(
    contractAddress: Address,
    events: string[],
    fromBlock: number,
    toBlock: number,
  ): Promise<string[]> {
    const logs = await this.publicClient.getLogs({
      address: contractAddress,
      events: parseAbi(events),
      fromBlock: BigInt(fromBlock),
      toBlock: BigInt(toBlock),
    });

    return logs.map((log) => log.blockNumber.toString());
  }

  /**
   * Collect all block numbers where the variable may have changed
   * by scanning event logs in batches
   */
  public async collectBlockNumbers(
    config: Pick<
      ContractVariableTraceConfig,
      | 'contractAddress'
      | 'events'
      | 'fromBlock'
      | 'toBlock'
      | 'maxBlockRangePerLogQuery'
    >,
  ): Promise<string[]> {
    const {
      contractAddress,
      events,
      fromBlock,
      toBlock,
      maxBlockRangePerLogQuery = 500,
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
      methodAbi,
      methodParams = [],
      concurrentCallBatchSize = 10,
      dedup: isDedup = true,
    } = config;

    const abi: string[] = [methodAbi];
    // Create contract instance
    const contract = getContract({
      address: contractAddress,
      abi: parseAbi(abi),
      client: this.publicClient,
    });

    const methodName = this.extractFunctionNameFromAbi(methodAbi);
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
    this.log(config.enableLog, 'Collecting block numbers from event logs...');
    const blockNumbers = await this.collectBlockNumbers(config);
    this.log(
      config.enableLog,
      `Found ${blockNumbers.length} blocks with potential variable changes`,
    );
    this.log(config.enableLog, 'Tracing variable values...');

    return await this.traceVariableValues(config, blockNumbers);
  }
}
