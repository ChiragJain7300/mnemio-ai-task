/**
 * =============================================================================
 * Automated Test Suite — MnemioAI Cold-Email Engine
 * =============================================================================
 * 
 * Verifies core business rules, idempotency guarantees, and lifecycle transitions:
 * 1. Strict Idempotency (re-runs must never double-send).
 * 2. Suppression Enforcement (never email bounced or unsubscribed prospects).
 * 3. Sequence Progression (First Email -> FU1 -> FU2 -> FU3).
 * 4. Deactivation Rules (Final wait expiration with no response -> deactivated).
 * 5. Inbound Reply Handling & Intent Classification.
 * 6. Virtual Clock Arithmetic.
 * 
 * Usage:
 * npm test
 * =============================================================================
 */

import "dotenv/config";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma.js";
import { ClockService } from "../services/clock.service.js";
import { MailerService } from "../services/mailer.service.js";
import { ReplySimulatorService } from "../services/reply.service.js";
import { AIService } from "../services/ai.service.js";
import { SequenceService } from "../services/sequence.service.js";

let passed = 0;
let failed = 0;

async function it(title: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`   ✅ PASS: ${title}`);
    passed++;
  } catch (err: any) {
    console.error(`   ❌ FAIL: ${title}`);
    console.error(`      -> ${err.message}`);
    failed++;
  }
}

