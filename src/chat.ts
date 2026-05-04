import { CliError, MomoClient } from './client.js';
import { loadConfig } from './config.js';
import { modelAgentId } from './model.js';

export async function sendChat(content: string) {
  const config = loadConfig();
  let response: any;
  try {
    response = await new MomoClient().request<any>('/v1/chat/completions', {
      body: {
        model: config.model,
        messages: [{ role: 'user', content }]
      }
    });
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
