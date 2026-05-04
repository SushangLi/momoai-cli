import { CliError, MomoClient } from './client.js';
import { loadConfig } from './config.js';
import { modelAgentId } from './model.js';
import { executeToolCall, momoTools } from './tools.js';
import type { ConfirmTool } from './tools.js';

export async function sendChat(content: string, confirmTool?: ConfirmTool) {
  const config = loadConfig();
  let response: any;
  const messages: any[] = [{ role: 'user', content }];
  try {
    for (let round = 0; round < 8; round += 1) {
      response = await new MomoClient().request<any>('/v1/chat/completions', {
        body: {
          model: config.model,
          messages,
          tools: momoTools,
          tool_choice: 'auto'
        }
      });

      const message = response.choices?.[0]?.message;
      const toolCalls = message?.tool_calls || [];
      if (!toolCalls.length) break;

      messages.push(message);
      for (const toolCall of toolCalls) {
        const name = toolCall.function?.name;
        const result = await executeToolCall(name, toolCall.function?.arguments, confirmTool);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result)
        });
      }
    }
  } catch (error) {
    if (error instanceof CliError) {
      const agentId = modelAgentId(config.model);
      const isDefaultModel = config.defaultModels.some((model) => modelAgentId(model) === agentId);
      if (agentId && isDefaultModel) {
        error.message = `${error.message}\nYou may need to buy tokens: $exchange buy ${agentId} --tokens <n> --max-price <price>`;
      }
    }
    throw error;
  }

  const message = response.choices?.[0]?.message?.content;
  if (typeof message === 'string') {
    console.log(message);
    return;
  }

  console.log(JSON.stringify(response, null, 2));
}
