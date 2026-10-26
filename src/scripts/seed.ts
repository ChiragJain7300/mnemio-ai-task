/**
 * =============================================================================
 * Deterministic Seed Script for MnemioAI Cold-Email Engine
 * =============================================================================
 * 
 * Purpose:
 * Generates ~10,000 realistic prospects with complete historical audit trails.
 * Uses a deterministic Mulberry32 PRNG with a fixed seed so every execution
 * produces identical, reproducible data for evaluation.
 * 
 * Execution:
 * npm run seed
 * =============================================================================
 */

import "dotenv/config";
import { prisma } from "../lib/prisma.js";

// Fixed random seed for complete reproducibility across evaluator runs
const FIXED_SEED = 42;

/**
 * Mulberry32: A fast, high-quality 32-bit deterministic Pseudo-Random Number Generator.
 * Given the same seed, it always outputs the exact same sequence of pseudo-random numbers in [0, 1).
 */
function createPRNG(seed: number) {
  let s = seed >>> 0;
  return function nextFloat(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = createPRNG(FIXED_SEED);

/** Helper to pick a random integer in [min, max] inclusive */
function randInt(min: number, max: number): number {
  return Math.floor(random() * (max - min + 1)) + min;
}

/** Helper to pick a random item from an array */
function pick<T>(arr: T[]): T {
  const index = Math.floor(random() * arr.length);
  return arr[index]!;
}

// -----------------------------------------------------------------------------
// Sample Data Pools
// -----------------------------------------------------------------------------
const FIRST_NAMES = [
  "Alexander", "Sophia", "Liam", "Olivia", "Noah", "Emma", "James", "Ava", "William", "Isabella",
  "Benjamin", "Mia", "Lucas", "Charlotte", "Henry", "Amelia", "Theodore", "Harper", "Jack", "Evelyn",
  "Arjun", "Priya", "Rohan", "Ananya", "Vikram", "Sneha", "Karan", "Pooja", "Rahul", "Meera",
  "Chen", "Wei", "Yuki", "Kenji", "Mateo", "Camila", "Elena", "Marcus", "Chloe", "Lukas"
];

const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez",
  "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin",
  "Patel", "Sharma", "Verma", "Rao", "Gupta", "Nair", "Ito", "Tanaka", "Wong", "Zhang", "Muller", "Schmidt"
];

const COMPANIES = [
  { name: "Acme Cloud", domain: "acmecloud.io" },
  { name: "Nexus AI", domain: "nexusai.com" },
  { name: "Vanguard Logistics", domain: "vanguardlog.com" },
  { name: "Starlight FinTech", domain: "starlightfin.com" },
  { name: "Horizon Health", domain: "horizonhealth.co" },
  { name: "Pulse Analytics", domain: "pulseanalytics.net" },
  { name: "Catalyst Dev", domain: "catalystdev.org" },
  { name: "Hyperion Labs", domain: "hyperionlabs.ai" },
  { name: "Beacon Security", domain: "beaconsec.io" },
  { name: "Apex Commerce", domain: "apexcommerce.com" },
  { name: "Crestview Media", domain: "crestviewmedia.com" },
  { name: "Synergy Bio", domain: "synergybio.tech" }
];

const ROLES = [
  "VP of Sales",
  "Head of Growth",
  "Chief Technology Officer",
  "Director of Demand Gen",
  "VP of Marketing",
  "Founder & CEO",
  "Chief Revenue Officer",
  "Head of Operations",
  "Lead Automation Architect",
  "Director of Business Development"
];

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo"
];

// Reference anchor point for the virtual clock (e.g., Oct 24, 2026, 09:00 UTC)
const BASE_DATE = new Date("2026-10-24T09:00:00.000Z");

/** Helper to add/subtract days from a date */
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/** Helper to add/subtract hours from a date */
function addHours(date: Date, hours: number): Date {
  const result = new Date(date);
  result.setUTCHours(result.getUTCHours() + hours);
  return result;
}

