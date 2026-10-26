/**
 * =============================================================================
 * Mock Reply Generator CLI
 * =============================================================================
 * 
 * Simulates incoming replies from active prospects waiting for follow-ups.
 * 
 * Usage:
 * npm run replies:simulate -- --count 25
 * =============================================================================
 */

import "dotenv/config";
import { ReplySimulatorService } from "../services/reply.service.js";
import { prisma } from "../lib/prisma.js";

async function main() {
  const args = process.argv.slice(2);
  let count = 25;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--count" || args[i] === "-c") {
      count = parseInt(args[i + 1] ?? "25", 10);
      i++;
    }
  }

  console.log(`\n📬 Simulating replies for ${count} pending prospects...`);
  const result = await ReplySimulatorService.simulateBatchReplies(count);

  console.log(`✅ Successfully generated ${result.simulated} inbound replies:`);
  for (const item of result.results.slice(0, 5)) {
    console.log(`   - [${item.classification}] ${item.email}`);
    console.log(`     "${item.body.slice(0, 70)}..."`);
  }
  if (result.results.length > 5) {
    console.log(`   ... and ${result.results.length - 5} more.`);
  }
  console.log("");
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("❌ Reply simulation error:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
