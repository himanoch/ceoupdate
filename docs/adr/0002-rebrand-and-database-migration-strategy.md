# ADR 0002: Controlled Rebrand to Chatto Bot, Database Migration Runner, and API Security Hardening

- **Status**: Accepted
- **Date**: 2026-09-23
- **Author**: Principal Product Engineer & Solution Architect
- **Context**: Chatto Bot Platform Evolution & Production Readiness (Design Partner: The Hill Land)

---

## 1. Context & Problem Statement

ในการพัฒนาต่อยอดแพลตฟอร์ม Chaty Bot สู่ผลิตภัณฑ์ SaaS ระดับ Commercial ภายใต้ชื่อ **Chatto Bot** ("ตอบไว เข้าใจลูกค้า ทำงานแทนคุณ") จำเป็นต้องจัดการข้อกำหนดสำคัญ 3 ด้าน:

1. **Controlled Rebrand**: ปรับเปลี่ยนชื่อแบรนด์จาก `Chaty Bot` เป็น `Chatto Bot` ให้เรียบร้อย โดยแยกส่วน Customer-Facing (UI, Title, ข้อความตอบกลับของบอท, Public APIs) ออกจาก Internal Identifiers เพื่อไม่ให้กระทบข้อมูลย้อนหลัง และต้องเก็บบันทึก Inventory ของชื่อเดิมไว้ตรวจสอบ
2. **Database Persistence & Migration Engine**: เปลี่ยนผ่านจาก Prototype In-Memory SQLite ไปสู่โครงสร้างที่รองรับ Persistent File (SQLite WAL mode) และพร้อมสลับเป็น PostgreSQL ในอนาคต ผ่าน Abstract Repository Pattern และมี Migration Runner ที่มี `schema_migrations` เพื่อให้การอัปเกรด Schema ทำซ้ำได้และปลอดภัย
3. **API Security & Tenant Isolation**: ปิดช่องโหว่ความปลอดภัยระดับ Production ได้แก่ Wildcard CORS (`*`), Unauthenticated `x-tenant-id` header/parameter, และการมี Default Tenant ซึ่งอาจนำไปสู่ Cross-Tenant Data Leakage

---

## 2. Rebrand Inventory & Mapping Strategy

### 2.1 Rebrand Inventory
| ตำแหน่งเดิม (Source Location) | ค่าเดิม (Legacy Identifier) | ค่าใหม่ (Chatto Bot Identifier) | ขอบเขต (Scope) |
|---|---|---|---|
| `apps/web-admin/public/index.html` | `Chaty Bot — AI Operations SaaS Platform` | `Chatto Bot — AI Operations SaaS Platform` | Customer-Facing (Web Title) |
| `apps/web-admin/public/index.html` | `Chaty Bot Avatar`, `Chaty Bot AI Operations SaaS` | `Chatto Bot Avatar`, `Chatto Bot AI Operations SaaS` | Customer-Facing (Header & Navigation) |
| `apps/web-admin/public/index.html` | `สวัสดีค่ะ! น้อง Chaty ผู้ช่วยอัจฉริยะ` | `สวัสดีค่ะ! น้อง Chatto ผู้ช่วยอัจฉริยะ` | Customer-Facing (Welcome Message) |
| `apps/web-admin/public/index.html` | `Chaty Bot AI Operations Platform © 2026` | `Chatto Bot AI Operations Platform © 2026` | Customer-Facing (Footer) |
| `packages/agent-runtime/src/orchestrator.ts` | `น้อง Chaty` (Lead confirmation, Property search, Fallback) | `น้อง Chatto` | Customer-Facing (Bot Persona Copy) |
| `apps/api/src/server.ts` | `[Chaty Bot AI Operations Platform] Server running...` | `[Chatto Bot AI Operations Platform] Server running...` | Operational Log Banner |
| `apps/api/src/server.ts` | `/brand-profile.png` routing | เสิร์ฟ `chatto-bot-orange-cap-profile.png` (พร้อม fallback รูปเดิม) | Public Asset Route |
| `package.json` | `"name": "chaty-bot-ai-operations"` | `"name": "chatto-bot-ai-operations"` | Package Metadata |
| `package.json` | `"author": "Chaty Bot Team"` | `"author": "Chatto Bot Team"` | Package Metadata |
| `packages/vertical-packs/the-hill-land/src/index.ts` | `source: 'chaty_bot_the_hill_land'` | `source: 'chatto_bot_the_hill_land'` (พร้อม backward compatibility) | CRM Internal Identifier |
| Assets Directory | `chaty-bot-orange-cap-profile.png`, `chaty-bot-...cover.png` | เก็บไว้เป็น Reference/Archive ไม่ลบทำลาย และใช้ `chatto-bot-orange-cap-profile.png` เป็นภาพหลัก | Brand Assets |

