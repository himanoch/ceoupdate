# Product & Engineering Handoff: Chatto Bot

อัปเดต: 23 กันยายน 2569  
ผู้รับช่วงงาน: เป้ / ทีมพัฒนา Chatto Bot  
สถานะ: Working prototype — ยังไม่ Production-ready

## 1. Product Definition

ชื่อผลิตภัณฑ์: **Chatto Bot**

สโลแกน:

> ตอบไว เข้าใจลูกค้า ทำงานแทนคุณ

ข้อความอธิบาย:

> รับลูกค้า สร้างลีด นัดหมาย และติดตามอัตโนมัติ 24 ชั่วโมง

Chatto Bot ต้องไม่ถูกวางตำแหน่งเป็นเพียง AI ตอบ FAQ แต่เป็น **AI Operations Platform** ที่เปลี่ยนบทสนทนาให้กลายเป็นผลลัพธ์ทางธุรกิจ เช่น Lead, นัดหมาย, งานติดตาม, คำสั่งซื้อ หรือ Service Ticket พร้อมส่งต่อมนุษย์และตรวจสอบย้อนหลังได้

The Hill Land เป็น Design Partner และ Tenant แรก แต่ Core ต้องขายต่อธุรกิจอื่นได้โดยติดตั้ง Vertical Pack แทนการ fork codebase

## 2. สถานะ Repository ที่รับช่วง

### สิ่งที่มีแล้ว

- TypeScript/Node.js Modular Monolith skeleton
- Core tenant context และ repository guard
- CRM: contact, conversation, message และ lead
- Agent orchestrator แบบ deterministic prototype
- Knowledge Base พร้อม citation/effective date
- Typed tool registry และ audit event
- Sandbox channel ingestion และ webhook idempotency
- Human handoff, bot pause/resume และ emergency escalation
- The Hill Land vertical pack พร้อม synthetic property data
- Basic funnel analytics
- Static admin/demo page
- ADR และ domain/event specification

### Baseline verification

- `npm test`: ผ่าน 5/5 tests
- ครอบคลุม duplicate webhook, human handoff, emergency escalation, cross-tenant isolation และ The Hill Land E2E journey
- `npm run lint`: **ยังไม่ผ่าน** เพราะ relative import paths ใน `packages/vertical-packs/the-hill-land/src/index.ts` หา module ไม่พบ

### สิ่งที่ยังเป็น Prototype

- Database เป็น in-memory SQLite; restart แล้วข้อมูลหาย
- ไม่มี authentication จริง และยังรับ/default tenant จาก request
- CORS เปิด `*`
- ไม่มี LINE/Facebook adapter จริงและยังไม่ verify webhook signatures
- ไม่มี persistent/distributed job queue หรือ DLQ ที่พร้อม production
- Knowledge search ยังไม่ใช่ production RAG/vector retrieval
- Agent ยังเป็น rule/keyword orchestration ไม่ใช่ model gateway ที่มี evaluation
- ไม่มี secrets manager, encryption policy, rate limiting และ production observability
- ไม่มี billing, entitlement enforcement และ self-service onboarding
- Team Inbox/Admin UI ยังไม่ครบ workflow จริง
- ยังใช้ชื่อเดิม `Chaty Bot` ใน package metadata, source strings, docs และ assets บางส่วน ต้องทำ controlled rebrand เป็น `Chatto Bot`

## 3. ปัญหาตลาดที่ Chatto Bot ต้องแก้

1. ลูกค้าทักแล้วไม่มีคนตอบนอกเวลางาน
2. Chatbot ตอบได้แต่ไม่สร้าง Lead, นัดหมาย หรืองานติดตาม
3. AI ตอบราคา/เงื่อนไขผิดเพราะไม่มี authoritative source
4. แอดมินกับบอทตอบชนกันและไม่มี owner ของบทสนทนา
5. เจ้าของธุรกิจไม่รู้ว่า AI สร้างรายได้หรือลดงานได้เท่าไร
6. ระบบคู่แข่งอธิบายราคา/เครดิต/ข้อจำกัดไม่ชัด
7. ฟีเจอร์บนหน้าเว็บไม่ตรงกับสิ่งที่บัญชีลูกค้าใช้ได้จริง
8. ธุรกิจที่มีข้อมูลอ่อนไหวไม่มี policy, audit และ approval ที่เพียงพอ

