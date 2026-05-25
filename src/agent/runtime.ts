import { CliError, MomoClient } from '../client.js';
import { loadConfig } from '../config.js';
import type { ResolvedAgentConfig } from '../config.js';
import { modelAgentId } from '../model.js';
import { executeToolCall, momoTools } from '../tools.js';
import type { ConfirmTool } from '../tools.js';
import { AgentMemory } from './memory.js';
import { loadMarketTradingSkill, loadOpenClawA2aPublishingSkill, loadRemoteServicePublishingSkill } from './skills.js';
import { estimateTokens, makeId } from './token.js';
import type { AgentRunInput, AgentRunResult } from './types.js';

function messageContent(message: any) {
  return typeof message?.content === 'string' ? message.content : JSON.stringify(message?.content ?? '');
}

function usageFromResponse(response: any) {
  const usage = response?.usage || {};
  return {
    prompt_tokens: Number(usage.prompt_tokens || 0),
    completion_tokens: Number(usage.completion_tokens || 0),
    total_tokens: Number(usage.total_tokens || 0)
  };
}

function addUsage(left: AgentRunResult['usage'], right: AgentRunResult['usage']) {
  left.prompt_tokens += right.prompt_tokens;
  left.completion_tokens += right.completion_tokens;
  left.total_tokens += right.total_tokens;
}

function ensureUsage(usage: AgentRunResult['usage'], messages: unknown, content: string) {
  if (usage.total_tokens > 0) return usage;
  const promptTokens = estimateTokens(messages);
  const completionTokens = estimateTokens(content);
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens
  };
}

type AgentWithCapabilities = Pick<ResolvedAgentConfig, 'capabilities'>;

function selectedCapability(agent: AgentWithCapabilities, capabilityId?: string) {
  if (!capabilityId) return undefined;
  return agent.capabilities.find((capability) => capability.enabled !== false && capability.id === capabilityId);
}

function renderCapabilitySkillContext(agent: AgentWithCapabilities, capabilityId?: string) {
  const capability = selectedCapability(agent, capabilityId);
  if (!capabilityId) return '';
  if (!capability) {
    throw new Error(`Unknown or disabled capability_id: ${capabilityId}`);
  }
  if (!capability.skill?.id || !capability.skill.instructions?.trim()) {
    throw new Error(`Capability ${capabilityId} is not bound to a local skill with instructions.`);
  }
  return [
    'Current A2A capability and local skill binding:',
    `- capability_id: ${capability.id}`,
    `- capability_name: ${capability.name}`,
    capability.description ? `- capability_description: ${capability.description}` : '',
    `- local_skill_id: ${capability.skill.id}`,
    capability.skill.name ? `- local_skill_name: ${capability.skill.name}` : '',
    capability.skill.description ? `- local_skill_description: ${capability.skill.description}` : '',
    `- input_modes: ${(capability.inputModes || ['text/plain', 'application/json']).join(', ')}`,
    `- output_modes: ${(capability.outputModes || ['text/plain']).join(', ')}`,
    '',
    'Local skill instructions:',
    capability.skill.instructions
  ].filter(Boolean).join('\n');
}

export class AgentRuntime {
  private memory = new AgentMemory();

  constructor(private confirmTool?: ConfirmTool) {}

  private modelAuthToken(_input: AgentRunInput) {
    // Both local and remote service modes run the agent's internal model/tool work
    // with the local deployment account. Remote callers pay only the fixed
    // result price for the selected capability after successful completion.
    return undefined;
  }

