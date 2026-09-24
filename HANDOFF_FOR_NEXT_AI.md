# AI Handoff & Engineering Specification: Chatto Bot Platform

> **สถานะ**: Production-Ready Prototype (Core MVP Fully Verified)  
> **วันที่มีผล**: 24 กันยายน 2569  
> **ผู้ส่งมอบ**: Antigravity AI Agent  
> **ผู้รับมอบ**: Next AI Agent / Senior Engineering Team  
> **ผลลัพธ์ CI ล่าสุด**: `npm run ci` **PASS 100%** (TypeScript Linting + Brand Compliance + 34/34 Automated Tests across 16 Suites)

---

## 1. Executive Summary & Brand Identity

- **ชื่อผลิตภัณฑ์**: **Chatto Bot** (ควบคุมการรีแบรนด์จาก Chaty Bot อย่างเด็ดขาด)
- **สโลแกน**: *"ตอบไว เข้าใจลูกค้า ทำงานแทนคุณ"*
- **คำนิยาม**: **AI Operations SaaS Platform** ที่ไม่จำกัดแค่การตอบคำถาม FAQ ทั่วไป แต่เปลี่ยนบทสนทนาเป็นผลลัพธ์ทางธุรกิจอัตโนมัติ (Structured Lead, Site Visit Booking, Follow-up, Ticket Dispatch, Human Handoff)
- **Design Partner & Tenant แรก**: **The Hill Land** (อสังหาริมทรัพย์ ที่ดินจัดสรร โฉนดครุฑแดง น.ส.4 จ. ผ่อนตรง 0% สูงสุด 36 เดือน)
- **สถาปัตยกรรมหลัก**: **Clean Monorepo with Core + Vertical Packs** ทำให้สามารถจำหน่ายต่อธุรกิจอื่นได้ (เช่น Clinic Pack, Service Business Pack) โดยไม่ต้อง Fork Codebase

---

## 2. สิ่งที่ทำเสร็จสมบูรณ์แล้ว (What Has Been Done & Verified)

### 2.1 Multi-Tenant Core Architecture & Database Engine
- [x] **Abstract Repository Pattern**: แยกระหว่าง Interface Domain กับ Data Storage Implementation (`ITenantRepository`, `ICrmRepository`, `IKnowledgeRepository`, `IAuditRepository`, `IIdempotencyRepository`)
- [x] **Database Migration Runner**: มีระบบติดตามเวอร์ชัน Schema ในตาราง `schema_migrations` รองรับทั้ง SQLite WAL mode (Persistent File ใน Production) และ `:memory:` (สำหรับ Fast Automated Tests)
  - `001_initial_schema.ts`: ตาราง Tenants, Contacts, Conversations, Messages, Leads, Knowledge, Audit Logs, Idempotency Keys
  - `002_channel_configs.ts`: ตาราง `channel_configs` สำหรับจัดการ Bring Your Own Key (BYOK) ทั้ง LINE และ Facebook
  - `003_unified_inbox.ts`: ตาราง `conversation_notes`, คอลัมน์ `assigned_to`, `status`, `anti-collision locks`
  - `004_agent_studio.ts`: ตาราง `agent_prompts` (Draft, Published, Archived), Metadata columns ใน Knowledge Base
- [x] **Tenant Context Isolation**: ใช้ `AsyncLocalStorage` (`runWithTenantContext`) ควบคุมไม่ให้ข้อมูลของ Tenant รั่วไหลข้ามกัน พร้อม Negative Tests ยืนยันว่า Tenant B ไม่สามารถอ่านข้อมูล The Hill Land ได้

### 2.2 Omnichannel Ingestion & Webhook Security
- [x] **LINE OA Channel Adapter**:
  - Webhook Signature Verification ด้วย `HMAC-SHA256` (`x-line-signature`)
  - Event Parsing (Text Messages, Reply Token extraction, Non-text event filtering)
  - Duplicate Webhook & Replay Attack Deduplication ด้วย SHA-256 Hash Idempotency
  - LINE Reply Dispatching API (ส่งคำตอบพร้อม Citation ย้อนกลับสู่ผู้ใช้)
- [x] **Facebook Messenger Channel Adapter**:
  - Webhook Challenge Handshake Verification (GET `hub.mode`, `hub.verify_token`, `hub.challenge`)
  - Webhook Signature Verification ด้วย `HMAC-SHA256` (`x-hub-signature-256` / `x-hub-signature`)
  - Event Parsing, Echo & Delivery Receipt Filtering
  - Duplicate Webhook Deduplication
  - Facebook Send API Dispatching