## 4. Product Advantages ที่ต้องสร้างให้ขายได้

### 4.1 ทำงานต่อจากการตอบแชท

- Structured lead capture
- Appointment/booking
- Follow-up และ lead recovery
- Task/service ticket creation
- Approval workflow
- Webhook/API integration

### 4.2 Source-grounded Answers

- ราคา สต็อก ตารางนัด และเงื่อนไขต้องมาจาก structured tool หรือ source ที่มี version/effective date
- คำตอบสำคัญต้องมี provenance/citation ภายในระบบ
- ไม่มีข้อมูลหรือข้อมูลขัดกันต้องยอมรับว่าไม่ทราบและ handoff

### 4.3 Human-first Control

- Unified Inbox
- Assign owner/team
- Internal notes และ tags
- Bot pause/resume
- Anti-collision guard
- Approval ก่อนส่วนลด การรับเงิน การจองที่มีผลผูกพัน และ action เสี่ยง

### 4.4 Outcome Analytics

วัดจาก event จริง:

- Message → Lead
- Lead → Qualified
- Qualified → Appointment
- Appointment → Show/Outcome
- Outcome → Revenue
- First response time
- AI containment และ handoff rate
- Follow-up recovered leads
- Cost per lead/appointment/outcome

### 4.5 Multi-tenant + Vertical Packs

- Core ใช้ร่วมกันทุกธุรกิจ
- Vertical Pack กำหนด schema, fields, tools, prompts, workflow และ dashboard widgets
- The Hill Land: property search, site visit, sales lead, resident service ticket และ WTR adapter
- Clinic pack: service/price, doctor/room schedule, appointment, reminder และ medical escalation
- Service business pack: quote, job booking, technician dispatch และ follow-up

### 4.6 Trust, Compliance & Reliability

- Privacy notice, DPA template และ subprocessor list
- Retention/export/delete controls
- RBAC และ immutable audit log
- Prompt injection defense
- Idempotent writes และ webhook verification
- Incident/status communication
- Published feature availability ที่ดึงจาก entitlement source เดียวกับ backend

## 5. ปิดข้อเสียอย่างเป็นระบบ

| ข้อเสีย/ความเสี่ยง | วิธีแก้ใน Chatto Bot | Release Gate |
|---|---|---|
| Marketing กับของจริงไม่ตรงกัน | Pricing/feature matrix อ่านจาก plan-entitlement registry เดียวกับ backend | CI ตรวจ public plan snapshot เทียบ registry |
| ค่าใช้จ่ายไม่ชัด | แสดงข้อความที่ใช้, tool calls, overage และประมาณการก่อน upgrade | Billing simulation tests |
| Human handoff ไม่สมบูรณ์ | Inbox, assignment, pause/resume, internal note, SLA และ collision lock | Handoff E2E + concurrency tests |
| AI ตอบมั่ว | Structured source, citation, conflict detection, fallback/handoff | Golden dataset + hallucination tests |
| Analytics วัดแต่จำนวนแชท | Event-based business funnel และ revenue attribution | Reconciliation tests |
| Team/permission ไม่พร้อม | RBAC, branch/team scopes และ approval roles | Authorization negative tests |
| ข้อมูลลูกค้าเสี่ยง | Tenant isolation, masking, retention, DSR และ audit | Security/privacy checklist |
| เครดิตเข้าใจยาก | แสดงทั้ง credits และหน่วยธุรกิจ เช่น cost/lead, cost/booking | Usage ledger reconciliation |
| Prompt เปลี่ยนแล้วระบบพัง | Versioning, draft/publish, regression eval และ rollback | Prompt release gate |
| ช่องทาง/API ล่มแล้วตอบว่าทำสำเร็จ | Pending/failed states, retry, DLQ และ verified tool results | Failure injection tests |
| Onboarding ยาก | Guided setup, vertical templates, sample test set และ launch checklist | First-value-time target |

