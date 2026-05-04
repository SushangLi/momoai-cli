import { loadConfig, saveConfig } from '../config.js';
import { table } from '../format.js';
import { balanceModels, mergedModels, modelAgentId, normalizeModel } from '../model.js';
import type { ParsedCommand } from '../parser.js';

export async function modelCommand(command: ParsedCommand) {
  const config = loadConfig();
  const nextModel = command.args[0];

  if (command.args.length > 1) {
    throw new Error('Usage: $model [model]');
  }

  const normalized = nextModel ? normalizeModel(nextModel) : undefined;
  const agentId = normalized ? modelAgentId(normalized) : undefined;
  if (normalized && !agentId) {
    throw new Error('Usage: $model <momo_agent_id>');
  }

  let balanceError: unknown;
  const balances = await balanceModels().catch((error) => {
    balanceError = error;
    return [];
  });
  const models = mergedModels(config.defaultModels, balances);

  if (!nextModel) {
    console.log(`current model: ${config.model}`);
    console.log('change model: $model <model>');
    console.log('examples: $model 237 | $model momo_237');
    if (models.length) {
      table(models.map((model) => ({ ...model })));
    } else {
      console.log('models: (none)');
    }
    if (balanceError) {
      const message = balanceError instanceof Error ? balanceError.message : String(balanceError);
      console.log(`balance models unavailable: ${message}`);
    }
    return;
  }

  const allowed = models.some((listedModel) => listedModel.agent === agentId);
  if (!allowed && balanceError) throw balanceError;
  if (!allowed) {
    throw new Error(`Model ${normalized} is not in default models or your balance list. Run $model to see available models.`);
  }

  saveConfig({ model: normalized });
  console.log(`model: ${normalized}`);
}