### 2.2 Backward Compatibility & Migration Note
- CRM Lead Source: ระบบกำหนดให้ค่าตั้งต้นเป็น `chatto_bot_the_hill_land` แต่คงค่าคงที่ `LEGACY_CHATY_BOT_SOURCE = 'chaty_bot_the_hill_land'` ไว้ เพื่อให้ระบบรองรับการ Query หรือ Reconcile ข้อมูลย้อนหลังจาก Lead เดิมได้อย่างสมบูรณ์
- ระบบ CI ได้รับการติดตั้งสคริปต์ `scripts/check-brand-compliance.ts` เพื่อป้องกันไม่ให้มีข้อความ `Chaty Bot` หรือ `น้อง Chaty` หลุดเข้าไปใน Customer-facing files

---

## 3. Database Persistence & Migration Engine Architecture

### 3.1 Migration Runner Pattern
- ระบบจัดการ Migration ถูกสร้างขึ้นใน `packages/core/src/migrations/runner.ts`
- ใช้ตาราง `schema_migrations (version TEXT PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`
- Migration แต่ละตัวมีโครงสร้าง:
  ```typescript
  export interface Migration {
    version: string;
    name: string;
    up: (db: DatabaseSync) => void;
  }
  ```
- Migration Runner จะตรวจสอบว่า Migration ใดที่ยังไม่ได้รัน แล้วทำการ Execute ตามลำดับเวอร์ชันแบบ Sequential
- สำหรับ SQLite จะเปิด `PRAGMA foreign_keys = ON;` และ `PRAGMA journal_mode = WAL;` เสมอ เพื่อประสิทธิภาพการเขียนอ่านพร้อมกัน (Concurrency)

### 3.2 Abstract Repository Pattern
- กำหนด Interface ของ Domain Repositories:
  - `ITenantRepository`: จัดการ Tenants, Settings, Status
  - `ICrmRepository`: จัดการ Contacts, Conversations, Messages, Leads
  - `IKnowledgeRepository`: จัดการ Knowledge Sources และ Chunks
  - `IAuditRepository`: จัดการ Immutable Audit Logs
  - `IIdempotencyRepository`: จัดการ Idempotency Keys และ Scopes
- ทำให้ Service Layer ไม่ผูกติดกับ SQLite Implementation ช่วยให้สามารถสลับไปใช้ `PostgresCrmRepository` หรือ ORM อื่นได้โดยไม่ต้องแก้ Code ใน CRM หรือ Agent Runtime

---

## 4. API Security Hardening & Tenant Guard

### 4.1 CORS Policy
- ในโหมด Production (`NODE_ENV === 'production'`):
  - ไม่อนุญาต Wildcard `*`
  - ตรวจสอบ Origin กับค่าคอนฟิก `ALLOWED_ORIGINS` (Comma-separated) หากไม่อยู่ในรายการจะถูกปฏิเสธทันที
- ในโหมด Development: อนุญาต Localhost (`http://localhost:*`, `http://127.0.0.1:*`) เพื่อความสะดวกในการทดสอบ

### 4.2 Authentication & Tenant Identity Enforcement
- **ห้ามเชื่อ `x-tenant-id` จาก Request Header โดยไม่มีการ Authenticate**:
  - สร้าง middleware `authenticateRequest` เพื่อตรวจสอบ `Authorization: Bearer <token>` หรือ API Key
  - Token จะต้องระบุ `tenantId`, `actorType`, และ `actorId` ที่ผ่านการลงนาม (Signed)
- **ห้ามมี Default Tenant ใน Production**:
  - หากไม่มีการส่ง Authenticated Token สำหรับ Endpoint ภายใต้ `/api/` ในสภาพแวดล้อม Production ระบบจะตอบกลับด้วย `401 Unauthorized` ทันที
  - ป้องกันการที่ Client เรียก API โดยไม่ระบุตัวตนแล้วระบบตกเป็นข้อมูลของ Tenant ใด Tenant หนึ่งโดยอัตโนมัติ

---

## 5. Consequences & Release Gates

- **ข้อดี**:
  - แบรนด์ Chatto Bot ถูกบังคับใช้อย่างสม่ำเสมอในทุก Customer-Facing Surface
  - ข้อมูลมีความคงทน (Persistence) สามารถเปิดรันด้วยไฟล์ SQLite ใน Production และรัน `:memory:` ได้อย่างรวดเร็วใน Automated Unit Tests
  - ปิดช่องโหว่ความปลอดภัยระดับพื้นฐาน ก่อนเริ่มเชื่อมต่อ Webhook จริงของ LINE Messaging API
- **Verification Gates**:
  - `npm run lint`: Strict TypeScript no-emit pass
  - `npm run check:brand`: ตรวจสอบ Customer-Facing Files ต้องไม่พบคำต้องห้าม
  - `npm test`: Automated Test Suite ทดสอบ Idempotency, Handoff, Tenant Isolation, E2E, Brand Compliance, และ Security & Migration Runner
  - `npm run ci`: รวมคำสั่งทดสอบคุณภาพทั้งหมดในคำสั่งเดียว
