import { getTenantContext } from '../../core/src/index.js';
import type { ToolRegistry } from './index.js';

export type LLMProvider = 'mock' | 'claude' | 'openai' | 'gemini';

export interface LLMGatewayConfig {
  provider?: LLMProvider;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  fallbackProviders?: LLMProvider[];
}

export interface LLMToolCall {
  toolName: string;
  arguments: Record<string, any>;
  idempotencyKey?: string;
}

export interface LLMDecision {
  action: 'reply' | 'tool_call' | 'handoff';
  provider: string;
  model: string;
  reasoning: string;
  replyText?: string;
  toolCalls?: LLMToolCall[];
}

interface LLMGatewayRequest {
  conversationId: string;
  contactId: string;
  message: string;
  persona: string;
  systemPrompt?: string;
}

export class LLMGateway {
  constructor(
    private readonly tools: ToolRegistry,
    private readonly config: LLMGatewayConfig = {}
  ) {}

  public async decide(params: LLMGatewayRequest): Promise<LLMDecision> {
    const provider = this.resolveProvider();
    const model = this.resolveModel(provider);
    const message = params.message.trim();

    if (!message) {
      return {
        action: 'reply',
        provider,
        model,
        reasoning: 'Empty message; no tool call required.',
        replyText: 'สวัสดีค่ะ โปรดระบุสิ่งที่ต้องการให้พี่ช่วยดูข้อมูลได้เลยนะคะ',
      };
    }

    if (this.isHumanEscalation(message)) {
      return {
        action: 'handoff',
        provider,
        model,
        reasoning: 'Customer explicitly asked to speak with a human agent.',
        replyText: 'รับเรื่องส่งต่อให้เจ้าหน้าที่ฝ่ายบริการเรียบร้อยแล้วค่ะ',
        toolCalls: [
          {
            toolName: 'handoff_to_human',
            arguments: {
              conversationId: params.conversationId,
              reason: 'User explicitly requested human assistance.',
              urgency: 'normal',
            },
            idempotencyKey: `gateway_handoff_${params.conversationId}_${Date.now()}`,
          },
        ],
      };
    }

    const toolCalls = this.buildToolCalls(message, params);
    if (toolCalls.length > 0) {
      const providerDecision = await this.callRemoteProvider({
        ...params,
        provider,
        model,
      });

      if (providerDecision && providerDecision.action === 'tool_call' && providerDecision.toolCalls?.length) {
        return providerDecision;
      }

      return {
        action: 'tool_call',
        provider,
        model,
        reasoning: 'The gateway matched a domain tool using the message semantics.',
        toolCalls,
      };
    }

    return {
      action: 'reply',
      provider,
      model,
      reasoning: 'No structured tool match detected; respond conversationally.',
      replyText: `สวัสดีค่ะ ${params.persona} พร้อมช่วยตอบข้อมูลด้านที่ดินและการผ่อนชำระให้ค่ะ หากต้องการข้อมูลราคา หรือแปลงที่เหมาะสม โปรดระบุงบประมาณและทำเลที่ต้องการได้เลยนะคะ`,
    };
  }

  public async executeToolPlan(toolCall: LLMToolCall): Promise<any> {
    const tool = this.tools.get(toolCall.toolName);
    if (!tool) {
      throw new Error(`Tool '${toolCall.toolName}' not found in registry`);
    }

    const ctx = getTenantContext();
    if (!ctx?.tenantId) {
      throw new Error('Tenant context is required before executing an LLM tool call');
    }

    return this.tools.execute(toolCall.toolName, toolCall.arguments, toolCall.idempotencyKey ?? this.defaultIdempotencyKey(toolCall));
  }

  public buildToolSchema(): Array<{ name: string; description: string; parameters: Record<string, any> }> {
    return [
      {
        name: 'search_properties',
        description: 'ค้นหาแปลงที่ดินตามงบประมาณ ทำเล และสถานะ',
        parameters: {
          type: 'object',
          properties: {
            maxPrice: { type: 'number' },
            location: { type: 'string' },
            status: { type: 'string' },
          },
          required: [],
        },
      },
      {
        name: 'create_lead',
        description: 'บันทึก Lead ใหม่จากการสนทนา',
        parameters: {
          type: 'object',
          properties: {
            contactId: { type: 'string' },
            conversationId: { type: 'string' },
            interestZone: { type: 'string' },
            budgetMax: { type: 'number' },
            phone: { type: 'string' },
            notes: { type: 'string' },
          },
          required: ['contactId', 'conversationId'],
        },
      },
      {
        name: 'handoff_to_human',
        description: 'ส่งต่อให้เจ้าหน้าที่สื่อสารกับลูกค้า',
        parameters: {
          type: 'object',
          properties: {
            conversationId: { type: 'string' },
            reason: { type: 'string' },
            urgency: { type: 'string', enum: ['normal', 'high', 'emergency'] },
          },
          required: ['conversationId', 'reason'],
        },
      },
    ];
  }

