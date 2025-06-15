# Contract Variable Tracer

[![npm version](https://badge.fury.io/js/contract-variable-tracer.svg)](https://badge.fury.io/js/contract-variable-tracer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-%230074c1.svg)](http://www.typescriptlang.org/)

A simple library and CLI tool for tracing smart contract variable changes over time by analyzing blockchain events and state.

## ✨ Features

- **Generic Contract Support**: Works with any smart contract and variable
- **Event-Based Tracing**: Efficiently identifies blocks where variables might change
- **Batch Processing**: Handles large block ranges with configurable batch sizes
- **Multi-Chain Support**: Ethereum, Arbitrum, Polygon, Optimism, Base

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

1. **Create a configuration file** (`cvt.config.json`):
```json
{
  "contractAddress": "Your contract address",
  "abi": [
    "function totalPooledEth() view returns (uint256)"
  ],
  "methodName": "totalPooledEth",
  "events": [
    "event Stake(address indexed receiver, uint256 tokenAmount, uint256 shareAmount)",
    "event AccrueReward(uint256 indexed amount, string indexed txnHash)"
  ],
  "fromBlock": "18000000",
  "toBlock": "18100000",
  "maxBlockRangePerQuery": "500",
  "concurrentCallBatchSize": 10,
  "outputFile": "./trace-results.json"
}
```

2. **Run the CLI**:
```bash
cvt -c 1 -r rpc-url -f ./cvt.config.json
# or just
cvt
```

### Library Usage

```typescript
import { ContractVariableTracer, ContractVariableTraceConfig } from 'contract-variable-tracer';

// Create tracer instance
const tracer = new ContractVariableTracer({chainId: 1, rpcUrl: 'xxx'});

// Configure the trace
const config: ContractVariableTraceConfig = {
  contractAddress: 'xxx',
  abi: [
    'function totalPooledEth() view returns (uint256)'
  ],
  methodName: 'totalPooledEth',
  events: [
    'event Stake(address indexed receiver, uint256 tokenAmount, uint256 shareAmount)',
    'event RequestUnbond(address indexed receiver, uint256 indexed tokenId, uint256 shareAmount, uint256 exchangeRate, uint256 batchNo)',
    'event AccrueReward(uint256 indexed amount, string indexed txnHash)'
  ],
  fromBlock: 22359679n,
  toBlock: 22689863n,
  // maxBlockRangePerQuery: 500n,
  // concurrentCallBatchSize: 10,
  // dedup: true
  // outputFile: 'xxx',
};

// Run the trace
const results = await tracer.traceVariable(config);
console.log(`Traced ${results.length} data points`);
```

## 📖 API Documentation

### ContractVariableTracer

The main class for tracing contract variables.

#### Constructor
```typescript
new ContractVariableTracer(publicClient: PublicClient)
```

#### Methods

##### `traceVariable(config: ContractVariableTraceConfig): Promise<TraceResult[]>`
Complete tracing workflow that collects relevant block numbers and traces variable values.

##### `collectBlockNumbers(config: ContractVariableTraceConfig): Promise<string[]>`
Collects block numbers where specified events occurred.

##### `traceVariableValues(config: ContractVariableTraceConfig, blockNumbers: string[]): Promise<TraceResult[]>`
Traces variable values at specific block numbers.

### Configuration Interface

```typescript
interface ContractVariableTraceConfig {
  contractAddress: Address;              // Contract address to trace
  abi: Abi;                             // Contract ABI
  methodName: string;                   // Method name to call
  methodParams?: readonly unknown[];     // Method parameters (optional)
  events: string[];                     // Events that trigger variable changes
  fromBlock: bigint;                    // Starting block number
  toBlock: bigint;                      // Ending block number
  maxBlockRangePerQuery: bigint;        // Max blocks per RPC call (usually 500)
  concurrentCallBatchSize?: number;     // Concurrent contract calls (default: 10)
  outputFile?: string;                  // Output file path (optional)
}
```

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
  abi: ['function getReserves() view returns (uint112, uint112, uint32)'],
  methodName: 'getReserves',
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
  abi: ['function getVotes(address account) view returns (uint256)'],
  methodName: 'getVotes',
  methodParams: ['0x123...'], // Specific address
  events: ['event DelegateChanged(address indexed delegator, address indexed fromDelegate, address indexed toDelegate)'],
  // ... other config
};
```

### Lending Protocol Metrics
Track interest rates, utilization, or collateral ratios:

```typescript
// Track Compound cToken exchange rate
const config = {
  contractAddress: '0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643', // cDAI
  abi: ['function exchangeRateStored() view returns (uint256)'],
  methodName: 'exchangeRateStored',
  events: ['event AccrueInterest(uint256 cashPrior, uint256 interestAccumulated, uint256 borrowIndex, uint256 totalBorrows)'],
  // ... other config
};
```

## 🛠️ CLI Reference

### Options

- `-c, --chainId <number>`: Chain ID (1=Ethereum, 42161=Arbitrum, etc.)
- `-r, --rpc <string>`: RPC URL for blockchain connection
- `-f, --config <string>`: Path to configuration JSON file
- `-v, --verbose`: Enable verbose logging
- `-h, --help`: Show help information
- `-V, --version`: Show version number

### Examples

```bash
# Ethereum mainnet
contract-tracer -c 1 -r https://eth-mainnet.alchemyapi.io/v2/YOUR-KEY -f ./config.json

# Arbitrum with verbose logging
contract-tracer -c 42161 -r https://arb1.arbitrum.io/rpc -f ./config.json --verbose

# Polygon
contract-tracer -c 137 -r https://polygon-mainnet.infura.io/v3/YOUR-KEY -f ./config.json
```

## 📁 Configuration Examples

### ERC-20 Token Balance Tracking
```json
{
  "contractAddress": "0xA0b86a33E6441C0C2C80E0514c22F18bb73c3327",
  "abi": [
    "function balanceOf(address) view returns (uint256)"
  ],
  "methodName": "balanceOf",
  "methodParams": ["0x123..."],
  "events": [
    "event Transfer(address indexed from, address indexed to, uint256 value)"
  ],
  "fromBlock": "18000000",
  "toBlock": "18100000",
  "maxBlockRangePerQuery": "500",
  "outputFile": "./token-balance-trace.json"
}
```

### Staking Protocol Rewards
```json
{
  "contractAddress": "0x456...",
  "abi": [
    "function rewardPerToken() view returns (uint256)"
  ],
  "methodName": "rewardPerToken",
  "events": [
    "event RewardAdded(uint256 reward)",
    "event Staked(address indexed user, uint256 amount)",
    "event Withdrawn(address indexed user, uint256 amount)"
  ],
  "fromBlock": "18000000",
  "toBlock": "18100000",
  "maxBlockRangePerQuery": "500",
  "concurrentCallBatchSize": 15,
  "outputFile": "./rewards-trace.json"
}
```

## ⚠️ RPC Limitations

Most RPC providers limit `eth_getLogs` queries to 500-1000 blocks. Configure `maxBlockRangePerQuery` accordingly:

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

Built with ❤️ for the Web3 community
