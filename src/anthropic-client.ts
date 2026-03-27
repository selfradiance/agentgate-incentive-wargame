// Agent 006: Shared Anthropic SDK Instance

import Anthropic from '@anthropic-ai/sdk';
import 'dotenv/config';

let client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required. Set it in .env or export it.');
    }
    client = new Anthropic();
  }
  return client;
}
