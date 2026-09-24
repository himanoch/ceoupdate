# Handoff: AI Operations SaaS สำหรับขายต่อและใช้กับ The Hill Land

อัปเดต: 23 กันยายน 2569  
ผู้รับช่วงงาน: เป้  
สถานะ repository: Greenfield — ยังไม่มี source code มีเพียง `image.jpg` ซึ่งเป็นภาพอ้างอิงราคา Dabby

## 1. เป้าหมายของโครงการ

สร้างแพลตฟอร์ม AI Operations แบบ Multi-tenant SaaS ที่ทำงานตั้งแต่รับข้อความลูกค้าไปจนถึงปิดงานจริง ไม่ใช่เพียงตอบ FAQ โดยมี The Hill Land เป็น Design Partner และ Tenant แรก แต่สถาปัตยกรรม ข้อมูล และ workflow ต้องนำไปขายธุรกิจอื่นได้โดยไม่ fork codebase

North Star:

> เปลี่ยนทุกบทสนทนาให้เป็น Lead, นัดหมาย, งานติดตาม หรือ Service Ticket ที่วัดผลและตรวจสอบย้อนหลังได้

ผลลัพธ์ทางธุรกิจที่ต้องวัด:

- เวลาตอบครั้งแรก
- อัตราแชทเป็น Lead
- อัตรา Lead เป็นนัดหมาย
- อัตรานัดหมายสำเร็จ/ไม่มาตามนัด
- มูลค่า Pipeline และรายได้ที่เชื่อมโยงได้
- งานที่ AI ปิดได้เองเทียบกับงานที่ส่งต่อคน
- SLA ของ Service Ticket
- ต้นทุน AI ต่อ Lead/นัดหมาย/งานที่สำเร็จ

## 2. หลักคิดผลิตภัณฑ์

1. **Core + Vertical Pack** — แกนกลางใช้ร่วมกัน ส่วนความรู้ ฟิลด์ เครื่องมือ กฎ และ Dashboard ของแต่ละธุรกิจอยู่ใน Vertical Pack
2. **AI-first, human-controlled** — AI ทำงานอัตโนมัติได้ แต่การลดราคา การรับเงิน การยืนยันสิทธิ์ การให้คำมั่นทางกฎหมาย และเคสเสี่ยงต้องมี approval policy
3. **Source-grounded** — ราคา สถานะสินค้า/แปลง ตารางนัด และเงื่อนไขต้องมาจากข้อมูล authoritative เท่านั้น
4. **Action with audit** — ทุก tool call ต้องมี tenant, actor, input, result, timestamp, correlation ID และสถานะ rollback/retry
5. **Outcome pricing ready** — โครงสร้าง usage ต้องรองรับทั้งรายเดือน, credits, per-seat, per-branch และ per-successful-outcome
6. **Clean-room product** — ใช้บทเรียนจากตลาดได้ แต่ห้ามคัดลอก code, branding, content หรือ proprietary flow ของ Dabby

## 3. ผู้ใช้หลัก

- Owner/Admin: ตั้งค่า tenant, channel, billing, policy และดูรายงาน
- Sales: รับ Lead, นัดชม, ติดตาม และอัปเดต Pipeline
- Operations/Customer Service: รับ Service Ticket และติดตาม SLA
- Approver/Manager: อนุมัติราคา ข้อยกเว้น การจอง และข้อความเสี่ยง
- End Customer/Resident: คุยผ่าน LINE, Facebook หรือ Web Chat
- AI Agent: ตอบจากแหล่งข้อมูล เรียกเครื่องมือ สร้างงาน และส่งต่อคน

## 4. ขอบเขต Core Platform

### 4.1 Tenant & Identity

- Workspace/Tenant แยกข้อมูลอย่างเด็ดขาด
- Users, roles, teams, branches และ permission scopes
- Tenant settings, branding, timezone, locale และ business hours
- Audit log และ session/device history

### 4.2 Channel & Unified Inbox

