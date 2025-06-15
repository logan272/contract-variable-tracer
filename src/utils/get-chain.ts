import type { Chain } from 'viem';
import * as chains from 'viem/chains';

/**
 * Gets the chain object for the given chain id.
 * @param chainId - Chain id of the target EVM chain.
 * @returns Viem's chain object.
 */
export function getChain(chainId: number): Chain {
  let chain: Chain | undefined;

  for (const c of Object.values(chains)) {
    if ('id' in c) {
      if (c.id === chainId) {
        chain = c;
      }
    }
  }

  if (!chain) {
    throw new Error(`Chain with id ${chainId} not found`);
  }

  return chain;
}