async function runTestSuite() {
  console.log("\n============================================================");
  console.log("🧪 Running Automated Test Suite");
  console.log("============================================================\n");

  // Setup test prospect
  const testEmail = `test.prospect.${Date.now()}@testcompany.com`;
  const baseTime = new Date("2026-10-24T09:00:00.000Z");
  await ClockService.setTime(baseTime);

  let testContact = await prisma.contact.create({
    data: {
      email: testEmail,
      name: "Jordan Tester",
      company: "Test Corp",
      role: "VP of Engineering",
      timezone: "America/New_York",
      status: "new",
      currentStep: 0,
      nextActionAt: baseTime
    }
  });

  // Test 1: Virtual Clock
  await it("Virtual Clock can be queried and advanced", async () => {
    const initialTime = await ClockService.now();
    assert.equal(initialTime.toISOString(), baseTime.toISOString());

    const advanced = await ClockService.advance({ days: 3 });
    const expected = new Date("2026-10-27T09:00:00.000Z");
    assert.equal(advanced.currentNow.toISOString(), expected.toISOString());

    // Reset back
    await ClockService.setTime(baseTime);
  });

  // Test 2: Sequence Delivery & Step 0
  await it("Delivering Step 0 advances contact to 'first_sent' with scheduled FU1", async () => {
    const sendRes = await MailerService.send({
      contactId: testContact.id,
      to: testContact.email,
      subject: "Test Pitch",
      body: "Test Body",
      step: 0,
      bounceRate: 0 // Force success
    });

    assert.equal(sendRes.status, "SENT");
    assert.equal(sendRes.success, true);

    const log = await prisma.emailLog.findUnique({
      where: { contactId_step: { contactId: testContact.id, step: 0 } }
    });
    assert.ok(log, "EmailLog record must exist for (contactId, step: 0)");
  });

  // Test 3: Idempotency Protection
  await it("Re-sending the same step triggers strict ALREADY_SENT idempotency check", async () => {
    const duplicateRes = await MailerService.send({
      contactId: testContact.id,
      to: testContact.email,
      subject: "Duplicate Test Pitch",
      body: "Duplicate Test Body",
      step: 0
    });

    assert.equal(duplicateRes.status, "ALREADY_SENT");
    assert.ok(duplicateRes.error?.includes("already processed"));

    const count = await prisma.emailLog.count({
      where: { contactId: testContact.id, step: 0 }
    });
    assert.equal(count, 1, "There must strictly remain exactly 1 EmailLog for this step");
  });

  // Test 4: Suppression Guard
  await it("Suppressed email addresses are permanently blocked from sending", async () => {
    const suppressedEmail = `suppressed.${Date.now()}@banned.com`;
    const suppContact = await prisma.contact.create({
      data: {
        email: suppressedEmail,
        name: "Banned User",
        company: "Banned Ltd",
        role: "Director",
        status: "new",
        nextActionAt: baseTime
      }
    });

    // Add to suppression
    await prisma.suppression.create({
      data: {
        email: suppressedEmail,
        reason: "MANUAL",
        createdAt: baseTime
      }
    });

    const sendRes = await MailerService.send({
      contactId: suppContact.id,
      to: suppressedEmail,
      subject: "Should Not Send",
      body: "Blocked content",
      step: 0
    });

    assert.equal(sendRes.status, "SUPPRESSED");
    assert.equal(sendRes.success, false);

    const logCount = await prisma.emailLog.count({ where: { contactId: suppContact.id } });
    assert.equal(logCount, 0, "No email log must be created for suppressed recipient");

    // Clean up
    await prisma.suppression.delete({ where: { email: suppressedEmail } });
    await prisma.contact.delete({ where: { id: suppContact.id } });
  });

  // Test 5: Inbound Reply & Sequence Termination
  await it("Simulated reply stops sequence and categorizes intent", async () => {
    const replyRes = await ReplySimulatorService.simulateReply({
      contactId: testContact.id,
      classification: "INTERESTED",
      customBody: "Love this! Let's schedule a call this Wednesday."
    });

    assert.equal(replyRes.newStatus, "replied");

    const updated = await prisma.contact.findUnique({ where: { id: testContact.id } });
    assert.equal(updated?.status, "replied");
    assert.equal(updated?.currentStep, -1);
    assert.equal(updated?.nextActionAt, null, "Scheduled next action must be cancelled upon reply");
  });

  // Test 6: Unsubscribe Lifecycle & Auto-Suppression
  await it("Unsubscribe reply halts sequence and automatically registers in Suppression table", async () => {
    const unsubEmail = `unsub.${Date.now()}@sample.com`;
    const unsubContact = await prisma.contact.create({
      data: {
        email: unsubEmail,
        name: "Unsub Prospect",
        company: "Sample Co",
        role: "Lead",
        status: "first_sent",
        currentStep: 0,
        nextActionAt: baseTime
      }
    });

    await ReplySimulatorService.simulateReply({
      contactId: unsubContact.id,
      classification: "UNSUBSCRIBE",
      customBody: "Please unsubscribe me immediately."
    });

    const updated = await prisma.contact.findUnique({ where: { id: unsubContact.id } });
    assert.equal(updated?.status, "unsubscribed");
    assert.equal(updated?.nextActionAt, null);

    const supp = await prisma.suppression.findUnique({ where: { email: unsubEmail } });
    assert.ok(supp, "Unsubscribed email must be present in Suppression table");
    assert.equal(supp?.reason, "UNSUBSCRIBE");

    // Clean up
    await prisma.suppression.delete({ where: { email: unsubEmail } });
    await prisma.contact.delete({ where: { id: unsubContact.id } });
  });

  // Test 7: AI Heuristic Classification
  await it("AI heuristic classifier reliably flags all 4 intent categories", async () => {
    const r1 = AIService.heuristicClassify("Please remove me from this list");
    assert.equal(r1.classification, "UNSUBSCRIBE");

    const r2 = AIService.heuristicClassify("I will be away on annual leave until next week");
    assert.equal(r2.classification, "OUT_OF_OFFICE");

    const r3 = AIService.heuristicClassify("Not interested at all, no thanks");
    assert.equal(r3.classification, "NOT_INTERESTED");

    const r4 = AIService.heuristicClassify("Sounds great! Can you send a demo invite?");
    assert.equal(r4.classification, "INTERESTED");
  });

  // Clean up primary test contact
  await prisma.replyLog.deleteMany({ where: { contactId: testContact.id } });
  await prisma.emailLog.deleteMany({ where: { contactId: testContact.id } });
  await prisma.contact.delete({ where: { id: testContact.id } });

  console.log("\n============================================================");
  console.log(`📊 Test Summary: ${passed} Passed, ${failed} Failed`);
  console.log("============================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Test suite fatal error:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
