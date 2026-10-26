/**
 * =============================================================================
 * Sequence Runner CLI
 * =============================================================================
 * 
 * Executes an automated outreach cycle for all contacts currently due.
 * 
 * Usage:
 * npm run sequence:run
 * npm run sequence:run -- --batch-size 500
 * =============================================================================
 */

import "dotenv/config";
import { SequenceService } from "../services/sequence.service.js";
import { ClockService } from "../services/clock.service.js";
import { prisma } from "../lib/prisma.js";

async function main() {
  const args = process.argv.slice(2);
  let batchSize = 1000;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--batch-size" || args[i] === "-b") {
      batchSize = parseInt(args[i + 1] ?? "1000", 10);
      i++;
    }
  }

  const clockStatus = await ClockService.getStatus();

  console.log("\n============================================================");
  console.log("🚀 Executing Sequence Workflow Run");
  console.log(`   Virtual Clock: ${clockStatus.formatted} (${clockStatus.iso})`);
  console.log(`   Batch Size:    ${batchSize}`);
  console.log("============================================================\n");

  const result = await SequenceService.processDueContacts({ batchSize });

  const durationSec = (result.durationMs / 1000).toFixed(2);
  console.log("📊 Workflow Execution Summary:");
  console.log(`   Contacts Scanned:        ${result.contactsScanned.toLocaleString()}`);
  console.log(`   Emails Sent:             ${result.emailsSent.toLocaleString()}`);
  console.log(`   Bounced:                 ${result.bounces.toLocaleString()}`);
  console.log(`   Deactivated:             ${result.deactivations.toLocaleString()}`);
  console.log(`   Suppressed (Skipped):    ${result.skippedSuppressed.toLocaleString()}`);
  console.log(`   Already Sent (Idempotent): ${result.skippedAlreadySent.toLocaleString()}`);
  console.log(`   Time Taken:              ${durationSec}s`);
  console.log("============================================================\n");
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("❌ Sequence workflow error:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
