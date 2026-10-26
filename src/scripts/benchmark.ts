/**
 * =============================================================================
 * Full Campaign Simulation & Scale Benchmark
 * =============================================================================
 * 
 * Runs the entire outreach engine across 10,000 contacts through a multi-week
 * campaign lifecycle in seconds, recording benchmarks for the README:
 * 
 * 1. Seeds 10,000 contacts deterministically.
 * 2. Day 0: Processes initial due outreach.
 * 3. Day 3: Advances clock 3 days, processes Follow-up 1.
 * 4. Day 3: Simulates incoming prospect replies.
 * 5. Day 8: Advances clock 5 days, processes Follow-up 2.
 * 6. Day 15: Advances clock 7 days, processes Follow-up 3.
 * 7. Day 22: Advances clock 7 days, executes final wait deactivations.
 * 8. Prints formatted benchmark table for inclusion in README.md.
 * 
 * Usage:
 * npm run benchmark
 * =============================================================================
 */

import "dotenv/config";
import { prisma } from "../lib/prisma.js";
import { seedDatabase } from "./seed.js";
import { ClockService } from "../services/clock.service.js";
import { SequenceService } from "../services/sequence.service.js";
import { ReplySimulatorService } from "../services/reply.service.js";
import { ReportingService } from "../services/reporting.service.js";

