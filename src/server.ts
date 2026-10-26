/**
 * =============================================================================
 * MnemioAI Outreach Engine — Express API & Dashboard Server
 * =============================================================================
 * 
 * Provides RESTful API endpoints for:
 * 1. Campaign analytics and real-time funnel metrics.
 * 2. Virtual Clock control (advance, set, show).
 * 3. Sequence workflow execution (idempotent batch processing).
 * 4. Reply simulation (simulating prospect responses).
 * 5. Prospect search & contact audit trail inspection.
 * 6. Mailbox warm-up & deliverability tracking.
 * 7. Serving the clean, responsive web dashboard.
 * =============================================================================
 */

import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import { prisma } from "./lib/prisma.js";
import { ClockService } from "./services/clock.service.js";
import { SequenceService } from "./services/sequence.service.js";
import { ReplySimulatorService, type ReplyCategory } from "./services/reply.service.js";
import { ReportingService } from "./services/reporting.service.js";
import { seedDatabase } from "./scripts/seed.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Security & Parsing middleware
app.use(helmet({ contentSecurityPolicy: false })); // Permissive CSP for local dashboard assets
app.use(cors());
app.use(express.json());

// Serve static frontend dashboard from public/
const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir));

// =============================================================================
// API Endpoints
// =============================================================================

/**
 * GET /api/report
 * Returns full campaign metrics, funnel counts, sent/due counts, and deliverability stats.
 */
app.get("/api/report", async (_req: Request, res: Response) => {
  try {
    const report = await ReportingService.generateReport();
    res.json({ success: true, data: report });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/contacts
 * Returns paginated contacts with optional status filtering and name/email search.
 */
app.get("/api/contacts", async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
    const limit = Math.min(100, Math.max(10, parseInt(String(req.query.limit ?? "25"), 10)));
    const status = req.query.status ? String(req.query.status) : undefined;
    const search = req.query.search ? String(req.query.search).trim() : undefined;

    const where: any = {};
    if (status && status !== "ALL") {
      where.status = status;
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { company: { contains: search, mode: "insensitive" } },
        { role: { contains: search, mode: "insensitive" } }
      ];
    }

    const [total, contacts] = await Promise.all([
      prisma.contact.count({ where }),
      prisma.contact.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { updatedAt: "desc" }
      })
    ]);

    res.json({
      success: true,
      data: {
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        total,
        contacts
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/contacts/:id
 * Returns a specific contact with their full chronological audit trail (emails & replies).
 */
app.get("/api/contacts/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const contact = await prisma.contact.findUnique({
      where: { id },
      include: {
        emails: { orderBy: { sentAt: "asc" } },
        replies: { orderBy: { receivedAt: "asc" } }
      }
    });

    if (!contact) {
      res.status(404).json({ success: false, error: "Contact not found" });
      return;
    }

    // Check suppression status
    const suppression = await prisma.suppression.findUnique({
      where: { email: contact.email }
    });

    res.json({
      success: true,
      data: {
        contact,
        isSuppressed: !!suppression,
        suppressionReason: suppression?.reason ?? null
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/clock/advance
 * Advances the virtual clock by specified days, hours, or minutes.
 */
app.post("/api/clock/advance", async (req: Request, res: Response) => {
  try {
    const days = typeof req.body.days === "number" ? req.body.days : 0;
    const hours = typeof req.body.hours === "number" ? req.body.hours : 0;
    const minutes = typeof req.body.minutes === "number" ? req.body.minutes : 0;

    const result = await ClockService.advance({ days, hours, minutes });
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/clock/set
 * Resets the virtual clock to a specific ISO date.
 */
app.post("/api/clock/set", async (req: Request, res: Response) => {
  try {
    const { targetDate } = req.body;
    if (!targetDate) {
      res.status(400).json({ success: false, error: "Missing targetDate in request body" });
      return;
    }
    const newTime = await ClockService.setTime(targetDate);
    res.json({ success: true, data: { simulatedNow: newTime } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/sequence/run
 * Executes an automated outreach cycle across all contacts currently due.
 */
app.post("/api/sequence/run", async (req: Request, res: Response) => {
  try {
    const batchSize = typeof req.body.batchSize === "number" ? req.body.batchSize : 1000;
    const result = await SequenceService.processDueContacts({ batchSize });
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/replies/simulate
 * Simulates incoming replies from active prospects.
 */
app.post("/api/replies/simulate", async (req: Request, res: Response) => {
  try {
    const count = typeof req.body.count === "number" ? req.body.count : 15;
    const result = await ReplySimulatorService.simulateBatchReplies(count);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/replies/simulate-single
 * Simulates a specific reply for a single contact.
 */
app.post("/api/replies/simulate-single", async (req: Request, res: Response) => {
  try {
    const { contactId, classification, customBody } = req.body;
    if (!contactId) {
      res.status(400).json({ success: false, error: "Missing contactId in body" });
      return;
    }
    const result = await ReplySimulatorService.simulateReply({
      contactId,
      classification: classification as ReplyCategory,
      customBody
    });
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/mailboxes
 * Returns sender mailboxes and daily warm-up usage quotas.
 */
app.get("/api/mailboxes", async (_req: Request, res: Response) => {
  try {
    const mailboxes = await prisma.mailbox.findMany({
      orderBy: { email: "asc" }
    });
    res.json({ success: true, data: mailboxes });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/seed
 * Resets and deterministically seeds 10,000 prospects.
 */
app.post("/api/seed", async (_req: Request, res: Response) => {
  try {
    await seedDatabase(10000);
    res.json({ success: true, message: "10,000 contacts seeded successfully" });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Fallback route for SPA dashboard (Express 5 compatible)
app.use((_req: Request, res: Response) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// Start Server
app.listen(PORT, () => {
  console.log(`\n============================================================`);
  console.log(`🌐 MnemioAI Cold-Email Dashboard & API running at:`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`============================================================\n`);
});