- เริ่มจาก LINE OA ก่อน แล้ววาง adapter interface สำหรับ Facebook, Instagram และ Web Chat
- Unified conversation, contact identity, tags, assignment, internal notes และ priority
- Human handoff, bot pause/resume, collision guard และ SLA queue
- Message status, retry, deduplication และ webhook signature verification

### 4.3 Agent Configuration

- Agent persona, system policy, business rules และ response style
- Knowledge Base: text, URL, PDF/DOCX/CSV และ structured records
- Prompt/version history, draft/published state, rollback และ approval
- Chat emulator, regression test set และ evaluation report
- Citation/provenance สำหรับคำตอบที่อ้างข้อเท็จจริงสำคัญ

### 4.4 Tool & Integration Layer

- Tool registry ที่มี JSON schema, permission, timeout และ idempotency key
- REST API, Webhook, Google Sheets, Google Calendar, Telegram และ email/SMS adapters
- Secrets ต้องอยู่ใน secret manager ห้ามเก็บใน prompt หรือ application log
- Read tools กับ write tools ต้องแยก permission และ approval policy

### 4.5 CRM & Workflow

- Contact, Lead, Opportunity, Activity, Task และ Service Ticket
- Pipeline stage ที่ปรับได้ต่อ tenant
- Follow-up schedule, reminder, no-response recovery และ escalation
- Custom fields, templates และ automation rules
- Timeline เดียวที่รวมข้อความ นัดหมาย tool calls และ human actions

### 4.6 Scheduling

- Resource-based scheduling: พนักงาน/เซลส์/สถานที่/ห้อง/ทรัพย์
- ตรวจ availability, hold slot, confirm, reschedule, cancel และ waitlist
- ป้องกัน double booking ด้วย transaction/locking
- Reminder และ confirmation link/message

### 4.7 Analytics & Billing

- Funnel: message → lead → appointment → outcome → revenue
- AI containment, handoff rate, unanswered intents และ error rate
- Usage ledger แยก model tokens, messages, tool calls และ storage
- Plan/entitlement ต้องมาจาก source เดียวกันทั้ง Pricing Page และ backend
- Export CSV และ tenant-level retention policy

## 5. The Hill Land Vertical Pack

The Hill Land ต้องเป็น configuration/package ไม่ใช่ logic ที่เขียนฝังใน Core

### 5.1 Sales Journey

1. ลูกค้าสอบถามโครงการ/แปลง/บ้าน/บริการ
2. AI เก็บชื่อ ช่องทางติดต่อ งบ จุดประสงค์ และเวลาที่สะดวก
3. ค้นหารายการที่ว่างจาก Inventory จริง
4. เสนอรายการที่ตรงเงื่อนไขโดยไม่แต่งราคา/สถานะ
5. นัดเยี่ยมชมโครงการหรือคุยกับฝ่ายขาย
6. สร้าง Lead และ Task ให้ผู้รับผิดชอบ
7. ติดตามอัตโนมัติตาม policy
8. ราคาโปร เงื่อนไขพิเศษ การวางเงิน และการจองต้องให้คนอนุมัติ

### 5.2 Property/Inventory Domain

- Project, Zone, Plot/Unit, type, area, price, status และ feature
- Status อย่างน้อย: available, on-hold, reserved, sold, unavailable
- Media, map/location, nearby places และ document links
- Price effective date และ version history
- ห้าม AI เปลี่ยน availability หรือยืนยันการจองโดยตรงหากไม่มี approval

### 5.3 Resident & After-sales Service

- แจ้งปัญหาน้ำ ไฟ ถนน พื้นที่ส่วนกลาง ความปลอดภัย และงานซ่อม
- สร้าง Service Ticket พร้อมประเภท ความเร่งด่วน ตำแหน่ง รูป และผู้ติดต่อ
- เชื่อมงานห้อง WTR/สาธารณูปโภคผ่าน adapter โดย Core ไม่ผูกกับระบบเฉพาะ
- แจ้งสถานะ ticket และ escalation ตาม SLA
- แยกเหตุฉุกเฉินออกจากงานทั่วไปและส่งต่อคนทันที

