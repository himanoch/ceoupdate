import { DatabaseManager, getTenantContext } from '../../../core/src/index.js';
import { KnowledgeBaseService, ToolRegistry, ToolDefinition, Citation } from '../../../agent-runtime/src/index.js';
import { CrmService } from '../../../crm/src/index.js';
import { AuditService, AnalyticsService } from '../../../audit-analytics/src/index.js';

export interface PropertyPlot {
  plotId: string;
  projectName: string;
  location: string;
  zone: string;
  plotNumber: string;
  areaSqWah: number;
  areaSqm: number;
  priceThb: number;
  status: 'available' | 'on_hold' | 'reserved' | 'sold';
  titleDeed: string; // e.g. โฉนดครุฑแดง น.ส.4 จ.
  features: string[];
  effectiveDate: string;
}

export const SYNTHETIC_PLOTS: PropertyPlot[] = [
  {
    plotId: 'HL-PT-A1',
    projectName: 'ภูธารา วิลล่า',
    location: 'กาญจนบุรี (ไทรโยค)',
    zone: 'โซน A วิวเทือกเขาตะนาวศรี',
    plotNumber: 'A1',
    areaSqWah: 200,
    areaSqm: 800,
    priceThb: 390000,
    status: 'available',
    titleDeed: 'โฉนดครุฑแดง (น.ส.4 จ.)',
    features: ['วิวเขาพาโนรามา', 'ติดถนนคอนกรีตกว้าง 8 เมตร', 'มีไฟฟ้า-น้ำประปาพร้อม'],
    effectiveDate: '2026-09-20',
  },
  {
    plotId: 'HL-PT-A2',
    projectName: 'ภูธารา วิลล่า',
    location: 'กาญจนบุรี (ไทรโยค)',
    zone: 'โซน A วิวเทือกเขาตะนาวศรี',
    plotNumber: 'A2',
    areaSqWah: 250,
    areaSqm: 1000,
    priceThb: 480000,
    status: 'available',
    titleDeed: 'โฉนดครุฑแดง (น.ส.4 จ.)',
    features: ['ติดริมลำธารสาธารณะ', 'วิวเขาล้อมรอบ', 'เหมาะสร้างบ้านพักตากอากาศ'],
    effectiveDate: '2026-09-20',
  },
  {
    plotId: 'HL-PT-A3',
    projectName: 'ภูธารา วิลล่า',
    location: 'กาญจนบุรี (ไทรโยค)',
    zone: 'โซน A วิวเทือกเขาตะนาวศรี',
    plotNumber: 'A3',
    areaSqWah: 300,
    areaSqm: 1200,
    priceThb: 590000,
    status: 'on_hold',
    titleDeed: 'โฉนดครุฑแดง (น.ส.4 จ.)',
    features: ['แปลงมุม ติดถนนสองด้าน', 'วิวเขา 360 องศา'],
    effectiveDate: '2026-09-20',
  },
  {
    plotId: 'HL-PP-B1',
    projectName: 'ภูผาผึ้ง เลควิว',
    location: 'สุพรรณบุรี (ด่านช้าง)',
    zone: 'โซน B ริมอ่างเก็บน้ำลำตะเพิน',
    plotNumber: 'B1',
    areaSqWah: 150,
    areaSqm: 600,
    priceThb: 290000,
    status: 'available',
    titleDeed: 'โฉนดครุฑแดง (น.ส.4 จ.)',
    features: ['วิวอ่างเก็บน้ำและภูเขา', 'บรรยากาศสไตล์สวิตเซอร์แลนด์เมืองไทย', 'ใกล้ชุมชน'],
    effectiveDate: '2026-09-22',
  },
  {
    plotId: 'HL-MK-C1',
    projectName: 'ม่อนเขาเขียว การ์เด้น',
    location: 'กาญจนบุรี (บ่อพลอย)',
    zone: 'โซน C แปลงสวนเกษตร',
    plotNumber: 'C1',
    areaSqWah: 100,
    areaSqm: 400,
    priceThb: 199000,
    status: 'available',
    titleDeed: 'โฉนดครุฑแดง (น.ส.4 จ.)',
    features: ['งบประหยัดต่ำกว่าสองแสน', 'ดินดี เหมาะทำโคกหนองนา/บ้านสวน'],
    effectiveDate: '2026-09-15',
  },
];

