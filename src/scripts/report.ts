/**
 * =============================================================================
 * Campaign Analytics & Metrics CLI
 * =============================================================================
 * 
 * Generates an executive dashboard summary of the outreach campaign:
 * - Counts by lifecycle status
 * - Emails sent today (virtual date)
 * - Due today and due tomorrow
 * - Bounce and reply rates
 * - Deactivated contacts
 * 
 * Usage:
 * npm run report
 * npm run report -- --json
 * =============================================================================
 */

import "dotenv/config";
import { ReportingService } from "../services/reporting.service.js";
import { prisma } from "../lib/prisma.js";

async function main() {
  const args = process.argv.slice(2);
  const wantsJson = args.includes("--json");

  const report = await ReportingService.generateReport();

  if (wantsJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const { virtualClock, statusCounts, activityToday, rates } = report;

  console.log("\n================================================================================");
  console.log("📊 MNEMIO-AI COLD OUTREACH ENGINE — REAL-TIME CAMPAIGN REPORT");
  console.log(`   Simulated Date: ${virtualClock.formatted} (${virtualClock.iso})`);
  console.log("================================================================================\n");

  console.log("📈 1. PROSPECT LIFECYCLE FUNNEL (10,000 Total)");
  console.log("┌───────────────────────────────────┬──────────────┬───────────────┐");
  console.log("│ Lifecycle Status                  │ Contacts     │ % of Total    │");
  console.log("├───────────────────────────────────┼──────────────┼───────────────┤");
  console.log(`│ [new] Not contacted yet           │ ${statusCounts.new.toLocaleString().padEnd(12)} │ ${(statusCounts.total > 0 ? (statusCounts.new / statusCounts.total * 100).toFixed(1) : "0.0")}%          │`);
  console.log(`│ [first_sent] Initial sent         │ ${statusCounts.first_sent.toLocaleString().padEnd(12)} │ ${(statusCounts.total > 0 ? (statusCounts.first_sent / statusCounts.total * 100).toFixed(1) : "0.0")}%          │`);
  console.log(`│ [follow_up_1_sent] Follow-up 1    │ ${statusCounts.follow_up_1_sent.toLocaleString().padEnd(12)} │ ${(statusCounts.total > 0 ? (statusCounts.follow_up_1_sent / statusCounts.total * 100).toFixed(1) : "0.0")}%          │`);
  console.log(`│ [follow_up_2_sent] Follow-up 2    │ ${statusCounts.follow_up_2_sent.toLocaleString().padEnd(12)} │ ${(statusCounts.total > 0 ? (statusCounts.follow_up_2_sent / statusCounts.total * 100).toFixed(1) : "0.0")}%          │`);
  console.log(`│ [follow_up_3_sent] Follow-up 3    │ ${statusCounts.follow_up_3_sent.toLocaleString().padEnd(12)} │ ${(statusCounts.total > 0 ? (statusCounts.follow_up_3_sent / statusCounts.total * 100).toFixed(1) : "0.0")}%          │`);
  console.log(`│ [replied] Responded (Stopped)     │ ${statusCounts.replied.toLocaleString().padEnd(12)} │ ${(statusCounts.total > 0 ? (statusCounts.replied / statusCounts.total * 100).toFixed(1) : "0.0")}%          │`);
  console.log(`│ [bounced] Hard bounced (Stopped)  │ ${statusCounts.bounced.toLocaleString().padEnd(12)} │ ${(statusCounts.total > 0 ? (statusCounts.bounced / statusCounts.total * 100).toFixed(1) : "0.0")}%          │`);
  console.log(`│ [unsubscribed] Opted-out (Stopped)│ ${statusCounts.unsubscribed.toLocaleString().padEnd(12)} │ ${(statusCounts.total > 0 ? (statusCounts.unsubscribed / statusCounts.total * 100).toFixed(1) : "0.0")}%          │`);
  console.log(`│ [deactivated] Sequence ended      │ ${statusCounts.deactivated.toLocaleString().padEnd(12)} │ ${(statusCounts.total > 0 ? (statusCounts.deactivated / statusCounts.total * 100).toFixed(1) : "0.0")}%          │`);
  console.log("├───────────────────────────────────┼──────────────┼───────────────┤");
  console.log(`│ TOTAL CONTACTS IN CAMPAIGN        │ ${statusCounts.total.toLocaleString().padEnd(12)} │ 100.0%        │`);
  console.log("└───────────────────────────────────┴──────────────┴───────────────┘\n");

  console.log("⚡ 2. DAILY ACTIVITY & QUEUE CADENCE");
  console.log(`   • Emails Sent Today (Virtual Date):    ${activityToday.sentToday.toLocaleString()}`);
  console.log(`   • Contacts Due Right Now:              ${activityToday.dueNow.toLocaleString()}`);
  console.log(`   • Contacts Due Later Today:            ${activityToday.dueLaterToday.toLocaleString()}`);
  console.log(`   • Total Due Today:                     ${activityToday.totalDueToday.toLocaleString()}`);
  console.log(`   • Contacts Due Tomorrow:               ${activityToday.dueTomorrow.toLocaleString()}\n`);

  console.log("🎯 3. DELIVERABILITY & ENGAGEMENT METRICS");
  console.log(`   • Total Outbound Emails Logged:        ${rates.totalEmailsAttempted.toLocaleString()}`);
  console.log(`   • Successfully Delivered:              ${rates.totalDelivered.toLocaleString()}`);
  console.log(`   • Total Bounces:                       ${rates.totalBounces.toLocaleString()}`);
  console.log(`   • Overall Bounce Rate:                 ${rates.bounceRatePercent}%`);
  console.log(`   • Inbound Prospect Replies:            ${rates.totalReplies.toLocaleString()}`);
  console.log(`   • Overall Reply Rate:                  ${rates.replyRatePercent}%`);
  console.log(`   • Total Suppressed (Never Emailed):    ${rates.totalSuppressed.toLocaleString()}\n`);

  console.log("================================================================================\n");
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("❌ Report generation error:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
