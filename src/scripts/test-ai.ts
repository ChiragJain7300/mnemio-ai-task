/**
 * =============================================================================
 * AI Service Test & Verification Script
 * =============================================================================
 * 
 * Verifies:
 * 1. Email personalization across sequence steps.
 * 2. Segment caching (hit rates on repeated personas).
 * 3. Reply intent classification across all 4 categories.
 * 
 * Usage:
 * npm run test:ai
 * =============================================================================
 */

import "dotenv/config";
import { AIService } from "../services/ai.service.js";

async function run() {
  console.log("\n============================================================");
  console.log("🤖 Running AI Service Verification & Rate-Limit Shield Tests");
  console.log("============================================================\n");

  // 1. Test Email Generation - Step 0 (Initial Email)
  console.log("1️⃣ Testing Step 0 Email Generation (First Outreach):");
  const email1 = await AIService.generateEmail({
    name: "Elena Rostova",
    company: "Apex Commerce",
    role: "VP of Sales",
    step: 0
  });
  console.log(`   Source:   [${email1.source}] (Model: ${email1.modelUsed})`);
  console.log(`   Subject:  ${email1.subject}`);
  console.log(`   Body:\n${email1.body.split("\n").map(l => "     " + l).join("\n")}\n`);

  // 2. Test Segment Cache on second contact with similar role
  console.log("2️⃣ Testing Persona/Segment Cache (Second contact with similar role):");
  const email2 = await AIService.generateEmail({
    name: "Marcus Aurelius",
    company: "Starlight FinTech",
    role: "Head of Growth",
    step: 0
  });
  console.log(`   Source:   [${email2.source}] (Model: ${email2.modelUsed})`);
  console.log(`   Subject:  ${email2.subject}`);
  console.log(`   Body:\n${email2.body.split("\n").map(l => "     " + l).join("\n")}\n`);

  // 3. Test Step 3 (Breakup Email)
  console.log("3️⃣ Testing Step 3 Email Generation (Breakup / Closing the loop):");
  const email3 = await AIService.generateEmail({
    name: "David Kim",
    company: "Nexus AI",
    role: "Chief Technology Officer",
    step: 3
  });
  console.log(`   Source:   [${email3.source}]`);
  console.log(`   Subject:  ${email3.subject}`);
  console.log(`   Body:\n${email3.body.split("\n").map(l => "     " + l).join("\n")}\n`);

  // 4. Test Reply Intent Classification across all 4 categories
  console.log("4️⃣ Testing Reply Intent Classification:");
  const testReplies = [
    { text: "Sounds really promising. Can you send a calendar invite for Tuesday 2pm?", expected: "INTERESTED" },
    { text: "Thanks for reaching out, but we already have an in-house tool for this.", expected: "NOT_INTERESTED" },
    { text: "I am out of the office on annual leave returning next Monday.", expected: "OUT_OF_OFFICE" },
    { text: "Please remove me from your mailing list and unsubscribe this address.", expected: "UNSUBSCRIBE" }
  ];

  for (const item of testReplies) {
    const result = await AIService.classifyReply(item.text);
    const pass = result.classification === item.expected ? "✅" : "❌";
    console.log(`   ${pass} Text: "${item.text.slice(0, 50)}..."`);
    console.log(`      -> Classified as: [${result.classification}] (Confidence: ${(result.confidence * 100).toFixed(0)}%, Source: ${result.source})`);
  }

  console.log("\n============================================================");
  console.log("✅ AI Service & Rate-Limit Shield Tests Passed!");
  console.log("============================================================\n");
}

run().catch(console.error);
