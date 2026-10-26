/**
 * =============================================================================
 * Mock Reply Simulator Service
 * =============================================================================
 * 
 * Purpose:
 * Simulates inbound prospect replies across the campaign.
 * Evaluators can use this to simulate prospects responding to outreach,
 * triggering the sequence halt and intent classification lifecycle rules.
 * 
 * Reply Categories (per specification):
 * - INTERESTED: Prospect wants a meeting/demo. Sequence stops.
 * - NOT_INTERESTED: Prospect declines offer. Sequence stops.
 * - OUT_OF_OFFICE: Prospect is away. Sequence stops or holds.
 * - UNSUBSCRIBE: Prospect requests removal. Sequence stops & email is permanently suppressed.
 * =============================================================================
 */

import { prisma } from "../lib/prisma.js";
import { ClockService } from "./clock.service.js";

export type ReplyCategory = "INTERESTED" | "NOT_INTERESTED" | "OUT_OF_OFFICE" | "UNSUBSCRIBE";

export interface SimulateReplyParams {
  contactId: string;
  classification?: ReplyCategory;
  customBody?: string;
}

export class ReplySimulatorService {
  /** Realistic simulated email replies grouped by intent category */
  private static readonly SAMPLE_REPLIES: Record<ReplyCategory, string[]> = {
    INTERESTED: [
      "Hi, thanks for reaching out. We are actually exploring tools in this space. Do you have 15 minutes this Thursday for a quick demo?",
      "Interesting timing. Can you send over a deck and pricing details? Let's connect next week.",
      "Looks compelling. Adding our VP of Ops to the loop so we can evaluate this together."
    ],
    NOT_INTERESTED: [
      "Thanks for the note, but we already have an established workflow and are not looking to switch.",
      "Not a priority for our team this quarter. Please check back next year.",
      "No thank you, please don't reach out further."
    ],
    OUT_OF_OFFICE: [
      "Thank you for your message. I am currently out of the office on annual leave with limited access to email. I will respond upon my return.",
      "Automatic reply: I will be away at an industry conference until next Tuesday. For urgent issues contact ops@example.com."
    ],
    UNSUBSCRIBE: [
      "Please remove me from your mailing list and unsubscribe this address.",
      "Unsubscribe please. Do not email me again.",
      "Stop contacting me. Take my email off your outreach list."
    ]
  };

  /** Helper to randomly pick an element from an array */
  private static pick<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)]!;
  }

  /**
   * Simulates a single reply from a specific contact.
   * Handles sequence termination, reply logging, and suppression (for unsubscribes).
   */
  public static async simulateReply(params: SimulateReplyParams) {
    const { contactId } = params;
    const simulatedNow = await ClockService.now();

    const contact = await prisma.contact.findUnique({
      where: { id: contactId }
    });

    if (!contact) {
      throw new Error(`Contact ${contactId} not found`);
    }

    // Determine category and reply body
    const categories: ReplyCategory[] = ["INTERESTED", "NOT_INTERESTED", "OUT_OF_OFFICE", "UNSUBSCRIBE"];
    const classification = params.classification ?? this.pick(categories);
    const body = params.customBody ?? this.pick(this.SAMPLE_REPLIES[classification]);

    return await prisma.$transaction(async (tx) => {
      // 1. Log the inbound reply
      const replyLog = await tx.replyLog.create({
        data: {
          contactId,
          classification,
          body,
          receivedAt: simulatedNow
        }
      });

      // 2. Apply lifecycle rules based on intent
      if (classification === "UNSUBSCRIBE") {
        // Unsubscribe: update status and add to permanent suppression
        await tx.contact.update({
          where: { id: contactId },
          data: {
            status: "unsubscribed",
            currentStep: -1,
            nextActionAt: null
          }
        });

        await tx.suppression.upsert({
          where: { email: contact.email.toLowerCase().trim() },
          update: { reason: "UNSUBSCRIBE" },
          create: {
            email: contact.email.toLowerCase().trim(),
            reason: "UNSUBSCRIBE",
            createdAt: simulatedNow
          }
        });
      } else {
        // Any other reply terminates outreach sequence immediately
        await tx.contact.update({
          where: { id: contactId },
          data: {
            status: "replied",
            currentStep: -1,
            nextActionAt: null
          }
        });
      }

      return {
        replyLogId: replyLog.id,
        contactId,
        email: contact.email,
        classification,
        body,
        newStatus: classification === "UNSUBSCRIBE" ? "unsubscribed" : "replied"
      };
    });
  }

  /**
   * Batch simulates replies arriving for a subset of pending contacts.
   * Useful when advancing the virtual clock to simulate incoming responses.
   * 
   * @param count Number of random pending contacts to simulate replies for (default: 50)
   */
  public static async simulateBatchReplies(count = 50) {
    // Find contacts who have been emailed and are currently waiting for a reply
    const pendingContacts = await prisma.contact.findMany({
      where: {
        status: { in: ["first_sent", "follow_up_1_sent", "follow_up_2_sent", "follow_up_3_sent"] }
      },
      take: count
    });

    if (pendingContacts.length === 0) {
      return { simulated: 0, results: [] };
    }

    const results = [];
    for (const c of pendingContacts) {
      const res = await this.simulateReply({ contactId: c.id });
      results.push(res);
    }

    return {
      simulated: results.length,
      results
    };
  }
}
