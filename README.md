# Contract Variable Tracer

[![npm version](https://badge.fury.io/js/contract-variable-tracer.svg)](https://badge.fury.io/js/contract-variable-tracer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-%230074c1.svg)](http://www.typescriptlang.org/)

A CLI tool for tracing and monitoring EVM smart contract variable changes over time by analyzing events

## ✨ Features

- **Event-Based Tracing**: Efficiently identifies blocks where variables might change
- **Batch Processing**: Handles large block ranges with configurable batch sizes
- **Multi-Chain Support**: Works with any EVM chains

## 📦 Installation

### CLI Tool (Global)
```bash
npm install -g contract-variable-tracer
```

### Library (Project Dependency)
```bash
npm install contract-variable-tracer
```

## 🚀 Quick Start

### CLI Usage

1. **Create a configuration file** (default `cvt.config.json`):
```json
{
  "contractAddress": "Your contract address",
  "methodAbi": "function totalPooledEth() view returns (uint256)",
  "methodParams": [],
  // All the events that can cause the variable to update
  "events": [
    "event Stake(address indexed receiver, uint256 tokenAmount, uint256 shareAmount)",
    "event RequestUnbond(address indexed receiver, uint256 indexed tokenId, uint256 shareAmount, uint256 exchangeRate, uint256 batchNo)",
    "event AccrueReward(uint256 indexed amount, string indexed txnHash)"
  ],
  "fromBlock": 22359679,
  "toBlock": 22364679,
  "maxBlockRangePerLogQuery": 500,
  "concurrentCallBatchSize": 10,
}
```

2. **Run the CLI**:
```bash
# trace mode
cvt
# watch mode
cvt -w

# specific more options
cvt -c 1 -r YOUR_RPC_URL -f ./cvt.config.json
```

### Library Usage

```typescript
import { ContractVariableTracer, ContractVariableTraceConfig } from 'contract-variable-tracer';

// Create tracer instance
const tracer = new ContractVariableTracer({chainId: 1, rpcUrl: 'xxx'});

// Configure the trace
const config: ContractVariableTraceConfig = {
  contractAddress: 'xxx',
  methodAbi: "function balanceOf(address) view returns (uint256)",
  methodParams: ["0x123..."],
  "events": [
    "event Transfer(address indexed from, address indexed to, uint256 value)"
  ],
  fromBlock: 22359679,
  toBlock: 22689863,
};

// Run the trace
const results = await tracer.trace(config);
console.log(`Traced ${results.length} data points`);

// Watch/Monitoring mode
const cleanup = await tracer.watch(
  config,
  (prev, curr) => {
    console.log(`Value: ${prev?.value || 'N/A'} → ${curr.value}`);
  }
);

// Monitoring with filtering and error handling
const cleanup = await tracer.watch(
  config,
  async (prev, curr) => {
    await sendAlert(`Critical change detected: ${curr.value}`);
  },
  {
    filter: (prev, curr) => {
      // Only alert on significant changes (>5%)
      if (!prev) return true;
      const change = Math.abs(Number(curr.value) - Number(prev.value));
      return change / Number(prev.value) > 0.05;
    },
    onError: (error) => console.error('Monitoring failed:', error),
    onReconnect: () => console.log('Reconnected successfully')
  }
);

// Stop monitoring when done
cleanup();
```

## 📖 API Documentation

### ContractVariableTracer

The main class for tracing contract variables.

#### Constructor
```typescript
new ContractVariableTracer(opts?: { chainId?: number, rpcUrl?: string })
```
### Configuration Interface

```typescript
interface ContractVariableTraceConfig {
  contractAddress: Address;             // Contract address to trace
  methodAbi: string;                    // Contract ABI
  methodParams?:  unknown[];            // Method parameters (optional)
  events: string[];                     // Events that trigger variable changes
  fromBlock: number;                    // Starting block number
  toBlock: number;                      // Ending block number
  maxBlockRangePerLogQuery:  number;    // Max blocks per RPC call (usually 500)
  concurrentCallBatchSize?: number;     // Concurrent contract calls (default: 10)
}
```

#### Methods

##### `trace`
```ts
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
): Promise<TraceResult[]>;
```
Traces a contract variable over time with optional progress reporting.Can either generate block numbers automatically or use provided block numbers.

##### `watch`
```ts
public async watch(
  config: ContractVariableTraceConfig,
  onNewValue: OnNewValueCallback,
  opts: WatchOptions = {},
): Promise<() => void>;
```
Continuously monitors a smart contract variable for changes by watching for relevant events.
This method establishes real-time monitoring of a contract variable by:

1. Setting up event listeners for specified events that may trigger variable changes
2. Reading the current variable value when events are detected
3. Comparing with the previous value to detect actual changes
4. Invoking callbacks only when the value has actually changed

##### `collectBlockNumbers`
```ts
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
): Promise<string[]>;
```
Collects block numbers where specified events occurred.


### Result Interface

```typescript
interface TraceResult {
  blockNumber: string;  // Block number where the value was read
  value: string;        // Variable value at that block
}
```

## 🌟 Use Cases

### DeFi Protocol Monitoring
Track key metrics like total value locked (TVL), exchange rates, or pool balances:

```typescript
// Track Uniswap pool reserves
const config = {
  contractAddress: '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc', // USDC-ETH pool
  methodAbi: 'function getReserves() view returns (uint112, uint112, uint32)',
  events: ['event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)'],
  // ... other config
};
```

### Governance Token Analysis
Monitor voting power or delegation changes:

```typescript
// Track delegated votes
const config = {
  contractAddress: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', // UNI token
  methodAbi: 'function getVotes(address account) view returns (uint256)',
  methodParams: ['0x123...'], // Specific address
  events: ['event DelegateChanged(address indexed delegator, address indexed fromDelegate, address indexed toDelegate)'],
  // ... other config
};
```

## 🛠️ CLI Reference

### Options

- `-c, --chainId <number>`: Chain ID (1=Ethereum, 42161=Arbitrum, etc.)
- `-r, --rpc <string>`: RPC URL for blockchain connection
- `-o, --output <string>`: Output file path. If not specified, results are written to stdout
- `-f, --config <string>`: Path to configuration JSON file
- `-w, --watch` : Enable watch mode for real-time monitoring
- `-v, --verbose`: Enable verbose logging
- `-h, --help`: Show help information
- `-V, --version`: Show version number

## 📁 Examples

### ERC-20 Token Balance Tracking
```json
{
  "contractAddress": "0xA0b86a33E6441C0C2C80E0514c22F18bb73c3327",
  "methodAbi":  "function balanceOf(address) view returns (uint256)",
  "methodParams": ["0x123..."],
  "events": [
    "event Transfer(address indexed from, address indexed to, uint256 value)"
  ],
  "fromBlock": "xxx",
  "toBlock": "xxx",
}
```

### Staking Protocol Rewards
```json
{
  "contractAddress": "0x456...",
  "methodAbi": "function rewardPerToken() view returns (uint256)",
  "methodName": "rewardPerToken",
  "events": [
    "event RewardAdded(uint256 reward)",
    "event Staked(address indexed user, uint256 amount)",
    "event Withdrawn(address indexed user, uint256 amount)"
  ],
  "fromBlock": "xxx",
  "toBlock": "xxx",
}
```

## ⚠️ RPC Limitations

Most RPC providers limit `eth_getLogs` queries to 500-1000 blocks. Configure `maxBlockRangePerLogQuery` accordingly:

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

Built with ❤️ for the Web3 community