  private resolveProvider(): LLMProvider {
    return this.config.provider ?? ((process.env.CHATTO_LLM_PROVIDER as LLMProvider) ?? 'mock');
  }

  private resolveModel(provider: LLMProvider): string {
    return this.config.model ?? process.env.CHATTO_LLM_MODEL ?? this.defaultModel(provider);
  }

  private defaultModel(provider: LLMProvider): string {
    switch (provider) {
      case 'claude':
        return 'claude-3-5-sonnet-20241022';
      case 'openai':
        return 'gpt-4o-mini';
      case 'gemini':
        return 'gemini-2.0-flash';
      default:
        return 'mock-tool-selector';
    }
  }

  private isHumanEscalation(message: string): boolean {
    return /(คุยกับคน|คุยกับแอดมิน|ขอคุยกับมนุษย์|ติดต่อเจ้าหน้าที่|เจ้าหน้าที่|แอดมินหน่อย)/i.test(message);
  }

  private buildToolCalls(message: string, params: LLMGatewayRequest): LLMToolCall[] {
    const lower = message.toLowerCase();
    const calls: LLMToolCall[] = [];

    const budgetMax = this.detectBudget(message);
    const location = this.detectLocation(message);
    const phone = this.detectPhone(message);

    if (/ที่ดิน|แปลง|โครงการ|ราคา|งบ|ผ่อน|วิวเขา|โฉนด|กาญ|สุพรรณ/.test(message)) {
      calls.push({
        toolName: 'search_properties',
        arguments: {
          maxPrice: budgetMax,
          location,
          status: 'available',
        },
        idempotencyKey: `gateway_search_${params.conversationId}_${message.slice(0, 32)}`,
      });
    }

    if (phone) {
      calls.push({
        toolName: 'create_lead',
        arguments: {
          contactId: params.contactId,
          conversationId: params.conversationId,
          interestZone: location ?? (lower.includes('กาญ') ? 'กาญจนบุรี' : lower.includes('สุพรรณ') ? 'สุพรรณบุรี' : 'วิวเขา'),
          budgetMax,
          phone,
          notes: `ลูกค้าระบุข้อมูลในแชท: "${message}"`,
        },
        idempotencyKey: `gateway_lead_${params.conversationId}_${phone}`,
      });
    }

    if ((/คน|แอดมิน|เจ้าหน้าที่/.test(message) || /คุย/.test(message)) && !calls.length) {
      calls.push({
        toolName: 'handoff_to_human',
        arguments: {
          conversationId: params.conversationId,
          reason: 'Customer requested human assistance.',
          urgency: 'normal',
        },
        idempotencyKey: `gateway_handoff_${params.conversationId}_${Date.now()}`,
      });
    }

    return calls;
  }

  private detectBudget(message: string): number | undefined {
    const text = message.replace(/,/g, '');
    if (/(?:5\s*แสน|500000|500,000)/.test(text)) return 500000;
    if (/(?:3\s*แสน|300000|300,000)/.test(text)) return 300000;
    if (/(?:2\s*แสน|200000|200,000)/.test(text)) return 200000;
    if (/(?:1\s*ล้าน|1,000,000|1000000)/.test(text)) return 1000000;
    const match = text.match(/\b(\d+(?:\.\d+)?)\s*(?:ล้าน|แสน|บาท)\b/i);
    if (!match) return undefined;
    const number = Number.parseFloat(match[1]);
    const unit = match[0].toLowerCase();
    if (unit.includes('ล้าน')) return number * 1000000;
    if (unit.includes('แสน')) return number * 100000;
    return number;
  }

