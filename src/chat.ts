import { AgentRuntime } from './agent/runtime.js';
import type { ConfirmTool } from './tools.js';

export async function sendChat(content: string, confirmTool?: ConfirmTool) {
  const result = await new AgentRuntime(confirmTool).run({ content });
  console.log(result.content);
}
