# MnemioAI — High-Scale Cold-Email Automation Engine

A high-performance, strictly idempotent cold-email orchestration engine built to manage 10,000+ prospects across multi-stage outreach cadences without losing track of contacts or double-emailing prospects. Built with TypeScript, Node.js, Express, Prisma ORM, and PostgreSQL, the system features a controllable virtual clock ("time machine"), mock mail and reply simulators, rate-limit resilient AI personalization via OpenRouter free models, and an intuitive web dashboard.

---

## ⚡ Quickstart (Set Up & Run in a Few Commands)

### 1. Prerequisites
- **Node.js**: v18+ (v20+ recommended)
- **PostgreSQL**: Local PostgreSQL running on port `5432` OR via Docker

### 2. Environment Setup
```bash
# Clone the repository and install dependencies
npm install

# Copy environment template
cp .env.example .env
```
*(Optional: Open `.env` to add an `OPENROUTER_API_KEY` for live AI generation. If left blank, the system automatically uses deterministic, persona-tailored fallback templates).*

### 3. Database Migration & 10,000-Contact Seed
If using Docker for PostgreSQL:
```bash
docker compose up -d
```
Run migrations and populate 10,000 prospects with sensible historical logs:
```bash
npm run db:deploy
npm run seed
```
*(Takes ~2.4 seconds to insert 10,000 contacts, 14,900 email logs, and 1,300 reply logs).*

### 4. Run the Engine & Time Machine
```bash
# Run the sequence workflow across currently due contacts
npm run process

# Advance the virtual clock by 3 days (triggering Follow-up 1)
npm run clock:advance -- --days 3

# Run the workflow cycle again
npm run process

# Simulate prospects replying (interested, OOO, unsubscribes)
npm run replies:simulate -- --count 25

# View the real-time campaign report
npm run report
```