export function registerTheHillLandTools(
  registry: ToolRegistry,
  crm: CrmService,
  analytics: AnalyticsService
): void {
  // 1. Tool: search_properties
  registry.register({
    name: 'search_properties',
    description: 'ค้นหาแปลงที่ดินในโครงการ The Hill Land ตามงบประมาณ ทำเล ขนาด และสถานะ',
    scope: 'read',
    execute: async (input: { maxPrice?: number; location?: string; status?: string }) => {
      let results = [...SYNTHETIC_PLOTS];
      if (input.maxPrice !== undefined) {
        results = results.filter((p) => p.priceThb <= input.maxPrice!);
      }
      if (input.location) {
        const loc = input.location.toLowerCase();
        results = results.filter((p) => p.location.toLowerCase().includes(loc) || p.projectName.toLowerCase().includes(loc));
      }
      if (input.status) {
        results = results.filter((p) => p.status === input.status);
      }
      return results;
    },
  });

  // 2. Tool: get_latest_price_and_availability
  registry.register({
    name: 'get_latest_price_and_availability',
    description: 'ดึงราคาและสถานะล่าสุดของแปลงที่ดิน พร้อม effective timestamp',
    scope: 'read',
    execute: async (input: { plotId: string }) => {
      const plot = SYNTHETIC_PLOTS.find((p) => p.plotId === input.plotId);
      if (!plot) {
        throw new Error(`ไม่พบแปลงรหัส ${input.plotId} ในระบบ`);
      }
      return {
        plotId: plot.plotId,
        projectName: plot.projectName,
        plotNumber: plot.plotNumber,
        priceThb: plot.priceThb,
        status: plot.status,
        areaSqWah: plot.areaSqWah,
        effectiveDate: plot.effectiveDate,
        verifiedSource: 'The Hill Land Inventory System v1',
      };
    },
  });

  // 3. Tool: create_lead
  registry.register({
    name: 'create_lead',
    description: 'สร้าง Lead ใหม่ใน CRM สำหรับลูกค้า The Hill Land ที่สนใจที่ดินหรืองบประมาณ',
    scope: 'write',
    execute: async (
      input: {
        contactId: string;
        conversationId: string;
        interestZone?: string;
        budgetMin?: number;
        budgetMax?: number;
        purpose?: string;
        phone?: string;
        notes?: string;
      },
      idempotencyKey?: string
    ) => {
      const lead = crm.createLead({
        contactId: input.contactId,
        conversationId: input.conversationId,
        source: 'chatto_bot_the_hill_land',
        interestZone: input.interestZone,
        budgetMin: input.budgetMin,
        budgetMax: input.budgetMax,
        purpose: input.purpose,
        phone: input.phone,
        notes: input.notes,
      });

      analytics.recordEvent({
        eventName: 'funnel.lead_captured',
        contactId: input.contactId,
        conversationId: input.conversationId,
        properties: {
          leadId: lead.id,
          interestZone: input.interestZone,
          budgetMax: input.budgetMax,
        },
      });

      return lead;
    },
  });

  // 4. Tool: handoff_to_human
  registry.register({
    name: 'handoff_to_human',
    description: 'ส่งต่อบทสนทนาให้ทีมงานมนุษย์และระงับการตอบของ AI ทันที',
    scope: 'write',
    execute: async (
      input: {
        conversationId: string;
        reason: string;
        urgency?: 'normal' | 'high' | 'emergency';
      },
      idempotencyKey?: string
    ) => {
      crm.pauseBot(input.conversationId, input.reason, 'agent_ai');

      analytics.recordEvent({
        eventName: 'funnel.handoff_triggered',
        conversationId: input.conversationId,
        properties: {
          reason: input.reason,
          urgency: input.urgency || 'normal',
        },
      });

      return {
        status: 'handoff_requested',
        conversationId: input.conversationId,
        botPaused: true,
        reason: input.reason,
        urgency: input.urgency || 'normal',
      };
    },
  });
}

/**
 * Seed Knowledge Base with Synthetic Data for The Hill Land
 */