  private async createPlan(input: AgentRunInput, summary: string, index: string, marketTradingSkill: string, remoteServicePublishingSkill: string, openClawA2aPublishingSkill: string, capabilitySkillContext: string, authToken?: string) {
    const config = loadConfig();
    const response = await new MomoClient().request<any>('/v1/chat/completions', {
      authToken,
      body: {
        model: config.model,
        messages: [
          {
            role: 'system',
            content: [
              'You are the planning layer for a ReAct-style MOMOAI market agent.',
              'Before any action, produce a concise executable plan.',
              'Do not call tools. Do not answer the user yet.',
              'Include whether external tools or child agents are likely needed.',
              '',
              capabilitySkillContext || 'No explicit A2A capability skill is selected for this request.',
              '',
              'MOMOAI market trading skill:',
              marketTradingSkill,
              '',
              'MOMOAI remote service publishing skill:',
              remoteServicePublishingSkill,
              '',
              'OpenClaw A2A publishing skill:',
              openClawA2aPublishingSkill
            ].join('\n')
          },
          {
            role: 'user',
            content: [
              'Memory index:',
              index || '(empty)',
              '',
              'Abstract memory for this context:',
              summary || '(empty)',
              '',
              'New user request:',
              input.content
            ].join('\n')
          }
        ]
      }
    });

    const text = response.choices?.[0]?.message?.content;
    return {
      id: makeId('plan'),
      text: typeof text === 'string' && text.trim()
        ? text.trim()
        : 'Plan: understand the user request, use tools only if needed, then answer concisely.',
      usage: usageFromResponse(response)
    };
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const config = loadConfig();
    const agent = input.agent || config.agent;
    const mode = input.mode || agent.mode;
    const capabilitySkillContext = renderCapabilitySkillContext(agent, input.capabilityId);
    const contextId = input.contextId || 'default';
    const snapshot = this.memory.load(contextId);
    const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    const modelAuthToken = this.modelAuthToken(input);
    const marketTradingSkill = loadMarketTradingSkill();
    const remoteServicePublishingSkill = loadRemoteServicePublishingSkill();
    const openClawA2aPublishingSkill = loadOpenClawA2aPublishingSkill();
    const plan = await this.createPlan(input, snapshot.summary, snapshot.index, marketTradingSkill, remoteServicePublishingSkill, openClawA2aPublishingSkill, capabilitySkillContext, modelAuthToken);
    addUsage(usage, plan.usage);

    const systemMessage = {
      role: 'system',
      content: [
        agent.description,
        '',
        'Operating rules:',
        '- Follow the approved plan before acting.',
        '- Use ReAct behavior internally: plan, act, observe, answer.',
        '- Tool calls and child agent calls are actions and must use the current plan id.',
        mode === 'remote_service'
          ? '- Remote service execution is result-priced by capability. Do not expose internal model usage as caller billing.'
          : '- Local execution has no CLI agent fee. Model and child agent calls use the local user account.',
        ...(input.capabilityId ? [`- Current capability id: ${input.capabilityId}`] : []),
        '',
        capabilitySkillContext || 'No explicit A2A capability skill is selected for this request.',
        '',
        'MOMOAI market trading skill:',
        marketTradingSkill,
        '',
        'MOMOAI remote service publishing skill:',
        remoteServicePublishingSkill,
        '',
        'OpenClaw A2A publishing skill:',
        openClawA2aPublishingSkill,
        '',
        `Current plan id: ${plan.id}`,
        plan.text,
        '',
        'Memory index:',
        snapshot.index || '(empty)',
        '',
        'Abstract memory:',
        snapshot.summary || '(empty)'
      ].join('\n')
    };

    const messages: any[] = [
      ...snapshot.messages,
      { role: 'user', content: input.content }
    ];
    const requestMessages: any[] = [systemMessage, ...messages];
    let response: any;

    try {
      for (let round = 0; round < 8; round += 1) {
        response = await new MomoClient().request<any>('/v1/chat/completions', {
          authToken: modelAuthToken,
          body: {
            model: config.model,
            messages: requestMessages,
            tools: momoTools,
            tool_choice: 'auto'
          }
        });

        addUsage(usage, usageFromResponse(response));
        const message = response.choices?.[0]?.message;
        const toolCalls = message?.tool_calls || [];
        if (!toolCalls.length) break;

        requestMessages.push(message);
        messages.push(message);
        for (const toolCall of toolCalls) {
          const name = toolCall.function?.name;
          const result = await executeToolCall(name, toolCall.function?.arguments, this.confirmTool, {
            planId: plan.id,
            authToken: undefined
          });
          const toolMessage = {
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result)
          };
          requestMessages.push(toolMessage);
          messages.push(toolMessage);
        }
      }
    } catch (error) {
      if (error instanceof CliError) {
        const agentId = modelAgentId(config.model);
        const isDefaultModel = config.defaultModels.some((model) => modelAgentId(model) === agentId);
        if (agentId && isDefaultModel && !input.invocationToken) {
          error.message = `${error.message}\nYou may need to buy tokens: $exchange buy ${agentId} --tokens <n> --max-price <price>`;
        }
      }
      throw error;
    }

    const finalMessage = response?.choices?.[0]?.message;
    const content = messageContent(finalMessage);
    messages.push({ role: 'assistant', content });

    const finalUsage = ensureUsage(usage, requestMessages, content);
    const detail = [
      `Plan: ${plan.id}`,
      '',
      plan.text,
      '',
      `User: ${input.content}`,
      '',
      `Assistant: ${content}`,
      '',
      `Usage: ${JSON.stringify(finalUsage)}`
    ].join('\n');
    await this.memory.saveRun(contextId, messages, detail, modelAuthToken);

    return {
      contextId,
      content,
      plan: input.showPlan ? { id: plan.id, text: plan.text } : undefined,
      usage: finalUsage
    };
  }
}