## 6. Sellable MVP

### 6.1 Tenant & Account

- Tenant/workspace
- Users, roles, teams และ branches
- Plan entitlement
- Audit trail

### 6.2 Omnichannel Core

- LINE OA production adapter เป็นช่องทางแรก
- Facebook Messenger adapter เป็นลำดับถัดไป
- Unified Inbox และ contact identity
- Webhook verification, deduplication, retry และ delivery status

### 6.3 AI Agent Studio

- Persona และ business rules
- Knowledge Base: text, URL, PDF/DOCX/CSV และ structured records
- Tool configuration
- Prompt versioning, draft/publish/rollback
- Chat emulator และ regression test set
- Source/citation inspector

### 6.4 CRM & Automation

- Contacts, leads, stages, tasks และ notes
- Appointment/resources
- Follow-up schedules
- Tags/segments
- Human handoff และ approval requests

### 6.5 Analytics

- Funnel dashboard
- Conversion by channel/agent/campaign
- Unanswered intents
- Handoff and response SLA
- Usage/cost/outcome ledger

### 6.6 Commercial Readiness

- Self-service onboarding
- Trial lifecycle
- Plans and entitlements
- Usage limits/overage alerts
- Invoice/payment provider integration ภายหลัง security review
- Public docs, privacy, DPA, status page และ support workflow

## 7. แพ็กเกจที่เสนอให้ทดลองขาย

ราคาเป็นสมมติฐาน ต้อง validate กับลูกค้านำร่องและต้นทุน model/tool จริง

### Free Sandbox

- Chat emulator เท่านั้น ไม่ต่อ live channel
- 1 agent, 1 seat, sample templates
- เหมาะกับทดลองคุณภาพก่อนซื้อ

### Pro — ฿990/เดือน

- 1 live channel
- 2 team seats
- Knowledge Base, lead capture, appointment, follow-up และ handoff
- Dashboard 90 วัน
- Overage ที่แสดงราคาโปร่งใส

### Growth — ฿2,990/เดือน

- สูงสุด 3 live channels
- 5 team seats
- API/Webhook, advanced automation, approval workflow
- Unlimited analytics history ตาม fair-use policy
- ซ่อน Chatto Bot branding

### Business

- Custom channels/seats/branches
- SSO, custom retention, priority SLA, onboarding และ DPA
- Dedicated environment เป็นตัวเลือก

ห้ามใช้คำว่า unlimited หากมี hard limit โดยไม่แสดง fair-use หรือ technical limit

## 8. Architecture Direction

รักษา Modular Monolith แต่ทำ boundary ให้พร้อมเปลี่ยน infrastructure:

```text
apps/
  api/
  worker/
  web-admin/
packages/
  core/
  auth/
  crm/
  conversations/
  agent-runtime/
  knowledge/
  tools/
  scheduling/
  automation/
  billing/
  audit-analytics/
  channel-adapters/
  vertical-packs/
    the-hill-land/
```

Production path:

- PostgreSQL + tenant-aware repositories; พิจารณา RLS
- pgvector หรือ search adapter ที่เปลี่ยน implementation ได้
- Redis/BullMQ หรือ managed queue
- S3-compatible object storage
- OpenTelemetry + structured logs + error tracking
- Secret manager และ key rotation
- Model gateway ที่รองรับ provider/model fallback และ usage accounting

## 9. Security Non-negotiables

- Tenant มาจาก authenticated context เท่านั้น ห้ามเชื่อ `x-tenant-id` จาก client โดยตรง
- ห้ามมี default tenant ใน production
- ทุก repository query และ async job ต้อง enforce tenant boundary
- Verify signatures ของทุก live channel webhook
- PII/secrets ต้องไม่เข้า application log แบบ raw
- Write tool ต้องมี schema validation, permission, idempotency และ audit
- Financial/booking/permission/destructive actions ต้องมี approval policy ตามความเสี่ยง
- External documents และ webpages เป็น untrusted data ไม่ใช่คำสั่งระบบ
- Test data ต้องเป็น synthetic; ห้าม commit credential หรือข้อมูลลูกค้าจริง