### 5.4 กฎสำคัญของ The Hill Land Agent

- ตอบราคาและสถานะจาก Inventory/Knowledge Base ที่ระบุวันอัปเดตเท่านั้น
- ไม่รับรองผลตอบแทนการลงทุน ไม่ให้คำแนะนำกฎหมาย/สินเชื่อ และไม่ตีความสัญญา
- ไม่ยืนยันการจอง สิทธิ์ ส่วนลด หรือรับชำระเงินโดยไม่มี approved workflow
- ถ้าข้อมูลไม่พอให้ถามทีละเรื่อง ไม่เดา
- เหตุฉุกเฉิน น้ำรั่วรุนแรง ไฟฟ้าอันตราย ไฟไหม้ หรือภัยต่อชีวิต ให้หยุด flow ปกติและ escalate
- แจ้งว่ากำลังคุยกับ AI เมื่อ policy ของ tenant กำหนด

## 6. MVP ที่ต้องส่งมอบ

### P0 — Internal Pilot ที่ The Hill Land

- Multi-tenant foundation และ tenant `the-hill-land`
- LINE OA adapter อย่างน้อย 1 ช่องทาง หรือ sandbox adapter หาก credential ยังไม่พร้อม
- Unified Inbox + human handoff
- Knowledge Base พร้อม source metadata
- Property search แบบ read-only
- Lead capture และ pipeline
- Site-visit appointment
- Service Ticket สำหรับ resident issue
- Follow-up scheduler
- Audit log และ basic analytics
- Admin UI สำหรับข้อมูล ราคา prompt และ policy

### P1 — Sellable SaaS

- Self-service onboarding
- Plan/entitlement/billing
- Vertical Pack installer และ template library
- Team roles, branches และ approval workflow
- Data export/delete/retention controls
- Monitoring, incident alert และ support tooling
- Public documentation, privacy notice, DPA template และ status page

### Out of scope ของ MVP

- ระบบบัญชีเต็มรูปแบบ
- ระบบโอนกรรมสิทธิ์หรือจัดทำสัญญาอัตโนมัติ
- การรับชำระเงินจริงก่อนผ่าน security/compliance review
- Voice bot และทุกช่องทางพร้อมกัน
- การวินิจฉัยเหตุฉุกเฉินแทนมนุษย์

## 7. Suggested Architecture

ใช้ Modular Monolith ก่อน แยก boundary ให้พร้อมแตก service ภายหลัง

```text
apps/
  web-admin/
  api/
  worker/
packages/
  domain-core/
  agent-runtime/
  channel-adapters/
  integration-adapters/
  policy-engine/
  analytics/
vertical-packs/
  the-hill-land/
  clinic/                 # ตัวอย่างแพ็กสำหรับขายต่อในอนาคต
infra/
docs/
```

Data domains แนะนำ:

- identity/tenant
- contacts/conversations/messages
- agents/prompts/knowledge
- tools/integrations
- crm/leads/tasks
- scheduling
- tickets
- usage/billing
- audit/compliance

ข้อบังคับทางเทคนิค:

- ทุกตารางธุรกิจต้องมี `tenant_id`
- ใช้ database constraint/RLS หรือ repository guard ป้องกัน cross-tenant access
- Tool execution เป็น async job พร้อม retry policy และ dead-letter queue
- Webhook และ message ingestion ต้อง idempotent
- เก็บ immutable audit event สำหรับ action สำคัญ
- PII/secret ห้ามเข้า telemetry โดยไม่ mask
- AI output ห้ามเขียนข้อมูลสำคัญลงระบบโดยตรง ต้องผ่าน validated command/tool

## 8. Security & PDPA Baseline