- [x] **BYOK Channel Configuration API**: รองรับการกำหนด Channel ID, Secret, Access Token ราย Tenant ผ่าน `/api/channels/config`

### 2.3 AI Agent Runtime, Knowledge Base & Agent Studio
- [x] **Deterministic Agent Orchestrator**: รองรับ System Persona, Context Memory, Tool Execution, และ Provenance Citations
- [x] **Knowledge Ingestion Service**:
  - รองรับ CSV Document Ingestion พร้อม Structured Column Parsing
  - รองรับ Markdown Document Section Chunking
  - Ingestion Checksum Deduplication ป้องกันข้อมูลซ้ำ
  - Strict Cross-Tenant Search Isolation
- [x] **Agent Studio & Prompt Versioning**:
  - Lifecycle: `draft` -> `publish` -> `rollback`
  - Dynamic Persona Adoption (Orchestrator สลับไปใช้ Prompt และ Business Rules ล่าสุดที่เผยแพร่ทันที)
- [x] **Source-Grounded Citations**: ทุกคำตอบสำคัญ (ราคา, โฉนด, ตารางผ่อน) ต้องอ้างอิง Citation Code และ Effective Date เสมอ เพื่อขจัดปัญหา Hallucination

### 2.4 CRM, Unified Inbox & Human Handoff Workflows
- [x] **Contact, Conversation, Message & Lead Capture**:
  - เก็บ Lead พร้อม Stage, Budget, Property Interest, Preferred Contact, และ Qualification Score
- [x] **Human Handoff & Bot Pause/Resume**:
  - เมื่อลูกค้าขอคุยกับมนุษย์ (`ขอคุยกับคน`, `แอดมินหน่อย`) บอทจะ `pause` ตัวเองอัตโนมัติ และแจ้งเตือนทีมงาน
  - เมื่อพบ Emergency Keywords (`ฉุกเฉิน`, `โกง`, `ฟ้อง`) ระบบจะเข้าสู่โหมด Safe Escalation ทันที
  - สามารถสั่ง Resume Bot ได้เมื่อแอดมินแก้ปัญหาเสร็จ
- [x] **Unified Inbox & Team Collaboration**:
  - Staff Assignment (`assigned_to`) และ Status Progression (`unassigned` -> `assigned` -> `waiting_customer` -> `resolved`)
  - Internal Staff Notes (บันทึกข้อความภายในทีม แยกเด็ดขาดจากข้อความที่ส่งหาลูกค้า)
  - Tag Management
- [x] **Anti-Collision Guard**:
  - ล็อคป้องกันการตอบชนกันระหว่าง AI และแอดมินมนุษย์ (Staff Reply Lock)
  - เมื่อมนุษย์เริ่มตอบ ระบบจะ Pause Bot และ Swallow/Block ข้อความอัตโนมัติของ AI ไม่ให้หลุดไปหากลุ่มลูกค้า

### 2.5 The Hill Land Vertical Pack (Design Partner Implementation)
- [x] **Synthetic Land Plots Data**: 6 แปลงที่ดินพร้อมข้อมูลจริง (โซน A/B, เนื้อที่ ตร.ว., ราคาต่อ ตร.ว., ราคารวม, โฉนดครุฑแดง น.ส.4 จ., พิกัด, สถานะการจอง)
- [x] **Business Tools**:
  - `the_hill_land_search_plots`: ค้นหาแปลงตามงบประมาณและขนาด
  - `the_hill_land_calculate_installment`: คำนวณตารางผ่อนตรง 0% 12-36 เดือน
  - `the_hill_land_book_site_visit`: ระบบจองคิวนัดหมายชมที่ดินจริง
  - `the_hill_land_capture_lead`: บันทึกข้อมูลว่าที่ลูกค้าลง CRM

### 2.6 Controlled Rebranding & CI Quality Gates
- [x] ปรับเปลี่ยน Customer-Facing Name จาก `Chaty Bot` -> `Chatto Bot` ทุกจุด
- [x] สร้างสคริปต์ `scripts/check-brand-compliance.ts` เพื่อป้องกันคำต้องห้ามหลุดเข้า codebase
- [x] Automated Test Suites: ครอบคลุม 10 ไฟล์ 16 suites 34 tests ผ่าน 100%

### 2.7 Modern Web Admin & Interactive Sandbox UI
- [x] หน้า Admin Dashboard ที่สวยงาม สไตล์ Dabby.io (`apps/web-admin/public/index.html`)
  - Sidebar Navigation: Dashboard, Live Chat Sandbox, CRM Leads, Knowledge Base, Agent Studio, Unified Inbox
  - Interactive Simulator สำหรับจำลอง Webhooks (LINE, Facebook, Web Chat)
  - Dark / Light Mode รองรับการใช้งานแบบ Enterprise

