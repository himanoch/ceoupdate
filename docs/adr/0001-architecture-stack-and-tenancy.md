# ADR 0001: Technology Stack, Multi-Tenancy Strategy, Authentication, Job Queue, and Safe Tool Execution

- **Status**: Accepted
- **Date**: 2026-09-23
- **Author**: Principal Product Engineer & Solution Architect
- **Context**: Chatto Bot Platform Architecture (Design Partner: The Hill Land) [Note: Formally rebrand from Chaty Bot, see ADR 0002]

---

## 1. Context & Problem Statement

แพลตฟอร์ม Chatto Bot (เดิม Chaty Bot) ต้องทำหน้าที่เป็น AI Operations Multi-tenant SaaS สำหรับรับข้อความจากหลากหลายช่องทาง (LINE, Facebook Messenger, Web Chat) แล้วแปลงบทสนทนาเป็น Lead, นัดหมาย, งานติดตาม (Task) และ Service Ticket โดยมี The Hill Land เป็นลูกค้ารายแรก แต่แกนกลาง (Core) ต้องไม่มี logic เฉพาะเจาะจงของลูกค้ารายใด เพื่อให้สามารถนำไปขายต่อธุรกิจอื่นได้ทันทีโดยไม่ต้อง fork codebase

ระบบต้องการ:
1. ความปลอดภัยและการแยกข้อมูล (Tenant Isolation) ระดับสูงสุด
2. การตอบสนองที่รวดเร็ว ไม่บล็อก Webhook ingestion
3. ความแม่นยำ ปราศจากการแต่งข้อมูล (Grounded AI answers with citations)
4. การทำงานของเครื่องมือ (Tool Execution) ที่ปลอดภัย มีสิทธิ์การเข้าถึง และ Idempotent
5. การสลับงานให้มนุษย์ (Human Handoff) เป็น First-class citizen

---

## 2. Decision Summary

| หมวดหมู่ | ทางเลือกที่เลือก | เหตุผลและ Trade-offs |
|---|---|---|
| **Architecture** | **Modular Monolith** | รวมโค้ดใน repository เดียว แต่แบ่ง boundaries ชัดเจน (`core`, `crm`, `agent-runtime`, `operations`, `vertical-packs`) บำรุงรักษาง่าย ไม่ต้องแบกรับ overhead ของ microservices จนกว่าจะมีทีมหรือ scale แยกกัน |
| **Language & Runtime** | **Node.js (v24 LTS) + TypeScript** | Type Safety ตลอดสาย, รองรับ AsyncLocalStorage สำหรับ TenantContext, มี ecosystem กว้างขวางสำหรับ LLM tools และ Webhook handling |
| **Tenancy Isolation** | **Row-Level with Mandatory Context Guard** | ทุกตาราง/เอนทิตีมี `tenant_id` และทุก query ต้องผ่าน `TenantContext` Guard ป้องกัน cross-tenant breach โดยไม่ต้องสร้าง DB แยกทุก tenant ในระยะแรก |
| **Database & ORM** | **SQLite (WAL Mode) + SQL/Repository Pattern** | เริ่มต้นด้วย SQLite ในโหมด WAL ที่มี zero-dependency รันได้ทันทีทั้งบน Local, CI และ Container โดยออกแบบ Data Access Layer เป็น Abstract Repository ที่สามารถสลับเป็น PostgreSQL + pgvector ได้อย่างไร้รอยต่อ |
| **Authentication & AuthZ** | **Bearer JWT + API Key Scopes + TenantContext** | แยก Actor เป็น 4 กลุ่ม: `customer`, `agent_ai`, `agent_human`, `admin` ตรวจสอบ tenant_id จาก authenticated token เสมอ ห้ามเชื่อ tenant_id ที่ client ส่งมาใน payload |
| **Job Queue & Asynchrony** | **In-Memory Transactional Queue with DLQ** | Webhook รับข้อความแล้วตอบ HTTP 200 ทันทีแล้วดันเข้า background queue พร้อม retry limit (3 ครั้ง) และ Dead-letter Queue (DLQ) รองรับการสลับไปใช้ Redis/BullMQ เมื่อขยายระบบ |
| **Tool Execution & Safety** | **Typed Command Registry + JSON Schema + Idempotency** | AI ห้ามเขียนฐานข้อมูลโดยตรง ต้องเรียกผ่าน Typed Tool ที่มี Schema Validation, Idempotency Key, Audit Logging, และแยกชัดเจนระหว่าง Read Tools และ Write Tools (ที่ต้องมี Approval Policy) |

---

## 3. Detailed Architectural Principles

### 3.1 Policy Precedence Hierarchy
เพื่อให้มั่นใจว่า AI จะไม่ถูก Prompt Injection จากข้อความของลูกค้า หรือเนื้อหาเอกสารภายนอก ระบบกำหนดลำดับความสำคัญของกฎ (Precedence Order) ดังนี้:
```text
System Policy > Tenant Policy > Vertical Policy > Workflow Instruction > Retrieved Knowledge > User Message
```
*Retrieved Documents และ User Messages ถือเป็น **Untrusted Data** เสมอ ห้ามให้เนื้อหาเหล่านั้นเขียนทับกฎความปลอดภัยหรือสิทธิ์ของระบบ*

### 3.2 Tenant Isolation & Context Propagation
- ใช้ Node.js `AsyncLocalStorage` ในการ bind `TenantContext` (`tenant_id`, `actor_type`, `correlation_id`) ตลอด Request/Execution lifecycle
- Data Access Repository ทุกตัวจะ inject `tenant_id` ลงใน WHERE clause และ INSERT query โดยอัตโนมัติ หากไม่มี `tenant_id` ใน context จะโยน `TenantContextMissingError` ทันที

### 3.3 Idempotency Strategy
- ทุก Webhook event มี `idempotency_key` ที่สร้างจาก `channel + message_id` หรือ `delivery_token`
- มี `IdempotencyStore` เพื่อตรวจสอบว่าข้อความนี้ถูกประมวลผลแล้วหรือกำลังประมวลผลอยู่ ป้องกันการตอบซ้ำ หรือการสร้าง Lead ซ้ำซ้อนเมื่อ Webhook ยิง retry เข้ามา

### 3.4 Clean-Room Separation of The Hill Land
- แกนกลาง (Core) ไม่รู้จักชื่อ "The Hill Land", ไม่รู้จักคำว่า "แปลงที่ดิน", "โฉนด", หรือ "WTR"
- สเปกทั้งหมดของ The Hill Land ถูก encapsulate ไว้ในโฟลเดอร์ `packages/vertical-packs/the-hill-land` ซึ่ง implement อินเตอร์เฟซมาตรฐาน:
  - `KnowledgePack`: แหล่งข้อมูลและเนื้อหา
  - `ToolPack`: เครื่องมือค้นหาทรัพย์ ตรวจสอบราคา และเก็บ Lead
  - `PromptPack`: Runtime persona และ business instructions

---

## 4. Consequences & Verification
- **ข้อดี**: พัฒนาง่าย ทดสอบได้ 100% แบบ Automated Unit & E2E tests โดยไม่ต้องพึ่ง external service, ปลอดภัยจากการรั่วไหลของข้อมูลระหว่างผู้เช่า, บำรุงรักษาในระยะยาวได้จริง
- **ข้อพิจารณาในอนาคต**: เมื่อเข้าสู่ Production Scale จะเชื่อมต่อ PostgreSQL (Row-Level Security หรือ schema isolation) และ Redis BullMQ สำหรับ Distributed Worker