- Data inventory และระบุ controller/processor responsibility
- Privacy notice, consent/other lawful-basis record และ data-subject request workflow
- DPA และ subprocessor list
- Encryption in transit/at rest
- RBAC, MFA-ready, session revocation และ least privilege
- Retention และ hard-delete/anonymization workflow
- Backup/restore test และ incident response playbook
- Prompt injection defense: external content เป็นข้อมูล ไม่ใช่คำสั่งระบบ
- Approval gate สำหรับการส่งข้อความเชิงตัวแทน การเปลี่ยนข้อมูลสำคัญ การรับเงิน และการลบข้อมูล

## 9. Acceptance Criteria สำคัญ

- Tenant A ไม่สามารถอ่าน/ค้นหา/อ้างอิงข้อมูล Tenant B ได้ในทุก API และ background job
- ข้อความซ้ำจาก webhook ไม่สร้าง Lead, Appointment หรือ Ticket ซ้ำ
- เมื่อมนุษย์รับช่วง บอทหยุดตอบจนกว่าจะ resume อย่างชัดเจน
- คำตอบเรื่องราคา/availability แสดง source และ effective timestamp ได้
- ไม่มี source หรือ tool ล้มเหลว: Agent ต้องยอมรับว่าไม่ทราบและสร้าง handoff
- การจองช่วงเวลาเดียวกันพร้อมกันสองคำขอ ต้องสำเร็จได้เพียงหนึ่งคำขอ
- ทุก write tool มี audit record และ idempotency key
- Prompt เวอร์ชันใหม่ต้องทดสอบ regression set ก่อน publish
- Dashboard คำนวณ funnel จาก event จริง ไม่ใช่ตัวเลขกรอกเอง

## 10. Roadmap แนะนำ

### สัปดาห์ 1–2: Foundation

- ADR, domain model, tenant boundary, auth, event/audit schema
- Channel sandbox, conversation ingestion และ tool contract
- Seed pack ของ The Hill Land

### สัปดาห์ 3–6: The Hill Land Pilot

- Inbox/handoff, KB, property search, lead pipeline, appointment และ ticket
- ทดสอบด้วย synthetic data ก่อนต่อข้อมูลจริง
- เก็บ baseline metrics และ feedback จากผู้ใช้ภายใน

### สัปดาห์ 7–10: Productization

- Onboarding, plan entitlement, analytics, retention/export
- Vertical Pack installer และ sample clinic pack
- Reliability/security test และ operating runbook

### สัปดาห์ 11–12: Sellable Beta

- ลูกค้านำร่อง 3 ราย
- Case study ที่มี methodology
- Pricing ทดลองตามจำนวน seat/branch/usage
- Support SLA และ incident process

## 11. คำถามที่ต้องตกลงก่อน Production

- The Hill Land ใช้ช่องทางใดเป็นอันดับแรก และใครถือ credential
- Source of truth ของรายการทรัพย์ ราคา และสถานะคือระบบใด
- ใครมีสิทธิ์อนุมัติราคา การ hold และการจอง
- ระบบ CRM/Calendar/Utility เดิมมี API หรือไม่
- นิยามเหตุฉุกเฉินและ SLA ของแต่ละประเภท ticket
- ระยะเก็บข้อมูลและผู้มีสิทธิ์ export/delete
- รูปแบบคิดราคาที่ต้องการทดลองกับลูกค้านำร่อง

## 12. Definition of Done

งานไม่ถือว่าเสร็จเพียงเพราะหน้า UI ใช้งานได้ ต้องมี:

- Automated tests ครอบคลุม tenant isolation, idempotency, handoff และ double booking
- Migration/seed/rollback ที่ทำซ้ำได้
- Observability และ alert สำหรับ webhook, queue, tool failure และ AI error
- Runbook สำหรับเปิด tenant ใหม่และแก้ incident
- Security/privacy checklist ผ่าน
- Demo journey ของ The Hill Land ตั้งแต่แชท → Lead/นัดหมาย/Ticket → Dashboard