---

## 3. สิ่งที่รอทำต่อไป (Roadmap & Pending Tasks)

### Priority 1: Real LLM Gateway Integration (สำคัญที่สุด)
- [ ] **LLM Provider Connector**: สร้าง Service เชื่อมต่อกับ Claude API (Anthropic SDK), OpenAI (GPT-4o), หรือ Google Gemini
- [ ] **Streaming Responses & Fallback**: รองรับ Token Streaming และ Fallback Gateway เมื่อ API ใด API หนึ่งหน่วงหรือล่ม
- [ ] **Automated Tool Calling Parser**: ให้ LLM ตัดสินใจเรียก Tool Registry อัตโนมัติ (Function Calling) แทน Regex/Keyword Heuristics ปัจจุบัน

### Priority 2: Distributed Job Queue & Follow-up Scheduler
- [ ] **Redis / BullMQ Integration**: ย้าย In-Memory Timeouts ไปสู่ Persistent Job Queue
- [ ] **Follow-up Sequence Runner**: บอทส่งข้อความทักหาลูกค้าที่ทิ้งช่วงการสนทนา (Lead Recovery) ภายใน 2 ชั่วโมง / 24 ชั่วโมง
- [ ] **Dead Letter Queue (DLQ)**: กักเก็บ Webhooks หรือ API calls ที่เรียกไม่สำเร็จเพื่อ retry อย่างปลอดภัย

### Priority 3: Production Database Migration (Postgres)
- [ ] ติดตั้ง `PostgresCrmRepository` และเชื่อมต่อ PostgreSQL / Supabase
- [ ] Migration Runner รองรับ Dialect ของ PostgreSQL
- [ ] Connection Pooling (`pg-pool`)

### Priority 4: Production Deployment & Secret Encryption
- [ ] **Data at Rest Encryption**: เข้ารหัส Channel Secret และ Access Token ในตาราง `channel_configs` ด้วย AES-256-GCM
- [ ] **Dockerfile & Docker Compose**: สำหรับรัน Node.js + PostgreSQL + Redis
- [ ] **CI/CD Pipeline**: GitHub Actions รัน `npm run ci` ก่อน Deploy

### Priority 5: RAG Vector Embeddings
- [ ] เปลี่ยน Knowledge Search จาก Keyword/Substring Matching เป็น Vector Embeddings (OpenAI `text-embedding-3-small` หรือ local embeddings) ร่วมกับ `pgvector` หรือ `sqlite-vss`

### Priority 6: UI Component Modularization
- [ ] แยกไฟล์ `apps/web-admin/public/index.html` (2,489 บรรทัด) ออกเป็น Modular Components (หรือย้ายเป็น Vite + React / Vue)

---

## 4. ปัญหาต่างๆ และความเสี่ยงทางเทคนิค (Known Issues & Technical Debt)

| รายการ | ปัญหา / ความเสี่ยง | วิธีการแก้ไข / คำแนะนำสำหรับ AI ถัดไป |
|---|---|---|
| **1. Orchestrator Rule-based** | ปัจจุบันยังจำลองคำตอบด้วย Regex Logic ใน `packages/agent-runtime/src/orchestrator.ts` ยังไม่ได้เรียก LLM จริง | สร้าง `packages/agent-runtime/src/llm-gateway.ts` เชื่อม Claude/OpenAI โดยใช้ Schema ของ Tools ที่มีอยู่แล้วใน `ToolRegistry` |
| **2. Plaintext Secrets ใน DB** | ตาราง `channel_configs` เก็บ Access Token และ Secret เป็น Plaintext | สร้าง Crypto Utility เข้ารหัสก่อน `INSERT` และถอดรหัสก่อน `verifySignature` โดยใช้ Master Key จาก ENV |
| **3. UI Monolith File** | `apps/web-admin/public/index.html` รวมทุกอย่างไว้ในไฟล์เดียว ทำให้แก้ไขลำบากถ้าโครงการขยาย | แยกไฟล์ JS และ CSS ออกมา หรือพิจารณา Setup Vite React Dashboard ใน `apps/web-admin` |
| **4. In-Memory Job State** | งาน Follow-up หรือ Timeout ต่างๆ ยังอยู่ใน Node.js Event Loop หากเซิร์ฟเวอร์ Restart ข้อมูลจะหาย | นำ BullMQ / Redis มาเป็นตัวบันทึก Persistent Task Queue |
| **5. Non-Text LINE/FB Events** | หากลูกค้าส่งภาพถ่ายโฉนด สลิปโอนเงิน หรือโลเคชัน ระบบยังตอบว่าไม่รองรับ | เพิ่ม Media Handler Adapter และเชื่อมต่อ Vision Model / OCR |

