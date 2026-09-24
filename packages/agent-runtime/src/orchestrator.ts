import { getTenantContext } from '../../core/src/index.js';
import { CrmService, Message, Conversation } from '../../crm/src/index.js';
import { AuditService, AnalyticsService } from '../../audit-analytics/src/index.js';
import { KnowledgeBaseService, ToolRegistry, PolicyEngine, Citation } from './index.js';
import { AgentPromptService } from './prompt-service.js';

export interface ProcessMessageResult {
  status: 'replied' | 'handed_off' | 'bot_paused_ignored';
  replyMessage?: Message;
  toolCallsExecuted?: string[];
  citations?: Citation[];
  botPaused?: boolean;
}

export class AgentOrchestrator {
  constructor(
    private crm: CrmService,
    private kb: KnowledgeBaseService,
    private tools: ToolRegistry,
    private audit: AuditService,
    private analytics: AnalyticsService,
    private promptService?: AgentPromptService
  ) {}

  public async processInboundMessage(params: {
    conversationId: string;
    contactId: string;
    messageContent: string;
    messageId: string;
  }): Promise<ProcessMessageResult> {
    const ctx = getTenantContext();
    const activePrompt = this.promptService?.getActivePrompt();
    const persona = activePrompt?.personaName || 'น้อง Chatto';

    const conversation = this.crm.getConversation(params.conversationId);
    if (!conversation) {
      throw new Error(`Conversation '${params.conversationId}' not found`);
    }

    // Record incoming message in CRM
    const customerMsg = this.crm.addMessage({
      conversationId: params.conversationId,
      senderType: 'customer',
      content: params.messageContent,
    });

    // Record funnel analytics
    this.analytics.recordEvent({
      eventName: 'funnel.message_received',
      contactId: params.contactId,
      conversationId: params.conversationId,
      properties: { textLength: params.messageContent.length },
    });

    // 1. Check if bot is paused (human handoff active)
    if (conversation.botPaused) {
      this.audit.logAudit({
        action: 'message.ignored_during_bot_pause',
        resourceType: 'conversation',
        resourceId: params.conversationId,
        payload: { content: params.messageContent },
      });
      return {
        status: 'bot_paused_ignored',
        botPaused: true,
      };
    }

    // 2. Policy Engine Safety Checks
    const policyResult = PolicyEngine.evaluateMessage(params.messageContent);

    if (policyResult.isEmergency) {
      // Emergency response
      await this.tools.execute(
        'handoff_to_human',
        {
          conversationId: params.conversationId,
          reason: `🚨 ฉุกเฉิน: ${policyResult.reason}`,
          urgency: 'emergency',
        },
        `emergency_${params.conversationId}_${params.messageId}`
      );

      const replyText =
        '🚨 ได้รับแจ้งเหตุฉุกเฉินแล้วค่ะ! เพื่อความปลอดภัยสูงสุด กรุณาหลีกเลี่ยงพื้นที่เสี่ยงและติดต่อสายด่วนฉุกเฉินทันที ขณะนี้ระบบได้ส่งต่อข้อความเร่งด่วนนี้ไปยังผู้จัดการ The Hill Land แล้วค่ะ';

      const reply = this.crm.addMessage({
        conversationId: params.conversationId,
        senderType: 'agent_ai',
        content: replyText,
      });

      return {
        status: 'handed_off',
        replyMessage: reply,
        toolCallsExecuted: ['handoff_to_human'],
        botPaused: true,
      };
    }

    if (policyResult.isHumanRequest) {
      // Direct Human Request
      await this.tools.execute(
        'handoff_to_human',
        {
          conversationId: params.conversationId,
          reason: policyResult.reason || 'User requested human agent',
          urgency: 'normal',
        },
        `handoff_${params.conversationId}_${params.messageId}`
      );

      const replyText =
        'รับเรื่องส่งต่อให้เจ้าหน้าที่ฝ่ายบริการ The Hill Land เรียบร้อยแล้วค่ะ เจ้าหน้าที่จะเข้ามาดูแลและติดต่อกลับทางช่องทางนี้โดยเร็วที่สุดนะคะ (ระบบ AI หยุดการตอบอัตโนมัติชั่วคราวเพื่อให้ทีมงานดูแลต่อค่ะ)';

      const reply = this.crm.addMessage({
        conversationId: params.conversationId,
        senderType: 'agent_ai',
        content: replyText,
      });

      return {
        status: 'handed_off',
        replyMessage: reply,
        toolCallsExecuted: ['handoff_to_human'],
        botPaused: true,
      };
    }

    // 3. Search Knowledge Base
    const kbMatches = this.kb.search(params.messageContent);
    const citations: Citation[] = kbMatches.map((k) => ({
      sourceId: k.sourceId,
      title: k.title,
      snippet: k.content.slice(0, 120) + '...',
      effectiveDate: k.effectiveDate,
    }));

    // 4. Intent Detection: Property Search & Lead Capture
    const toolCallsExecuted: string[] = [];
    const text = params.messageContent;

    // Detect phone number (e.g. 0812345678 or 081-234-5678 or 09xxxxxxxx)
    const phoneMatch = text.match(/0[689]\d{1}[-\s]?\d{3}[-\s]?\d{4}|0[689]\d{8}/);
    const phone = phoneMatch ? phoneMatch[0].replace(/[-\s]/g, '') : undefined;

    // Detect budget intent
    let maxBudget: number | undefined;
    if (text.includes('5 แสน') || text.includes('500,000') || text.includes('500000')) {
      maxBudget = 500000;
    } else if (text.includes('3 แสน') || text.includes('300,000') || text.includes('300000')) {
      maxBudget = 300000;
    } else if (text.includes('2 แสน') || text.includes('200,000') || text.includes('200000')) {
      maxBudget = 200000;
    } else if (text.includes('1 ล้าน') || text.includes('1,000,000')) {
      maxBudget = 1000000;
    }

    // If phone number is provided, qualify and capture Lead
    if (phone) {
      toolCallsExecuted.push('create_lead');
      const lead = await this.tools.execute(
        'create_lead',
        {
          contactId: params.contactId,
          conversationId: params.conversationId,
          interestZone: text.includes('กาญ') ? 'กาญจนบุรี' : text.includes('สุพรรณ') ? 'สุพรรณบุรี' : 'วิวเขา',
          budgetMax: maxBudget,
          phone: phone,
          notes: `ลูกค้าระบุข้อมูลในแชท: "${text}"`,
        },
        `lead_${params.conversationId}_${phone}`
      );

      const replyContent = `บันทึกข้อมูลความสนใจของคุณเรียบร้อยแล้วค่ะ (รหัส Lead: #${lead.id})\n\nเจ้าหน้าที่ฝ่ายขาย The Hill Land จะติดต่อกลับทางเบอร์โทร ${phone} เพื่อส่งผังแปลงโฉนดและนัดหมายวันเข้าชมโครงการจริงนะคะ\n\nหากต้องการข้อมูลเพิ่มเติม สามารถสอบถาม${persona}ได้ตลอดเวลาค่ะ`;

      const reply = this.crm.addMessage({
        conversationId: params.conversationId,
        senderType: 'agent_ai',
        content: replyContent,
        citations,
      });

      return {
        status: 'replied',
        replyMessage: reply,
        toolCallsExecuted,
        citations,
      };
    }

    // Property Search Intent
    const isAskingForProperties =
      text.includes('ที่ดิน') ||
      text.includes('แปลง') ||
      text.includes('โครงการ') ||
      text.includes('ราคา') ||
      text.includes('งบ') ||
      text.includes('วิวเขา') ||
      text.includes('ผ่อน');

    if (isAskingForProperties) {
      toolCallsExecuted.push('search_properties');
      const location = text.includes('สุพรรณ') ? 'สุพรรณบุรี' : text.includes('กาญ') ? 'กาญจนบุรี' : undefined;
      const plots = await this.tools.execute('search_properties', {
        maxPrice: maxBudget,
        location,
        status: 'available',
      });

      let plotListText = '';
      if (plots && plots.length > 0) {
        plotListText = plots
          .slice(0, 3)
          .map((p: any) =>
            `• แปลง ${p.plotNumber} (${p.projectName} - ${p.location})\n  - ขนาด: ${p.areaSqWah} ตร.ว. (${p.areaSqm} ตร.ม.)\n  - เอกสารสิทธิ์: ${p.titleDeed}\n  - ราคา: ${p.priceThb.toLocaleString('th-TH')} บาท (อัปเดต ณ ${p.effectiveDate})\n  - จุดเด่น: ${p.features.join(', ')}`
          )
          .join('\n\n');
      }

      let replyContent = `สวัสดีค่ะ ${persona}ขอแนะนำแปลงที่ดินวิวเขาสวย โฉนดครุฑแดงแท้ของ The Hill Land ดังนี้ค่ะ:\n\n${plotListText}\n\n✨ โปรโมชั่นพิเศษ: ผ่อนตรงกับโครงการ 0% นานสูงสุด 36 เดือน ไม่เช็คเครดิตบูโร\n\nหากสนใจแปลงไหนเป็นพิเศษ หรือต้องการนัดชมแปลงจริง สามารถแจ้งเบอร์โทรหรือวันที่สะดวกเพื่อประสานงานฝ่ายขายได้เลยนะคะ 😊`;

      const reply = this.crm.addMessage({
        conversationId: params.conversationId,
        senderType: 'agent_ai',
        content: replyContent,
        citations,
      });

      return {
        status: 'replied',
        replyMessage: reply,
        toolCallsExecuted,
        citations,
      };
    }

    // If general knowledge matched
    if (kbMatches.length > 0) {
      const best = kbMatches[0];
      const replyContent = `${best.content}\n\n(อ้างอิงจาก: ${best.title} | วันที่ปรับปรุง: ${best.effectiveDate})\n\nมีข้อมูลส่วนไหนที่สนใจสอบถามเพิ่มเติมไหมคะ?`;

      const reply = this.crm.addMessage({
        conversationId: params.conversationId,
        senderType: 'agent_ai',
        content: replyContent,
        citations,
      });

      return {
        status: 'replied',
        replyMessage: reply,
        citations,
      };
    }

    // Missing knowledge / Out of scope -> Graceful fallback & Handoff
    await this.tools.execute(
      'handoff_to_human',
      {
        conversationId: params.conversationId,
        reason: `ไม่พบข้อมูลอ้างอิงสำหรับคำถาม: "${text}"`,
        urgency: 'normal',
      },
      `fallback_${params.conversationId}_${params.messageId}`
    );

    const fallbackReply =
      `ขออภัยด้วยนะคะ ในส่วนของข้อมูลนี้ยังไม่มีในฐานข้อมูลทางการของระบบ The Hill Land ในขณะนี้ เพื่อความถูกต้อง ${persona} ขอส่งเรื่องให้เจ้าหน้าที่ฝ่ายขายเข้ามาตอบและดูแลโดยตรงนะคะ (เจ้าหน้าที่จะติดต่อกลับในแชทนี้ค่ะ)`;

    const reply = this.crm.addMessage({
      conversationId: params.conversationId,
      senderType: 'agent_ai',
      content: fallbackReply,
    });

    return {
      status: 'handed_off',
      replyMessage: reply,
      toolCallsExecuted: ['handoff_to_human'],
      botPaused: true,
    };
  }
}
