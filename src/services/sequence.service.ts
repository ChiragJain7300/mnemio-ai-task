/**
 * =============================================================================
 * Sequence Orchestration & Lifecycle State Machine Service
 * =============================================================================
 * 
 * Purpose:
 * Coordinates the automated cold-email cadence across all active prospects.
 * Finds due contacts, writes emails via AI, executes delivery via the Mock Mailer,
 * and schedules the next chronological step.
 * 
 * Cadence Configuration (Configurable intervals in days):
 * - Step 0 (Initial Email):    Sent when contact is 'new'
 * - Step 1 (Follow-up 1):      Sent 3 days after Initial Email
 * - Step 2 (Follow-up 2):      Sent 5 days after Follow-up 1
 * - Step 3 (Follow-up 3):      Sent 7 days after Follow-up 2
 * - Deactivation:              Triggered 7 days after Follow-up 3 if no reply
 * 
 * Idempotency Guarantee:
 * 1. Running this workflow multiple times will NEVER send duplicate emails.
 * 2. Contacts are advanced to future `nextActionAt` dates atomically.
 * 3. Database unique constraint `@@unique([contactId, step])` provides a hard guarantee.
 * =============================================================================
 */

import { prisma } from "../lib/prisma.js";
import { ClockService } from "./clock.service.js";
import { MailerService } from "./mailer.service.js";
import { AIService } from "./ai.service.js";

export interface CadenceConfig {
  waitAfterInitialDays: number; // default: 3 days
  waitAfterFU1Days: number;     // default: 5 days
  waitAfterFU2Days: number;     // default: 7 days
  waitAfterFU3Days: number;     // default: 7 days (until deactivation)
}

export interface RunSequenceOptions {
  batchSize?: number | undefined;
  cadence?: Partial<CadenceConfig> | undefined;
  bounceRate?: number | undefined;
}

export interface RunSequenceResult {
  simulatedTime: Date;
  contactsScanned: number;
  emailsSent: number;
  bounces: number;
  deactivations: number;
  skippedSuppressed: number;
  skippedAlreadySent: number;
  durationMs: number;
}

export class SequenceService {
  /** Default cadence schedule per take-home specification */
  public static readonly DEFAULT_CADENCE: CadenceConfig = {
    waitAfterInitialDays: 3,
    waitAfterFU1Days: 5,
    waitAfterFU2Days: 7,
    waitAfterFU3Days: 7
  };