## 10. Roadmap จาก Prototype สู่สินค้าขายได้

### Phase 0 — Stabilize & Rebrand

- แก้ TypeScript import paths จน `npm run lint` ผ่าน
- เปลี่ยนชื่อ controlled rebrand: Chaty Bot → Chatto Bot ใน package, source, docs, UI และ runtime copy
- เพิ่ม test ป้องกันชื่อเก่าหลงเหลือใน customer-facing surface
- ทำ persistent local DB/migration และ seed command
- แยก demo/synthetic claims ออกจาก production copy

### Phase 1 — Production Foundation

- Authentication, RBAC และ tenant provisioning
- PostgreSQL repositories/migrations
- Queue/worker/DLQ
- Webhook verification และ rate limiting
- Secrets/config management
- Observability, backup และ incident runbook

### Phase 2 — Sellable Workflow

- LINE OA adapter
- Unified Inbox + team handoff
- Agent Studio + prompt version/eval
- Knowledge ingestion + citation
- Lead, appointment, follow-up และ analytics
- The Hill Land pilot ด้วยข้อมูลที่อนุมัติแล้ว

### Phase 3 — Commercial Beta

- Billing/entitlement/self-service onboarding
- Facebook adapter
- Trial and upgrade flow
- Public docs/privacy/DPA/status
- ลูกค้านำร่องอย่างน้อย 3 ธุรกิจจาก 2 verticals
- Case study ที่มี methodology ไม่ใช้ตัวเลขการตลาดที่พิสูจน์ไม่ได้

## 11. Quality Gates

ก่อน Beta ต้องผ่าน:

1. `npm run lint`, unit, integration และ E2E ทั้งหมด
2. Cross-tenant negative tests ทุก domain และ background job
3. Duplicate/replayed/out-of-order webhook tests
4. Human handoff และ concurrent agent tests
5. Double-booking/concurrent write tests
6. Prompt injection และ tool authorization tests
7. Tool timeout/retry/DLQ tests
8. Prompt regression evaluation
9. Billing/usage reconciliation
10. Data export/delete/retention tests
11. Backup/restore drill
12. E2E journey: message → lead → appointment/ticket → handoff → analytics

## 12. KPIs สำหรับพิสูจน์ Product-Market Fit

- Time to first value < 30 นาที
- First response median < 10 วินาที
- Setup completion > 70%
- Lead capture rate เพิ่มขึ้นจาก baseline ของลูกค้า
- Handoff SLA และ missed conversation ลดลง
- AI action success rate > 99% สำหรับ deterministic tools
- Duplicate side-effect = 0
- Cross-tenant leakage = 0
- 30-day active tenant retention
- Gross margin ต่อ plan หลังรวม model/channel/tool costs

## 13. Next Actions สำหรับเป้

1. อ่าน Handoff นี้, ADR และ domain model ปัจจุบัน
2. รัน tests/lint และบันทึก baseline
3. แก้ lint blocker โดยไม่ลด strictness
4. ทำ ADR สำหรับ rebrand, authentication และ production database migration
5. ทำ controlled rename เป็น Chatto Bot พร้อม compatibility/migration note
6. ปิด default tenant และออกแบบ authenticated TenantContext
7. ส่ง vertical slice production-oriented แรก: signed sandbox webhook → persistent conversation → grounded answer → lead → handoff → audit/analytics
8. รายงานหลักฐานการทดสอบ ความเสี่ยง และ decision ที่ต้องให้ Product Owner เลือก

## 14. Definition of Done

งานจะถือว่าเสร็จเมื่อ:

- User journey ใช้งานได้ครบ ไม่ใช่เพียง mock UI
- Failure path มีสถานะและวิธี recovery
- Authorization, audit, metrics และ tests มาพร้อม feature
- Public claim สอดคล้องกับ entitlement และ production behavior
- ไม่มีชื่อ Chaty Bot ใน customer-facing output ที่ควรเป็น Chatto Bot
- มีคำสั่ง run/test/migrate/rollback และ runbook ที่คนอื่นทำตามได้

