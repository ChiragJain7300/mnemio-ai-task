/**
 * =============================================================================
 * Virtual Clock CLI
 * =============================================================================
 * 
 * Command-line utility for viewing and moving the virtual clock forward.
 * 
 * Usage:
 * npm run clock:show
 * npm run clock:advance -- --days 3
 * npm run clock:advance -- --days 5 --hours 4
 * npm run clock:set -- 2026-11-01T09:00:00Z
 * =============================================================================
 */

import "dotenv/config";
import { ClockService } from "../services/clock.service.js";
import { prisma } from "../lib/prisma.js";

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] ?? "show";

  if (command === "show") {
    const status = await ClockService.getStatus();
    console.log(`\n🕒 Current Virtual Clock:`);
    console.log(`   ISO:       ${status.iso}`);
    console.log(`   Formatted: ${status.formatted}`);
    console.log(`   Updated:   ${status.updatedAt.toISOString()}\n`);
    return;
  }

  if (command === "advance") {
    let days = 0;
    let hours = 0;
    let minutes = 0;

    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--days" || arg === "-d") {
        days = parseInt(args[i + 1] ?? "0", 10);
        i++;
      } else if (arg === "--hours" || arg === "-h") {
        hours = parseInt(args[i + 1] ?? "0", 10);
        i++;
      } else if (arg === "--minutes" || arg === "-m") {
        minutes = parseInt(args[i + 1] ?? "0", 10);
        i++;
      }
    }

    if (!days && !hours && !minutes) {
      console.log("⚠️ No duration specified. Defaulting to advancing by 1 day (--days 1).");
      days = 1;
    }

    const result = await ClockService.advance({ days, hours, minutes });
    console.log(`\n⏩ Virtual Clock Advanced (${result.deltaDescription}):`);
    console.log(`   Previous: ${result.previousNow.toISOString()}`);
    console.log(`   Current:  ${result.currentNow.toISOString()}`);
    console.log(`   Formatted: ${result.currentNow.toUTCString()}\n`);
    return;
  }

  if (command === "set") {
    const target = args[1];
    if (!target) {
      console.error("❌ Error: Missing date string. Example: npm run clock:set -- 2026-11-01T09:00:00Z");
      process.exit(1);
    }
    const newTime = await ClockService.setTime(target);
    console.log(`\n🎯 Virtual Clock Set:`);
    console.log(`   Current:   ${newTime.toISOString()}`);
    console.log(`   Formatted: ${newTime.toUTCString()}\n`);
    return;
  }

  console.log(`\nUnknown command: ${command}`);
  console.log(`Available commands:`);
  console.log(`  show                    Display current virtual time`);
  console.log(`  advance --days N        Move virtual clock forward`);
  console.log(`  set <ISO_DATE>          Set virtual clock to explicit date\n`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("❌ Clock CLI error:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