export function seedTheHillLand(db: DatabaseManager, kb: KnowledgeBaseService): void {
  const rawDb = db.getRawDb();
  const now = new Date().toISOString();

  // Create tenant if not exists
  rawDb.prepare(`
    INSERT OR IGNORE INTO tenants (id, name, status, settings_json, created_at)
    VALUES ('the-hill-land', 'The Hill Land Co., Ltd.', 'active', '{"timezone":"Asia/Bangkok"}', ?)
  `).run(now);

  // Add Knowledge Source 1: Overview & Title Deed
  kb.addSource({
    title: 'ข้อมูลภาพรวมโครงการและกรรมสิทธิ์ที่ดิน The Hill Land',
    sourceType: 'document',
    url: 'https://thehillland.com/about-title-deed',
    effectiveDate: '2026-09-20',
    chunks: [
      {
        content: 'ที่ดินทุกแปลงของ The Hill Land เป็นโฉนดครุฑแดงแท้ (น.ส.4 จ.) ตรวจสอบความถูกต้องและรังวัดชัดเจน พร้อมโอนกรรมสิทธิ์ ณ สำนักงานที่ดินได้ 100% ไม่มีภาระผูกพันหรือที่ดินทับซ้อน',
        tags: 'โฉนด ครุฑแดง กรรมสิทธิ์ โอนกรรมสิทธิ์ ความถูกต้อง กฎหมาย',
      },
      {
        content: 'โครงการที่เปิดขายในปัจจุบันมี 3 โครงการหลัก: 1. ภูธารา วิลล่า (กาญจนบุรี ไทรโยค วิวเทือกเขาตะนาวศรี) 2. ภูผาผึ้ง เลควิว (สุพรรณบุรี ด่านช้าง ริมอ่างเก็บน้ำลำตะเพิน) 3. ม่อนเขาเขียว การ์เด้น (กาญจนบุรี บ่อพลอย ที่ดินสวนเกษตรงบประหยัด)',
        tags: 'โครงการ ภูธารา ภูผาผึ้ง ม่อนเขาเขียว ทำเล กาญจนบุรี สุพรรณบุรี',
      },
    ],
  });

  // Add Knowledge Source 2: Financing & Promotions
  kb.addSource({
    title: 'เงื่อนไขการผ่อนตรง 0% และโปรโมชั่น The Hill Land',
    sourceType: 'document',
    url: 'https://thehillland.com/promotions-financing',
    effectiveDate: '2026-09-20',
    chunks: [
      {
        content: 'โปรโมชั่นผ่อนตรงกับโครงการ 0% นานสูงสุด 36 เดือน: ไม่เช็คเครดิตบูโร ไม่ต้องใช้สลิปเงินเดือน ใช้เพียงบัตรประชาชนใบเดียว ผ่อนเริ่มต้นเพียง 5,000 - 9,000 บาท/เดือน เมื่อผ่อนครบโอนกรรมสิทธิ์ทันที',
        tags: 'ผ่อนตรง 0% ไม่เช็คบูโร ไม่ต้องกู้แบงก์ ดาวน์ เงื่อนไขการเงิน',
      },
      {
        content: 'แปลงราคาพิเศษ: เริ่มต้นเพียง 199,000 บาท สำหรับแปลงม่อนเขาเขียว C1 (100 ตร.ว.) และเริ่มต้น 390,000 บาท สำหรับแปลงภูธารา A1 (200 ตร.ว. วิวเขาพาโนรามา)',
        tags: 'ราคา งบประมาณ 199000 390000 480000 แปลงถูก งบ',
      },
    ],
  });

  // Add Knowledge Source 3: Site Visits & Facilities
  kb.addSource({
    title: 'การนัดหมายเยี่ยมชมโครงการและสิ่งอำนวยความสะดวก The Hill Land',
    sourceType: 'document',
    url: 'https://thehillland.com/visit-facilities',
    effectiveDate: '2026-09-22',
    chunks: [
      {
        content: 'การเข้าชมโครงการ: มีเจ้าหน้าที่ฝ่ายขายดูแลและพาชมแปลงจริงทุกวัน ระหว่างเวลา 09:00 - 17:00 น. แนะนำนัดหมายล่วงหน้าอย่างน้อย 1 วัน เพื่อจัดเตรียมรถนำชมและเอกสารแปลงที่ดิน',
        tags: 'นัดชม เยี่ยมชม เวลาเปิดปิด เดินทาง พิกัด ฝ่ายขาย',
      },
      {
        content: 'สาธารณูปโภคครบครัน: ถนนคอนกรีต/หินคลุกกว้าง 8 เมตร, เสาไฟฟ้าและหม้อแปลงขยายเขตถึงหน้าแปลง, ท่อน้ำประปาหมู่บ้าน/บาดาลแรงดันสูง พร้อมปลูกสร้างบ้านพักตากอากาศได้ทันที',
        tags: 'สาธารณูปโภค ไฟฟ้า น้ำประปา ถนน สิ่งแวดล้อม',
      },
    ],
  });
}

export const CHATTO_BOT_SOURCE = 'chatto_bot_the_hill_land';
export const LEGACY_CHATY_BOT_SOURCE = 'chaty_bot_the_hill_land';