// -----------------------------------------------------------------------------
// Main Seed Function
// -----------------------------------------------------------------------------
export async function seedDatabase(totalContacts = 10000) {
  const startTime = Date.now();
  console.log(`\n============================================================`);
  console.log(`🌱 Seeding ${totalContacts} contacts with realistic sequence history...`);
  console.log(`   Random Seed: ${FIXED_SEED} (Deterministic)`);
  console.log(`   Base Virtual Clock: ${BASE_DATE.toISOString()}`);
  console.log(`============================================================\n`);

  // 1. Reset existing tables for clean idempotency
  console.log("🧹 Clearing existing data...");
  await prisma.replyLog.deleteMany();
  await prisma.emailLog.deleteMany();
  await prisma.suppression.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.mailbox.deleteMany();
  await prisma.virtualClock.deleteMany();

  // 2. Initialize Virtual Clock
  await prisma.virtualClock.create({
    data: {
      id: "singleton",
      simulatedNow: BASE_DATE
    }
  });

  // 3. Initialize Bonus Mailboxes for warm-up & delivery simulation
  const mockMailboxes = [
    { email: "alex@outreach-mnemio.com", dailyLimit: 50 },
    { email: "sarah@outreach-mnemio.com", dailyLimit: 100 },
    { email: "campaigns@outreach-mnemio.com", dailyLimit: 200 }
  ];
  await prisma.mailbox.createMany({
    data: mockMailboxes.map((m) => ({
      email: m.email,
      dailyLimit: m.dailyLimit,
      sentTodayCount: 0,
      totalSent: 0,
      totalBounced: 0,
      isPaused: false
    }))
  });

  // 4. Distribution plan across 10,000 contacts:
  // - new: 25% (2500)
  // - first_sent: 20% (2000)
  // - follow_up_1_sent: 15% (1500)
  // - follow_up_2_sent: 10% (1000)
  // - follow_up_3_sent: 8% (800)
  // - replied: 10% (1000)
  // - bounced: 4% (400)
  // - unsubscribed: 3% (300)
  // - deactivated: 5% (500)
  const STATUS_POOL = [
    ...Array(25).fill("new"),
    ...Array(20).fill("first_sent"),
    ...Array(15).fill("follow_up_1_sent"),
    ...Array(10).fill("follow_up_2_sent"),
    ...Array(8).fill("follow_up_3_sent"),
    ...Array(10).fill("replied"),
    ...Array(4).fill("bounced"),
    ...Array(3).fill("unsubscribed"),
    ...Array(5).fill("deactivated")
  ];

  // In-memory collection arrays for batch insertion
  const contactsData: Array<{
    id: string;
    email: string;
    name: string;
    company: string;
    role: string;
    timezone: string;
    status: string;
    currentStep: number;
    nextActionAt: Date | null;
    lastContactedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }> = [];

  const emailLogsData: Array<{
    contactId: string;
    step: number;
    subject: string;
    body: string;
    status: string;
    mailboxId: string;
    sentAt: Date;
  }> = [];

  const replyLogsData: Array<{
    contactId: string;
    classification: string;
    body: string;
    receivedAt: Date;
  }> = [];

  const suppressionData: Array<{
    email: string;
    reason: string;
    createdAt: Date;
  }> = [];

  console.log("🔨 Generating 10,000 contacts & chronologically coherent audit logs...");

  for (let i = 1; i <= totalContacts; i++) {
    const firstName = pick(FIRST_NAMES);
    const lastName = pick(LAST_NAMES);
    const companyObj = pick(COMPANIES);
    const role = pick(ROLES);
    const timezone = pick(TIMEZONES);
    
    // Deterministic UUID based on index
    const contactId = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@${companyObj.domain}`;
    const status = STATUS_POOL[(i - 1) % STATUS_POOL.length]!;

    let currentStep = 0;
    let nextActionAt: Date | null = null;
    let lastContactedAt: Date | null = null;

    // Build realistic historical timestamps according to campaign cadence (3d, 5d, 7d intervals)
    if (status === "new") {
      currentStep = 0;
      // Some are due today, some due tomorrow
      nextActionAt = addHours(BASE_DATE, randInt(-4, 24));
    } else if (status === "first_sent") {
      currentStep = 0;
      const sentDaysAgo = randInt(1, 2);
      const sentAt = addDays(BASE_DATE, -sentDaysAgo);
      lastContactedAt = sentAt;
      // Next follow-up is scheduled 3 days after first send
      nextActionAt = addDays(sentAt, 3);

      emailLogsData.push({
        contactId,
        step: 0,
        subject: `Quick question regarding ${companyObj.name}'s outreach`,
        body: `Hi ${firstName}, noticed your work as ${role} at ${companyObj.name}. Would love to share a quick idea.`,
        status: "SENT",
        mailboxId: pick(mockMailboxes).email,
        sentAt
      });
    } else if (status === "follow_up_1_sent") {
      currentStep = 1;
      const tFirst = addDays(BASE_DATE, -5);
      const tFU1 = addDays(tFirst, 3);
      lastContactedAt = tFU1;
      // Follow-up 2 is scheduled 5 days after Follow-up 1
      nextActionAt = addDays(tFU1, 5);

      emailLogsData.push(
        {
          contactId,
          step: 0,
          subject: `Quick question regarding ${companyObj.name}'s outreach`,
          body: `Hi ${firstName}, following up on my previous note.`,
          status: "SENT",
          mailboxId: pick(mockMailboxes).email,
          sentAt: tFirst
        },
        {
          contactId,
          step: 1,
          subject: `Re: Quick question regarding ${companyObj.name}'s outreach`,
          body: `Hi ${firstName}, wanted to bubble this up in case it got buried.`,
          status: "SENT",
          mailboxId: pick(mockMailboxes).email,
          sentAt: tFU1
        }
      );
    } else if (status === "follow_up_2_sent") {
      currentStep = 2;
      const tFirst = addDays(BASE_DATE, -11);
      const tFU1 = addDays(tFirst, 3);
      const tFU2 = addDays(tFU1, 5);
      lastContactedAt = tFU2;
      // Follow-up 3 is scheduled 7 days after Follow-up 2
      nextActionAt = addDays(tFU2, 7);

      emailLogsData.push(
        {
          contactId,
          step: 0,
          subject: `Initial outreach`,
          body: `First email body`,
          status: "SENT",
          mailboxId: pick(mockMailboxes).email,
          sentAt: tFirst
        },
        {
          contactId,
          step: 1,
          subject: `Re: Initial outreach`,
          body: `Follow-up 1 body`,
          status: "SENT",
          mailboxId: pick(mockMailboxes).email,
          sentAt: tFU1
        },
        {
          contactId,
          step: 2,
          subject: `Re: Initial outreach (check-in)`,
          body: `Follow-up 2 body with case study`,
          status: "SENT",
          mailboxId: pick(mockMailboxes).email,
          sentAt: tFU2
        }
      );
    } else if (status === "follow_up_3_sent") {
      currentStep = 3;
      const tFirst = addDays(BASE_DATE, -18);
      const tFU1 = addDays(tFirst, 3);
      const tFU2 = addDays(tFU1, 5);
      const tFU3 = addDays(tFU2, 7);
      lastContactedAt = tFU3;
      // Deactivation is scheduled 7 days after final follow-up if no reply
      nextActionAt = addDays(tFU3, 7);

      emailLogsData.push(
        { contactId, step: 0, subject: "Initial", body: "1st", status: "SENT", mailboxId: pick(mockMailboxes).email, sentAt: tFirst },
        { contactId, step: 1, subject: "FU1", body: "2nd", status: "SENT", mailboxId: pick(mockMailboxes).email, sentAt: tFU1 },
        { contactId, step: 2, subject: "FU2", body: "3rd", status: "SENT", mailboxId: pick(mockMailboxes).email, sentAt: tFU2 },
        { contactId, step: 3, subject: "Final follow-up", body: "Closing the loop.", status: "SENT", mailboxId: pick(mockMailboxes).email, sentAt: tFU3 }
      );
    } else if (status === "replied") {
      currentStep = -1; // Sequence completed
      const tFirst = addDays(BASE_DATE, -4);
      const tReply = addDays(tFirst, 1);
      lastContactedAt = tFirst;
      nextActionAt = null;

      const replyCategories = ["INTERESTED", "NOT_INTERESTED", "OUT_OF_OFFICE"];
      const classification = pick(replyCategories);

      emailLogsData.push({
        contactId,
        step: 0,
        subject: `Quick question`,
        body: `Initial pitch`,
        status: "SENT",
        mailboxId: pick(mockMailboxes).email,
        sentAt: tFirst
      });

      replyLogsData.push({
        contactId,
        classification,
        body: classification === "INTERESTED"
          ? "Sounds very interesting! Can you send a calendar invite for Thursday 2pm?"
          : classification === "NOT_INTERESTED"
          ? "Thanks for reaching out, but we already have a vendor for this."
          : "I am currently out of office returning next Monday.",
        receivedAt: tReply
      });
    } else if (status === "bounced") {
      currentStep = -1;
      const sentAt = addDays(BASE_DATE, -2);
      lastContactedAt = sentAt;
      nextActionAt = null;

      emailLogsData.push({
        contactId,
        step: 0,
        subject: `Quick question`,
        body: `Initial pitch`,
        status: "BOUNCED",
        mailboxId: pick(mockMailboxes).email,
        sentAt
      });

      // Bounces are suppressed immediately
      suppressionData.push({
        email,
        reason: "BOUNCE",
        createdAt: sentAt
      });
    } else if (status === "unsubscribed") {
      currentStep = -1;
      const sentAt = addDays(BASE_DATE, -3);
      const unsubAt = addDays(sentAt, 1);
      lastContactedAt = sentAt;
      nextActionAt = null;

      emailLogsData.push({
        contactId,
        step: 0,
        subject: `Quick question`,
        body: `Initial pitch`,
        status: "SENT",
        mailboxId: pick(mockMailboxes).email,
        sentAt
      });

      replyLogsData.push({
        contactId,
        classification: "UNSUBSCRIBE",
        body: "Please unsubscribe me from your mailing list immediately.",
        receivedAt: unsubAt
      });

      suppressionData.push({
        email,
        reason: "UNSUBSCRIBE",
        createdAt: unsubAt
      });
    } else if (status === "deactivated") {
      currentStep = -1;
      const tFirst = addDays(BASE_DATE, -30);
      const tFU1 = addDays(tFirst, 3);
      const tFU2 = addDays(tFU1, 5);
      const tFU3 = addDays(tFU2, 7);
      lastContactedAt = tFU3;
      nextActionAt = null;

      emailLogsData.push(
        { contactId, step: 0, subject: "Initial", body: "1st", status: "SENT", mailboxId: pick(mockMailboxes).email, sentAt: tFirst },
        { contactId, step: 1, subject: "FU1", body: "2nd", status: "SENT", mailboxId: pick(mockMailboxes).email, sentAt: tFU1 },
        { contactId, step: 2, subject: "FU2", body: "3rd", status: "SENT", mailboxId: pick(mockMailboxes).email, sentAt: tFU2 },
        { contactId, step: 3, subject: "Final", body: "4th", status: "SENT", mailboxId: pick(mockMailboxes).email, sentAt: tFU3 }
      );
    }

    contactsData.push({
      id: contactId,
      email,
      name: `${firstName} ${lastName}`,
      company: companyObj.name,
      role,
      timezone,
      status,
      currentStep,
      nextActionAt,
      lastContactedAt,
      createdAt: BASE_DATE,
      updatedAt: BASE_DATE
    });
  }

  // 5. Batch Insert in high-speed chunks (batches of 2,000 to maximize throughput)
  console.log("⚡ Executing high-speed batch database inserts...");
  const BATCH_SIZE = 2000;

  for (let i = 0; i < contactsData.length; i += BATCH_SIZE) {
    const chunk = contactsData.slice(i, i + BATCH_SIZE);
    await prisma.contact.createMany({ data: chunk });
  }

  for (let i = 0; i < emailLogsData.length; i += BATCH_SIZE) {
    const chunk = emailLogsData.slice(i, i + BATCH_SIZE);
    await prisma.emailLog.createMany({ data: chunk });
  }

  for (let i = 0; i < replyLogsData.length; i += BATCH_SIZE) {
    const chunk = replyLogsData.slice(i, i + BATCH_SIZE);
    await prisma.replyLog.createMany({ data: chunk });
  }

  for (let i = 0; i < suppressionData.length; i += BATCH_SIZE) {
    const chunk = suppressionData.slice(i, i + BATCH_SIZE);
    await prisma.suppression.createMany({ data: chunk });
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n✅ Seeding complete in ${durationSec} seconds!`);
  console.log(`   Contacts inserted:    ${contactsData.length.toLocaleString()}`);
  console.log(`   Email Logs inserted:   ${emailLogsData.length.toLocaleString()}`);
  console.log(`   Reply Logs inserted:   ${replyLogsData.length.toLocaleString()}`);
  console.log(`   Suppressions recorded: ${suppressionData.length.toLocaleString()}`);
  console.log(`============================================================\n`);
}

// Direct script execution handler
if (process.argv[1]?.endsWith("seed.ts") || process.argv[1]?.endsWith("seed.js")) {
  seedDatabase(10000)
    .then(async () => {
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (error) => {
      console.error("❌ Seeding failed:", error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