---

## 5. คำสั่งที่จำเป็นสำหรับนักพัฒนาและ AI (Commands Reference)

```bash
# 1. ติดตั้ง Dependencies (ถ้ายังไม่ได้ทำ)
npm install

# 2. ตรวจสอบคุณภาพทั้งหมด (CI Pipeline: Lint + Brand Check + Tests)
npm run ci

# 3. รันเฉพาะ Automated Tests ทั้งหมด (34 tests)
npm test

# 4. รัน TypeScript Linting (Strict Check)
npm run lint

# 5. รัน Brand Compliance Audit
npm run check:brand

# 6. เริ่มต้นเซิร์ฟเวอร์ Development (Hot-reload)
npm run dev
# เข้าใช้งานเว็บแอดมินและ Sandbox ที่: http://localhost:3000
```

---

## 6. Monorepo Map & Key Files

- `apps/api/src/server.ts`: HTTP Server, Webhook Router (LINE, Facebook, Web), REST Endpoints, Static File Serving
- `apps/api/src/security.ts`: Bearer Token Authentication, Origin CORS Guard
- `apps/web-admin/public/index.html`: Web Admin & Omnichannel Sandbox UI
- `packages/core/src/`:
  - `database.ts`: SQLite WAL Manager & Repository Factories
  - `context.ts`: Multi-tenant AsyncLocalStorage context
  - `idempotency.ts`: Webhook deduplication store
  - `migrations/`: Schema migration runner and version files (`001` - `004`)
- `packages/channel-adapters/src/`:
  - `line-adapter.ts`: LINE OA HMAC-SHA256 signature verification & event parsing
  - `facebook-adapter.ts`: Facebook challenge handshake & event ingestion
  - `index.ts`: Ingestion Orchestrator
- `packages/crm/src/index.ts`: Contacts, Conversations, Messages, Leads, Notes, Anti-collision locks
- `packages/agent-runtime/src/`:
  - `orchestrator.ts`: Conversation workflow, Citation generation, Bot Pause logic
  - `prompt-service.ts`: Agent Studio Prompt Versioning (Draft/Publish/Rollback)
  - `ingestion.ts`: CSV & Markdown Knowledge Ingestion
  - `index.ts`: Knowledge Base & Tool Registry
- `packages/vertical-packs/the-hill-land/src/index.ts`: The Hill Land domain pack, synthetic plots, mortgage calculator, booking tools
- `tests/`: 10 comprehensive test files testing all core gates

---

## 7. Direct Instructions & Prompt for the Next AI Agent

เมื่อ AI ตัวต่อไปเริ่มทำงาน ให้ส่ง Prompt ด้านล่างนี้ให้ทันที:

```markdown
คุณคือ Senior AI Platform Engineer ที่ได้รับมอบหมายให้พัฒนาต่อยอดโครงการ Chatto Bot (Multi-tenant AI Operations SaaS Platform)
โปรดอ่านและยึดมั่นตามข้อกำหนดใน HANDOFF_FOR_NEXT_AI.md อย่างเคร่งครัด:

1. **Brand Standard**: ใช้ชื่อ "Chatto Bot" (สโลแกน: ตอบไว เข้าใจลูกค้า ทำงานแทนคุณ) และ persona "น้อง Chatto" ห้ามใช้ชื่อเดิม "Chaty Bot" เด็ดขาด โดยรัน `npm run check:brand` เพื่อตรวจสอบเสมอ
2. **Quality Gate**: ก่อนส่งมอบงานทุกครั้ง ต้องมั่นใจว่าคำสั่ง `npm run ci` ทำงานผ่าน 100% (ไม่มี Lint Error, ไม่มี Brand Violation, และ 34+ Tests ผ่านทั้งหมด)
3. **Multi-tenant Isolation**: ทุกฟังก์ชันต้องทำงานภายใต้ Tenant Context เสมอ และห้ามมี Default Tenant ใน Production
4. **Actionable Priority**: ดำเนินการต่อใน Roadmap ข้อ 1 (LLM Gateway Integration) หรือเชื่อมต่อ Database/Message Queue ตามที่ได้รับมอบหมาย
```