### 5. Launch the Web Dashboard
```bash
npm run dev
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser to view the clean visual dashboard, inspect individual contact audit trails, advance time with one click, and monitor mailbox warm-up quotas.

### 6. Run Automated Tests
```bash
npm test
```

---

## 🏗️ Architecture & Data Model

### Why This Tech Stack?
- **TypeScript + Node.js**: Type safety across asynchronous state machine transitions, with zero runtime overhead for bulk processing.
- **PostgreSQL**: Transactional consistency and ACID guarantees under high throughput.
- **Prisma ORM 7 (`@prisma/adapter-pg`)**: Direct TCP pooled connections with high-speed batch operations (`createMany`), keeping bulk insertions and queries under seconds.
- **Express**: Lightweight HTTP layer serving clean REST endpoints and a minimalist dashboard without the ceremony and CLI startup delays of heavyweight enterprise frameworks.

### Entity-Relationship Diagram

```mermaid
erDiagram
    Contact ||--o{ EmailLog : "receives (1:N)"
    Contact ||--o{ ReplyLog : "sends (1:N)"
    Mailbox ||--o{ EmailLog : "dispatches (1:N)"

    Contact {
        uuid id PK
        string email UK
        string name
        string company
        string role
        string timezone
        string status "new | first_sent | follow_up_1_sent | ..."
        int currentStep "0, 1, 2, 3, or -1"
        datetime nextActionAt "Indexed for due batch polling"
        datetime lastContactedAt
    }

    EmailLog {
        uuid id PK
        uuid contactId FK
        int step "0, 1, 2, 3"
        string subject
        text body
        string status "SENT | BOUNCED"
        string mailboxId
        datetime sentAt
    }

    ReplyLog {
        uuid id PK
        uuid contactId FK
        string classification "INTERESTED | NOT_INTERESTED | OOO | UNSUBSCRIBE"
        text body
        datetime receivedAt
    }

    Suppression {
        uuid id PK
        string email UK
        string reason "UNSUBSCRIBE | BOUNCE | MANUAL"
        datetime createdAt
    }

    VirtualClock {
        string id PK "singleton"
        datetime simulatedNow
        datetime updatedAt
    }

    Mailbox {
        uuid id PK
        string email UK
        int dailyLimit "Ramps up over time"
        int sentTodayCount
        int totalSent
        int totalBounced
        boolean isPaused "Auto-pauses if bounce rate > 10%"
    }
```

---

## 🔄 Lifecycle Rules & Strict Idempotency

### The Outreach Cadence
- **Step 0 (Initial Email)**: Dispatched when contact is `new`.
- **Step 1 (Follow-up 1)**: Dispatched **3 days** after initial send.
- **Step 2 (Follow-up 2)**: Dispatched **5 days** after Follow-up 1.
- **Step 3 (Follow-up 3 / Breakup)**: Dispatched **7 days** after Follow-up 2.
- **Deactivation**: If **7 days** pass after Follow-up 3 without a reply, contact transitions to `deactivated`.

### Termination Rules
1. **Any Reply Received**: Sequence halts immediately (`status: "replied"`, `currentStep: -1`, `nextActionAt: null`).
2. **Hard Bounce**: Sequence halts immediately (`status: "bounced"`), and recipient email is permanently added to `Suppression`.
3. **Unsubscribe Request**: Contact transitions to `unsubscribed`, sequence halts, and email is permanently suppressed.

### How Double-Sends are Strictly Prevented
1. **Database-Level Constraint**:  
   `EmailLog` enforces a composite unique index: `@@unique([contactId, step])`. It is physically impossible at the database engine level to record the same step for the same prospect twice.
2. **Pre-Flight Check**:  
   Before executing a send, `MailerService` verifies whether `(contactId, step)` already exists in `EmailLog`. If so, it returns `ALREADY_SENT` and aborts.
3. **Atomic Date Advancing**:  
   When a step is delivered, the contact's `nextActionAt` is atomically scheduled to the future ($now + \text{wait days}$). Running `npm run process` back-to-back queries `nextActionAt <= now` and finds **0 due contacts**, taking **0.01s** with **0 duplicate sends**.

---

## 🤖 AI Integration & Rate-Limit Shield (OpenRouter Free Tier)

### Where AI is Used
1. **Outreach Personalization**: Writing concise, role-tailored B2B copy for initial emails and follow-ups.
2. **Reply Intent Classification**: Parsing raw inbound emails into `INTERESTED`, `NOT_INTERESTED`, `OUT_OF_OFFICE`, or `UNSUBSCRIBE`.
3. **Model Choice**: Free models from OpenRouter (e.g., `meta-llama/llama-3.2-3b-instruct:free`).

### How We Handle Free Tier Rate Limits at 10,000 Scale
OpenRouter's free tier allows ~10–20 requests/minute. Directly invoking an LLM for 10,000 prospects would trigger immediate `HTTP 429 Too Many Requests` failures. We solved this with a 4-layer shield:

```
[Outreach Event] ──▶ [Layer 1: Persona Segment Cache] ──(Hit)──▶ Returns cached structure with interpolated vars
                                │ (Miss)
                                ▼
                     [Layer 2: OpenRouter Free LLM] (with 4s timeout & 429 guard)
                                │
                                ├──(Success)──▶ Caches segment template
                                │
                                ▼ (429 / Timeout / No Key)
                     [Layer 3: High-Converting Deterministic Fallbacks] (Zero drops)
```

1. **Persona Segment Caching**:  
   Prospects with similar roles (e.g. *VP of Sales* and *Director of Revenue* in *Tech*) share a value proposition. The engine generates copy once per persona segment and caches the template structure. Individual variables (`{{name}}`, `{{company}}`) are dynamically interpolated in memory. This reduces 10,000 external API calls to **~50–100 calls** (a **99% reduction**).
2. **Timeout Guards (4 Seconds)**:  
   Free models can stall during peak traffic. A 4-second `AbortController` ensures batch workers never hang.
3. **Seamless Fallback Templates**:  
   If an evaluator runs without an API key, or if OpenRouter returns 429 or times out, the engine automatically switches to deterministic, persona-tailored fallback templates without dropping a single email.
4. **Heuristic Rule-Based Classifier**:  
   Deterministic keyword/regex classifier as a zero-latency fallback for inbound reply categorization.

---

## 📊 Results of the 10,000-Contact Benchmark Run

*Tested on: Apple M-Series Mac, Native PostgreSQL 16 (TCP connection)*

```bash
npm run benchmark
```

- **Total Prospects Tested:** 10,000
- **Total Simulation Time:** **14.24 seconds** (entire 3-week campaign simulated across 5 cycles)
- **Database Seeding Time (10k rows + 14.9k history logs):** **2.40 seconds**

### Lifecycle Timeline Breakdown
| Stage | Simulated Date | Contacts Scanned | Emails Sent | Bounces | Deactivations | Time Taken |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Day 0: Initial Outreach** | `2026-10-24` | 420 | 403 | 17 | 0 | **0.34s** |
| **Day 3: Follow-Up 1** | `2026-10-27` | 5,983 | 5,693 | 290 | 0 | **3.59s** |
| **Day 8: Follow-Up 2** | `2026-11-01` | 6,020 | 4,957 | 263 | 800 | **3.15s** |
| **Day 15: Follow-Up 3** | `2026-11-08` | 6,380 | 5,125 | 297 | 958 | **3.31s** |
| **Day 22: Deactivations** | `2026-11-15` | 5,125 | 1,680 | 96 | 3,349 | **1.42s** |

### Final Campaign Status Distribution (10,000 Total)
| Status | Count | % of Campaign | Description |
| :--- | :--- | :--- | :--- |
| `new` | 0 | 0.0% | All contacts engaged |
| `first_sent` | 0 | 0.0% | Completed initial stage |
| `follow_up_1_sent` | 0 | 0.0% | Completed FU1 stage |
| `follow_up_2_sent` | 0 | 0.0% | Completed FU2 stage |
| `follow_up_3_sent` | 1,680 | 16.8% | Waiting for final reply or deactivation |
| `replied` | 1,029 | 10.3% | Prospect replied (outreach halted) |
| `bounced` | 1,363 | 13.6% | Hard bounced (suppressed permanently) |
| `unsubscribed` | 321 | 3.2% | Opted out (suppressed permanently) |
| `deactivated` | 5,607 | 56.1% | Concluded without reply |
| **TOTAL** | **10,000** | **100.0%** | **Strictly preserved** |

### Deliverability & Conversions
- **Total Outbound Emails Logged:** 33,721
- **Successfully Delivered:** 32,358
- **Bounces:** 1,363 (4.04%)
- **Inbound Replies:** 1,350 (4.17%)
- **Suppression List Size:** 1,684

---

## 🎁 Bonus Features Included

1. **Mailbox Warm-Up Engine**:
   - Multiple mock sender mailboxes (`alex@...`, `sarah@...`, `campaigns@...`) with configured daily quotas (50, 100, 200/day).
   - Live visual utilization bar on the dashboard showing daily quota consumption.
2. **Spam & Deliverability Guard**:
   - Automatically pauses a mailbox if its bounce rate exceeds 10% on high volumes.
   - Global persistent `Suppression` table checked before every send attempt.
3. **Web Dashboard**:
   - Clean, lightweight interface (HTML/Vanilla CSS/JS) for real-time monitoring and one-click time travel.
4. **Comprehensive Automated Test Suite**:
   - 7 unit & integration tests (`npm test`) covering idempotency, suppression, sequence progression, and intent classification.

---

## ⚖️ Trade-offs, Known Limitations & What to Build Next

### Trade-offs Made
- **In-Memory Persona Cache vs. Distributed Redis**:  
  For an 8–10 hour assignment and single-node deployment, an in-memory segment cache is transparent, zero-dependency, and blazing fast. In a distributed multi-replica deployment, this would be backed by Redis or PostgreSQL `pg_trgm` caching.
- **Batched DB Polling vs. Distributed Job Queue (BullMQ / Temporal)**:  
  Using PostgreSQL indexed queries (`WHERE status IN (...) AND nextActionAt <= now`) avoids external Redis dependencies while easily handling 100,000+ contacts in milliseconds. For production with millions of contacts, a distributed queue like BullMQ or Temporal would provide distributed workers.

### What to Build Next
1. **Recipient Timezone Sending Windows**:  
   Restricting dispatches strictly between 09:00 and 17:00 in each prospect's local timezone (e.g., `America/New_York` vs. `Asia/Tokyo`).
2. **A/B Subject Line Testing**:  
   Generating multiple persona variants with automated winner selection based on open/reply metrics.
3. **Domain Pacing Limits**:  
   Limiting sends to a maximum of 3 emails/day to the same domain (e.g. `@acmecloud.io`) to avoid spam filter domain burns.