async function runBenchmark() {
  const benchmarkStart = Date.now();

  console.log("\n================================================================================");
  console.log("⚡ RUNNING FULL 10,000-CONTACT END-TO-END CAMPAIGN BENCHMARK");
  console.log("================================================================================\n");

  // Step 1: Seed Database
  const t0 = Date.now();
  await seedDatabase(10000);
  const seedDuration = ((Date.now() - t0) / 1000).toFixed(2);

  const timelineSteps: Array<{
    stage: string;
    virtualDate: string;
    contactsProcessed: number;
    emailsSent: number;
    bounces: number;
    deactivations: number;
    durationSec: string;
  }> = [];

  // Step 2: Day 0 - Initial run
  console.log("▶️ [Cycle 1 - Day 0] Processing Initial Outreach Batch...");
  const t1 = Date.now();
  const res0 = await SequenceService.processDueContacts();
  const d1 = ((Date.now() - t1) / 1000).toFixed(2);
  const clock0 = await ClockService.now();
  timelineSteps.push({
    stage: "Day 0: Initial Outreach",
    virtualDate: clock0.toISOString().slice(0, 10),
    contactsProcessed: res0.contactsScanned,
    emailsSent: res0.emailsSent,
    bounces: res0.bounces,
    deactivations: res0.deactivations,
    durationSec: d1
  });

  // Step 3: Day 3 - Advance 3 days + process Follow-up 1
  console.log("▶️ [Cycle 2 - Day 3] Advancing clock +3 days & processing Follow-up 1...");
  await ClockService.advance({ days: 3 });
  const t2 = Date.now();
  const res1 = await SequenceService.processDueContacts();
  const d2 = ((Date.now() - t2) / 1000).toFixed(2);
  const clock1 = await ClockService.now();
  timelineSteps.push({
    stage: "Day 3: Follow-Up 1",
    virtualDate: clock1.toISOString().slice(0, 10),
    contactsProcessed: res1.contactsScanned,
    emailsSent: res1.emailsSent,
    bounces: res1.bounces,
    deactivations: res1.deactivations,
    durationSec: d2
  });

  // Step 4: Simulate inbound replies
  console.log("▶️ [Simulation] Simulating incoming replies from active prospects...");
  await ReplySimulatorService.simulateBatchReplies(50);

  // Step 5: Day 8 - Advance 5 days + process Follow-up 2
  console.log("▶️ [Cycle 3 - Day 8] Advancing clock +5 days & processing Follow-up 2...");
  await ClockService.advance({ days: 5 });
  const t3 = Date.now();
  const res2 = await SequenceService.processDueContacts();
  const d3 = ((Date.now() - t3) / 1000).toFixed(2);
  const clock2 = await ClockService.now();
  timelineSteps.push({
    stage: "Day 8: Follow-Up 2",
    virtualDate: clock2.toISOString().slice(0, 10),
    contactsProcessed: res2.contactsScanned,
    emailsSent: res2.emailsSent,
    bounces: res2.bounces,
    deactivations: res2.deactivations,
    durationSec: d3
  });

  // Step 6: Day 15 - Advance 7 days + process Follow-up 3 (Breakup)
  console.log("▶️ [Cycle 4 - Day 15] Advancing clock +7 days & processing Follow-up 3...");
  await ClockService.advance({ days: 7 });
  const t4 = Date.now();
  const res3 = await SequenceService.processDueContacts();
  const d4 = ((Date.now() - t4) / 1000).toFixed(2);
  const clock3 = await ClockService.now();
  timelineSteps.push({
    stage: "Day 15: Follow-Up 3",
    virtualDate: clock3.toISOString().slice(0, 10),
    contactsProcessed: res3.contactsScanned,
    emailsSent: res3.emailsSent,
    bounces: res3.bounces,
    deactivations: res3.deactivations,
    durationSec: d4
  });

  // Step 7: Day 22 - Advance 7 days + execute deactivation for non-responders
  console.log("▶️ [Cycle 5 - Day 22] Advancing clock +7 days & deactivating non-responders...");
  await ClockService.advance({ days: 7 });
  const t5 = Date.now();
  const res4 = await SequenceService.processDueContacts();
  const d5 = ((Date.now() - t5) / 1000).toFixed(2);
  const clock4 = await ClockService.now();
  timelineSteps.push({
    stage: "Day 22: Deactivation Cycle",
    virtualDate: clock4.toISOString().slice(0, 10),
    contactsProcessed: res4.contactsScanned,
    emailsSent: res4.emailsSent,
    bounces: res4.bounces,
    deactivations: res4.deactivations,
    durationSec: d5
  });

  const totalBenchmarkDuration = ((Date.now() - benchmarkStart) / 1000).toFixed(2);

  // Step 8: Final Report
  const finalReport = await ReportingService.generateReport();

  console.log("\n================================================================================");
  console.log("🏆 BENCHMARK RESULTS (Ready to copy into README.md)");
  console.log("================================================================================\n");

  console.log(`### Benchmark Summary (Mac / Native PostgreSQL)`);
  console.log(`- **Total Contacts Tested:** 10,000`);
  console.log(`- **Total Simulation Time:** ${totalBenchmarkDuration}s (entire 3-week campaign simulated)`);
  console.log(`- **Seeding Time (10k rows + audit logs):** ${seedDuration}s\n`);

  console.log(`| Stage | Simulated Date | Contacts Scanned | Emails Sent | Bounces | Deactivations | Time Taken |`);
  console.log(`| :--- | :--- | :--- | :--- | :--- | :--- | :--- |`);
  for (const step of timelineSteps) {
    console.log(`| ${step.stage} | ${step.virtualDate} | ${step.contactsProcessed.toLocaleString()} | ${step.emailsSent.toLocaleString()} | ${step.bounces.toLocaleString()} | ${step.deactivations.toLocaleString()} | ${step.durationSec}s |`);
  }

  console.log(`\n### Final Campaign Status Counts (10,000 Total):`);
  console.log(`| Status | Count | Description |`);
  console.log(`| :--- | :--- | :--- |`);
  console.log(`| \`new\` | ${finalReport.statusCounts.new.toLocaleString()} | Prospects awaiting first contact |`);
  console.log(`| \`first_sent\` | ${finalReport.statusCounts.first_sent.toLocaleString()} | Initial outreach delivered |`);
  console.log(`| \`follow_up_1_sent\` | ${finalReport.statusCounts.follow_up_1_sent.toLocaleString()} | Follow-up 1 delivered |`);
  console.log(`| \`follow_up_2_sent\` | ${finalReport.statusCounts.follow_up_2_sent.toLocaleString()} | Follow-up 2 delivered |`);
  console.log(`| \`follow_up_3_sent\` | ${finalReport.statusCounts.follow_up_3_sent.toLocaleString()} | Final follow-up delivered |`);
  console.log(`| \`replied\` | ${finalReport.statusCounts.replied.toLocaleString()} | Responded (Sequence halted) |`);
  console.log(`| \`bounced\` | ${finalReport.statusCounts.bounced.toLocaleString()} | Hard bounced (Suppressed) |`);
  console.log(`| \`unsubscribed\` | ${finalReport.statusCounts.unsubscribed.toLocaleString()} | Opted out (Suppressed) |`);
  console.log(`| \`deactivated\` | ${finalReport.statusCounts.deactivated.toLocaleString()} | Concluded with no response |`);
  console.log(`| **TOTAL** | **${finalReport.statusCounts.total.toLocaleString()}** | |`);

  console.log(`\n### Deliverability & Conversions:`);
  console.log(`- **Total Outbound Emails Logged:** ${finalReport.rates.totalEmailsAttempted.toLocaleString()}`);
  console.log(`- **Successfully Delivered:** ${finalReport.rates.totalDelivered.toLocaleString()}`);
  console.log(`- **Bounces:** ${finalReport.rates.totalBounces.toLocaleString()} (${finalReport.rates.bounceRatePercent}%)`);
  console.log(`- **Replies:** ${finalReport.rates.totalReplies.toLocaleString()} (${finalReport.rates.replyRatePercent}%)`);
  console.log(`- **Suppression List Size:** ${finalReport.rates.totalSuppressed.toLocaleString()}`);

  console.log("\n================================================================================\n");
}

runBenchmark()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("❌ Benchmark error:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
