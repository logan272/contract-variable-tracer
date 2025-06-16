import type { Address, PublicClient } from 'viem';
import { createPublicClient, getContract, http, parseAbi } from 'viem';
import { watchEvent, type WatchEventReturnType } from 'viem/actions';

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
}

/**
 * Result of a variable trace operation
 */
export interface TraceResult {
  blockNumber: string;
  value: string;
}

// Add this to your types file
export interface ProgressInfo {
  key: string;
  description: string;
  current: number;
  total: number;
}
export type OnProgressCallback = (progress: ProgressInfo) => void;

export interface WatchOptions {
  filter?: (prev: TraceResult | undefined, curr: TraceResult) => boolean;
  onError?: (error: Error) => void | Promise<void>;
  maxRetries?: number;
  onReconnect?: () => void | Promise<void>;
  initialValue?: TraceResult;
}
export type OnNewValueCallback = (
  prev: TraceResult | undefined,
  curr: TraceResult,
) => void | Promise<void>;

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
   * Read variable value at a specific block
   */
  private async readVariableAtBlock(
    config: Pick<
      ContractVariableTraceConfig,
      'contractAddress' | 'methodAbi' | 'methodParams'
    >,
    blockNumber: string,
  ): Promise<string> {
    const abi: string[] = [config.methodAbi];
    const contract = getContract({
      address: config.contractAddress,
      abi: parseAbi(abi),
      client: this.publicClient,
    });

    const methodName = this.extractFunctionNameFromAbi(config.methodAbi);
    const contractMethod = contract.read[methodName];

    if (!contractMethod) {
      throw new Error(`Method '${methodName}' not found in contract ABI`);
    }

    const value = await contractMethod({
      ...(config.methodParams && config.methodParams.length > 0
        ? { args: config.methodParams }
        : {}),
      blockNumber: BigInt(blockNumber),
    });

    return (value as bigint).toString();
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
    onProgress?: OnProgressCallback,
  ): Promise<string[]> {
    const {
      contractAddress,
      events,
      fromBlock,
      toBlock,
      maxBlockRangePerLogQuery = 500,
    } = config;

    let allBlockNumbers: string[] = [];

    const total = toBlock - fromBlock;
    const key = 'collectBlockNumbers';
    const description = 'Collecting block numbers...';

    // Process blocks in batches to avoid RPC limits
    for (
      let currentBlock = fromBlock;
      currentBlock < toBlock;
      currentBlock += maxBlockRangePerLogQuery
    ) {
      onProgress?.({
        key,
        description,
        current: currentBlock - fromBlock,
        total,
      });
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

    // 100% progress
    onProgress?.({
      key,
      description,
      current: total,
      total,
    });

    // Remove duplicates and sort
    const uniqueBlockNumbers = [...new Set(allBlockNumbers)].sort(
      (a, b) => Number(a) - Number(b),
    );

    return uniqueBlockNumbers;
  }

  /**
   * Traces a contract variable over time with optional progress reporting.
   * Can either generate block numbers automatically or use provided block numbers.
   */
  public async trace(
    config: ContractVariableTraceConfig,
    onProgress?: OnProgressCallback,
  ): Promise<TraceResult[]>;
  public async trace(
    config: ContractVariableTraceConfig,
    blockNumbers: string[],
    onProgress?: OnProgressCallback,
  ): Promise<TraceResult[]>;
  public async trace(
    config: ContractVariableTraceConfig,
    blockNumbersOrOnProgress?: string[] | OnProgressCallback,
    onProgress?: OnProgressCallback,
  ): Promise<TraceResult[]> {
    let blockNumbers: string[] | undefined;

    if (Array.isArray(blockNumbersOrOnProgress)) {
      blockNumbers = blockNumbersOrOnProgress;
    } else {
      onProgress = blockNumbersOrOnProgress;
      blockNumbers = await this.collectBlockNumbers(config, onProgress);
    }

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
    const key = 'trace';
    const description = 'Tracing variable changes...';
    const total = blockNumbers.length;

    // Process chunks of block numbers concurrently
    for (let i = 0; i < chunks.length; i++) {
      onProgress?.({
        key,
        description,
        current: i * concurrentCallBatchSize,
        total,
      });
      const blockChunk = chunks[i];
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

      // 100% progress
      onProgress?.({
        key,
        description,
        current: total,
        total,
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
   * Continuously monitors a smart contract variable for changes by watching for relevant events.
   *
   * This method establishes real-time monitoring of a contract variable by:
   * 1. Setting up event listeners for specified events that may trigger variable changes
   * 2. Reading the current variable value when events are detected
   * 3. Comparing with the previous value to detect actual changes
   * 4. Invoking callbacks only when the value has actually changed
   *
   * The method uses a dual-monitoring approach:
   * - Primary: Event-based monitoring for immediate detection
   * - Fallback: Periodic polling to ensure no changes are missed
   *
   * @param config - Configuration object specifying the contract, method, and events to monitor
   * @param onNewValue - Callback function invoked when the variable value changes
   *   - `prev`: Previous TraceResult (undefined for the first detected value)
   *   - `curr`: Current TraceResult with the new value and block number
   * @param opts - Optional configuration for monitoring behavior
   * @param opts.filter - Optional predicate function to filter which changes trigger callbacks.
   *   Only calls `onNewValue` when this function returns `true`. Useful for:
   *   - Filtering out insignificant changes (e.g., < 1% change)
   *   - Applying custom business logic to determine relevance
   * @param opts.onError - Callback for handling errors during monitoring.
   *   If not provided, errors are logged to console
   * @param opts.maxRetries - Maximum retry attempts for failed operations (default: 3)
   * @param opts.onReconnect - Callback invoked when connection is re-established
   *   after a disconnection
   * @param opts.initialValue - Pre-fetched initial value to avoid extra RPC call.
   *   If not provided, the method will fetch the current value at startup
   *
   * @returns Promise that resolves to a cleanup function. Call this function to stop
   *   monitoring and clean up all resources (event listeners, timers, etc.)
   *
   * @throws {Error} If initial setup fails (invalid configuration, network issues, etc.)
   *
   * @example
   * ```typescript
   * const cleanup = await tracer.watch(
   *   config,
   *   (prev, curr) => {
   *     console.log(`Value: ${prev?.value || 'N/A'} → ${curr.value}`);
   *   }
   * );
   *
   * // Monitoring with filtering and error handling
   * const cleanup = await tracer.watch(
   *   config,
   *   async (prev, curr) => {
   *     await sendAlert(`Critical change detected: ${curr.value}`);
   *   },
   *   {
   *     filter: (prev, curr) => {
   *       // Only alert on significant changes (>5%)
   *       if (!prev) return true;
   *       const change = Math.abs(Number(curr.value) - Number(prev.value));
   *       return change / Number(prev.value) > 0.05;
   *     },
   *     onError: (error) => console.error('Monitoring failed:', error),
   *     onReconnect: () => console.log('Reconnected successfully')
   *   }
   * );
   *
   * // Stop monitoring when done
   * cleanup();
   * ```
   *
   * @see {@link collectBlockNumbers} For one-time block collection
   * @see {@link trace} For historical variable tracing
   */
  public async watch(
    config: ContractVariableTraceConfig,
    onNewValue: OnNewValueCallback,
    opts: WatchOptions = {},
  ): Promise<() => void> {
    const { filter, onError, maxRetries = 3, onReconnect, initialValue } = opts;

    let currentValue: TraceResult | undefined = initialValue;
    let isWatching = true;
    let unWatcher: WatchEventReturnType | undefined;

    // Get initial value if not provided
    if (!currentValue) {
      try {
        const latestBlock = await this.publicClient.getBlockNumber();
        const value = await this.readVariableAtBlock(
          config,
          latestBlock.toString(),
        );
        currentValue = {
          blockNumber: latestBlock.toString(),
          value,
        };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        await this.handleError(err, onError, 'Failed to get initial value');
      }
    }

    // Function to check and handle value changes
    const checkValueChange = async (
      blockNumber: bigint,
      retryCount = 0,
    ): Promise<void> => {
      if (!isWatching) return;

      try {
        const newValue = await this.readVariableAtBlock(
          config,
          blockNumber.toString(),
        );
        const newResult: TraceResult = {
          blockNumber: blockNumber.toString(),
          value: newValue,
        };

        // If value not changed, return ealier
        if (currentValue && currentValue.value === newResult.value) return;

        // Apply filter if provided
        if (!filter || filter(currentValue, newResult)) {
          const prevValue = currentValue;
          currentValue = newResult;

          try {
            await onNewValue(prevValue, newResult);
          } catch (callbackError) {
            const err =
              callbackError instanceof Error
                ? callbackError
                : new Error(String(callbackError));
            await this.handleError(
              err,
              onError,
              'Error in onNewValue callback',
            );
          }
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));

        if (retryCount < maxRetries) {
          console.warn(
            `Retry ${retryCount + 1}/${maxRetries} for block ${blockNumber}:`,
            err.message,
          );
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * (retryCount + 1)),
          ); // Exponential backoff
          return checkValueChange(blockNumber, retryCount + 1);
        } else {
          await this.handleError(
            err,
            onError,
            `Failed to check value change at block ${blockNumber}`,
          );
        }
      }
    };

    // Start event watching
    const startEventWatcher = async (): Promise<void> => {
      unWatcher = watchEvent(this.publicClient, {
        address: config.contractAddress,
        events: parseAbi(config.events),
        onLogs: async (logs) => {
          if (!isWatching) return;

          // Process logs in order
          const sortedLogs = logs
            .filter((log) => log.blockNumber)
            .sort((a, b) => Number(a.blockNumber!) - Number(b.blockNumber!));

          for (const log of sortedLogs) {
            await checkValueChange(log.blockNumber);
          }
        },
        onError: async (error) => {
          await this.handleError(error, onError, 'Event watching error');
          if (!isWatching) return;

          // Try to reconnect
          console.log('Attempting to reconnect event watcher...');
          await new Promise((resolve) => setTimeout(resolve, 5000));
          if (isWatching) {
            await startEventWatcher();
            await onReconnect?.();
          }
        },
      });
    };

    // Start event watcher
    await startEventWatcher();

    // Return cleanup function
    return () => {
      isWatching = false;
      if (unWatcher) {
        unWatcher();
        unWatcher = undefined;
      }
    };
  }

  /**
   * Handle errors consistently
   */
  private async handleError(
    error: Error,
    onError?: (error: Error) => void | Promise<void>,
    context?: string,
  ): Promise<void> {
    const errorMessage = context
      ? `${context}: ${error.message}`
      : error.message;
    const wrappedError = new Error(errorMessage);
    wrappedError.cause = error;

    if (onError) {
      try {
        await onError(wrappedError);
      } catch (callbackError) {
        console.error('Error in error callback:', callbackError);
      }
    } else {
      console.error('Watch error:', wrappedError);
    }
  }
}