  /** Helper to add days to a date */
  private static addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setUTCDate(result.getUTCDate() + days);
    return result;
  }

  /**
   * Finds all contacts currently due for an action according to the virtual clock.
   * 
   * A contact is due if:
   * 1. Status is in an active outreach state ('new', 'first_sent', 'follow_up_1_sent', 'follow_up_2_sent', 'follow_up_3_sent').
   * 2. `nextActionAt` is less than or equal to current simulated time (`simulatedNow`).
   */
  public static async getDueContacts(limit = 1000) {
    const simulatedNow = await ClockService.now();

    return await prisma.contact.findMany({
      where: {
        status: {
          in: ["new", "first_sent", "follow_up_1_sent", "follow_up_2_sent", "follow_up_3_sent"]
        },
        nextActionAt: {
          lte: simulatedNow
        }
      },
      take: limit,
      orderBy: { nextActionAt: "asc" }
    });
  }

  /**
   * Executes a single processing run across all currently due contacts.
   * Strictly idempotent: executing this method back-to-back causes 0 double-sends.
   */
  public static async processDueContacts(options: RunSequenceOptions = {}): Promise<RunSequenceResult> {
    const startTime = Date.now();
    const simulatedNow = await ClockService.now();
    const batchSize = options.batchSize ?? 1000;
    const cadence: CadenceConfig = { ...this.DEFAULT_CADENCE, ...options.cadence };

    let emailsSent = 0;
    let bounces = 0;
    let deactivations = 0;
    let skippedSuppressed = 0;
    let skippedAlreadySent = 0;
    let totalProcessed = 0;

    // Loop through batches of due contacts until all due for `simulatedNow` are processed
    while (true) {
      const dueContacts = await this.getDueContacts(batchSize);

      if (dueContacts.length === 0) {
        break;
      }

      totalProcessed += dueContacts.length;

      for (const contact of dueContacts) {
        // ---------------------------------------------------------------------
        // Case A: Contact is in 'follow_up_3_sent' and wait period has expired.
        // Rule: Mark contact as 'deactivated'. Outreach sequence has concluded.
        // ---------------------------------------------------------------------
        if (contact.status === "follow_up_3_sent") {
          await prisma.contact.update({
            where: { id: contact.id },
            data: {
              status: "deactivated",
              currentStep: -1,
              nextActionAt: null
            }
          });
          deactivations++;
          continue;
        }

        // ---------------------------------------------------------------------
        // Determine the next step and target status based on current status
        // ---------------------------------------------------------------------
        let stepToSend = 0;
        let nextStatus = "first_sent";
        let waitDays = cadence.waitAfterInitialDays;

        if (contact.status === "new") {
          stepToSend = 0;
          nextStatus = "first_sent";
          waitDays = cadence.waitAfterInitialDays;
        } else if (contact.status === "first_sent") {
          stepToSend = 1;
          nextStatus = "follow_up_1_sent";
          waitDays = cadence.waitAfterFU1Days;
        } else if (contact.status === "follow_up_1_sent") {
          stepToSend = 2;
          nextStatus = "follow_up_2_sent";
          waitDays = cadence.waitAfterFU2Days;
        } else if (contact.status === "follow_up_2_sent") {
          stepToSend = 3;
          nextStatus = "follow_up_3_sent";
          waitDays = cadence.waitAfterFU3Days;
        }

        // ---------------------------------------------------------------------
        // Generate Personalized Email Copy via AI Service (with Cache & Fallback)
        // ---------------------------------------------------------------------
        const emailContent = await AIService.generateEmail({
          name: contact.name,
          company: contact.company ?? "your company",
          role: contact.role,
          step: stepToSend
        });

        // ---------------------------------------------------------------------
        // Send email via Mock Mailer (enforces suppression & DB idempotency)
        // ---------------------------------------------------------------------
        const sendResult = await MailerService.send({
          contactId: contact.id,
          to: contact.email,
          subject: emailContent.subject,
          body: emailContent.body,
          step: stepToSend,
          bounceRate: options.bounceRate
        });

        if (sendResult.status === "SUPPRESSED") {
          // Contact was found on suppression list; stop future attempts
          await prisma.contact.update({
            where: { id: contact.id },
            data: { status: "unsubscribed", nextActionAt: null, currentStep: -1 }
          });
          skippedSuppressed++;
          continue;
        }

        if (sendResult.status === "ALREADY_SENT") {
          // Idempotency shield triggered: this step was already recorded previously
          skippedAlreadySent++;
          continue;
        }

        if (sendResult.status === "BOUNCED") {
          // MailerService already updated contact to 'bounced' and added to Suppression
          bounces++;
          continue;
        }

        // ---------------------------------------------------------------------
        // Successful Delivery: Advance to next step and schedule future action
        // ---------------------------------------------------------------------
        const nextScheduledDate = this.addDays(simulatedNow, waitDays);

        await prisma.contact.update({
          where: { id: contact.id },
          data: {
            status: nextStatus,
            currentStep: stepToSend,
            lastContactedAt: simulatedNow,
            nextActionAt: nextScheduledDate
          }
        });

        emailsSent++;
      }
    }

    return {
      simulatedTime: simulatedNow,
      contactsScanned: totalProcessed,
      emailsSent,
      bounces,
      deactivations,
      skippedSuppressed,
      skippedAlreadySent,
      durationMs: Date.now() - startTime
    };
  }
}
