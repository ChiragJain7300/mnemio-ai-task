/**
 * =============================================================================
 * Mock Mailer Service
 * =============================================================================
 * 
 * Purpose:
 * Simulates a production email delivery provider (like SendGrid, Resend, or SES)
 * without making real outbound network requests.
 * 
 * Key Responsibilities:
 * 1. Strictly enforces the global Suppression list (never emails bounced/unsubscribed prospects).
 * 2. Simulates email delivery and bounces at configurable failure rates (default: 5% bounce rate).
 * 3. Enforces strict idempotency: guarantees a contact never receives the same step twice.
 * 4. Integrates with Mailbox quotas to support warm-up schedules and auto-pause on high bounces.
 * =============================================================================
 */

import { prisma } from "../lib/prisma.js";
import { ClockService } from "./clock.service.js";

export interface SendEmailParams {
  contactId: string;
  to: string;
  subject: string;
  body: string;
  step: number; // 0 = First Email, 1 = FU1, 2 = FU2, 3 = FU3
  mailboxId?: string | undefined;
  bounceRate?: number | undefined; // Override default bounce probability (0.0 to 1.0)
}

export interface SendEmailResult {
  success: boolean;
  status: "SENT" | "BOUNCED" | "SUPPRESSED" | "ALREADY_SENT";
  emailLogId?: string;
  error?: string;
  mailboxUsed?: string;
}

export class MailerService {
  /** Default bounce rate across simulated outreach if not specified (5%) */
  public static readonly DEFAULT_BOUNCE_RATE = 0.05;

  /**
   * Sends a simulated email to a prospect, respecting suppression, idempotency,
   * and virtual clock timestamps.
   */
  public static async send(params: SendEmailParams): Promise<SendEmailResult> {
    const { contactId, to, subject, body, step } = params;
    const bounceRate = params.bounceRate ?? this.DEFAULT_BOUNCE_RATE;
    const simulatedNow = await ClockService.now();

    // -------------------------------------------------------------------------
    // Rule 1: Check Global Suppression List
    // If the contact was previously unsubscribed or bounced, abort immediately.
    // -------------------------------------------------------------------------
    const isSuppressed = await prisma.suppression.findUnique({
      where: { email: to.toLowerCase().trim() }
    });

    if (isSuppressed) {
      return {
        success: false,
        status: "SUPPRESSED",
        error: `Email ${to} is suppressed (Reason: ${isSuppressed.reason})`
      };
    }

    // -------------------------------------------------------------------------
    // Rule 2: Strict Idempotency Check
    // Prevent double-sending: If this step was already logged for this contact, return ALREADY_SENT.
    // -------------------------------------------------------------------------
    const existingLog = await prisma.emailLog.findUnique({
      where: {
        contactId_step: {
          contactId,
          step
        }
      }
    });

    if (existingLog) {
      return {
        success: existingLog.status === "SENT",
        status: "ALREADY_SENT",
        emailLogId: existingLog.id,
        error: `Step ${step} was already processed for contact ${contactId} at ${existingLog.sentAt.toISOString()}`
      };
    }

    // -------------------------------------------------------------------------
    // Rule 3: Mailbox Assignment & Warm-Up Quota Check
    // -------------------------------------------------------------------------
    let mailboxId = params.mailboxId;
    if (!mailboxId) {
      // Pick an active, non-paused mailbox with remaining daily quota
      const availableMailbox = await prisma.mailbox.findFirst({
        where: {
          isPaused: false,
          sentTodayCount: { lt: prisma.mailbox.fields.dailyLimit }
        },
        orderBy: { sentTodayCount: "asc" }
      });
      mailboxId = availableMailbox?.email ?? "default-outreach@mnemio.com";
    }

    // -------------------------------------------------------------------------
    // Rule 4: Simulate Delivery vs. Bounce
    // -------------------------------------------------------------------------
    const isBounce = Math.random() < bounceRate;

    return await prisma.$transaction(async (tx) => {
      if (isBounce) {
        // Log the bounce
        const log = await tx.emailLog.create({
          data: {
            contactId,
            step,
            subject,
            body,
            status: "BOUNCED",
            mailboxId,
            sentAt: simulatedNow
          }
        });

        // Add to permanent suppression list
        await tx.suppression.upsert({
          where: { email: to.toLowerCase().trim() },
          update: { reason: "BOUNCE" },
          create: {
            email: to.toLowerCase().trim(),
            reason: "BOUNCE",
            createdAt: simulatedNow
          }
        });

        // Terminate contact sequence: set status to 'bounced' and clear next action
        await tx.contact.update({
          where: { id: contactId },
          data: {
            status: "bounced",
            currentStep: -1,
            nextActionAt: null,
            lastContactedAt: simulatedNow
          }
        });

        // Update mailbox bounce metrics & auto-pause if bounce rate > 10%
        if (params.mailboxId) {
          const mb = await tx.mailbox.findUnique({ where: { email: params.mailboxId } });
          if (mb) {
            const newTotalBounced = mb.totalBounced + 1;
            const newTotalSent = mb.totalSent + 1;
            const bounceRatio = newTotalBounced / newTotalSent;
            const shouldPause = newTotalSent >= 10 && bounceRatio > 0.10;

            await tx.mailbox.update({
              where: { email: params.mailboxId },
              data: {
                totalBounced: newTotalBounced,
                totalSent: newTotalSent,
                consecutiveBounces: mb.consecutiveBounces + 1,
                isPaused: shouldPause
              }
            });
          }
        }

        return {
          success: false,
          status: "BOUNCED",
          emailLogId: log.id,
          mailboxUsed: mailboxId,
          error: "Simulated mail delivery bounced"
        };
      }

      // Successful send
      const log = await tx.emailLog.create({
        data: {
          contactId,
          step,
          subject,
          body,
          status: "SENT",
          mailboxId,
          sentAt: simulatedNow
        }
      });

      // Update mailbox sent counters
      if (params.mailboxId) {
        await tx.mailbox.update({
          where: { email: params.mailboxId },
          data: {
            sentTodayCount: { increment: 1 },
            totalSent: { increment: 1 },
            consecutiveBounces: 0
          }
        });
      }

      return {
        success: true,
        status: "SENT",
        emailLogId: log.id,
        mailboxUsed: mailboxId
      };
    });
  }
}