  private detectLocation(message: string): string | undefined {
    if (/สุพรรณ/.test(message)) return 'สุพรรณบุรี';
    if (/กาญ/.test(message)) return 'กาญจนบุรี';
    return undefined;
  }

  private detectPhone(message: string): string | undefined {
    const match = message.match(/0[689]\d{1}[-\s]?\d{3}[-\s]?\d{4}|0[689]\d{8}/);
    return match ? match[0].replace(/[-\s]/g, '') : undefined;
  }

  private async callRemoteProvider(
    params: LLMGatewayRequest & { provider: LLMProvider; model: string }
  ): Promise<LLMDecision | null> {
    const provider = params.provider;
    const apiKey = this.config.apiKey ?? process.env.CHATTO_LLM_API_KEY;
    if (provider === 'mock' || !apiKey) {
      return null;
    }

    try {
      const baseUrl = this.config.baseUrl ?? process.env.CHATTO_LLM_BASE_URL;
      const requestBody = {
        model: params.model,
        messages: [
          { role: 'system', content: params.systemPrompt ?? 'You are Chatto Bot.' },
          { role: 'user', content: params.message },
        ],
        tools: this.buildToolSchema(),
      };

      const endpoint = this.resolveProviderEndpoint(provider, baseUrl);
      if (!endpoint) {
        return null;
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        return null;
      }

      const json = await response.json();
      return this.parseProviderResponse(json, provider, params.model, params.conversationId);
    } catch {
      return null;
    }
  }

  private resolveProviderEndpoint(provider: LLMProvider, baseUrl?: string): string | null {
    if (provider === 'claude') {
      return `${baseUrl ?? 'https://api.anthropic.com'}/v1/messages`;
    }
    if (provider === 'openai') {
      return `${baseUrl ?? 'https://api.openai.com'}/v1/chat/completions`;
    }
    if (provider === 'gemini') {
      return `${baseUrl ?? 'https://generativelanguage.googleapis.com'}/v1beta/models/${this.resolveModel(provider)}:generateContent?key=${process.env.CHATTO_LLM_API_KEY ?? this.config.apiKey ?? ''}`;
    }
    return null;
  }

  private parseProviderResponse(
    json: any,
    provider: LLMProvider,
    model: string,
    conversationId: string
  ): LLMDecision | null {
    if (provider === 'claude') {
      const content = json?.content ?? [];
      const toolUse = content.find((entry: any) => entry.type === 'tool_use');
      if (toolUse) {
        return {
          action: 'tool_call',
          provider,
          model,
          reasoning: 'LLM selected a tool via Anthropic tool use.',
          toolCalls: [
            {
              toolName: toolUse.name,
              arguments: toolUse.input ?? {},
              idempotencyKey: `gateway_provider_${conversationId}_${toolUse.name}`,
            },
          ],
        };
      }
    }

    if (provider === 'openai') {
      const message = json?.choices?.[0]?.message;
      const toolCalls = message?.tool_calls ?? [];
      if (toolCalls.length > 0) {
        return {
          action: 'tool_call',
          provider,
          model,
          reasoning: 'LLM selected a tool via OpenAI function calling.',
          toolCalls: toolCalls.map((toolCall: any) => ({
            toolName: toolCall.function?.name ?? 'search_properties',
            arguments: JSON.parse(toolCall.function?.arguments ?? '{}'),
            idempotencyKey: `gateway_provider_${conversationId}_${toolCall.function?.name ?? 'tool'}`,
          })),
        };
      }
    }

    if (provider === 'gemini') {
      const candidate = json?.candidates?.[0]?.content?.parts ?? [];
      const toolCallPart = candidate.find((part: any) => part.functionCall);
      if (toolCallPart?.functionCall) {
        return {
          action: 'tool_call',
          provider,
          model,
          reasoning: 'LLM selected a tool via Gemini function calling.',
          toolCalls: [
            {
              toolName: toolCallPart.functionCall.name,
              arguments: toolCallPart.functionCall.args ?? {},
              idempotencyKey: `gateway_provider_${conversationId}_${toolCallPart.functionCall.name}`,
            },
          ],
        };
      }
    }

    return null;
  }

  private defaultIdempotencyKey(toolCall: LLMToolCall): string {
    return `gateway_${toolCall.toolName}_${toolCall.arguments.conversationId ?? 'global'}_${JSON.stringify(toolCall.arguments)}`;
  }
}
