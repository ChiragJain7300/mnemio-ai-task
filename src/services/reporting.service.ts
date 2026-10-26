/**
 * =============================================================================
 * Reporting & Metrics Analytics Service
 * =============================================================================
 * 
 * Purpose:
 * Provides comprehensive, real-time analytics across the 10,000-contact campaign.
 * Evaluates counts by status, emails sent today, due today & tomorrow,
 * conversion/reply rates, bounce rates, and deactivations.
 * 
 * Virtual Clock Awareness:
 * All daily calculations (sent today, due today, due tomorrow) are computed
 * relative to the system's `VirtualClock` timestamp rather than the machine's real clock.
 * =============================================================================
 */

import { prisma } from "../lib/prisma.js";
import { ClockService } from "./clock.service.js";

export interface StatusCounts {
  new: number;
  first_sent: number;
  follow_up_1_sent: number;
  follow_up_2_sent: number;
  follow_up_3_sent: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
  deactivated: number;
  total: number;
}

export interface CampaignReport {
  virtualClock: {
    iso: string;
    formatted: string;
  };
  statusCounts: StatusCounts;
  activityToday: {
    sentToday: number;
    dueNow: number;
    dueLaterToday: number;
    totalDueToday: number;
    dueTomorrow: number;
  };
  rates: {
    totalEmailsAttempted: number;
    totalDelivered: number;
    totalBounces: number;
    totalReplies: number;
    totalSuppressed: number;
    bounceRatePercent: number;
    replyRatePercent: number;
  };
  breakdownByRole: Record<string, number>;
}

export class ReportingService {
  /**
   * Helper to get start and end boundaries of a day in UTC.
   */
  private static getDayBoundaries(date: Date, dayOffset = 0) {
    const target = new Date(date);
    target.setUTCDate(target.getUTCDate() + dayOffset);

    const start = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate(), 0, 0, 0, 0));
    const end = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate(), 23, 59, 59, 999));

    return { start, end };
  }

  /**
   * Generates a complete campaign report reflecting the current virtual clock state.
   */
  public static async generateReport(): Promise<CampaignReport> {
    const simulatedNow = await ClockService.now();
    const today = this.getDayBoundaries(simulatedNow, 0);
    const tomorrow = this.getDayBoundaries(simulatedNow, 1);

    // 1. Contact counts grouped by status
    const groupedStatus = await prisma.contact.groupBy({
      by: ["status"],
      _count: { id: true }
    });

    const statusCounts: StatusCounts = {
      new: 0,
      first_sent: 0,
      follow_up_1_sent: 0,
      follow_up_2_sent: 0,
      follow_up_3_sent: 0,
      replied: 0,
      bounced: 0,
      unsubscribed: 0,
      deactivated: 0,
      total: 0
    };

    let totalContacts = 0;
    for (const group of groupedStatus) {
      const key = group.status as keyof Omit<StatusCounts, "total">;
      if (key in statusCounts) {
        statusCounts[key] = group._count.id;
      }
      totalContacts += group._count.id;
    }
    statusCounts.total = totalContacts;

    // 2. Sent Today (based on virtual clock date)
    const sentToday = await prisma.emailLog.count({
      where: {
        sentAt: {
          gte: today.start,
          lte: today.end
        },
        status: "SENT"
      }
    });

    // 3. Due Today & Due Tomorrow
    const activeStatuses = ["new", "first_sent", "follow_up_1_sent", "follow_up_2_sent", "follow_up_3_sent"];

    // Due right now (ready to be processed immediately)
    const dueNow = await prisma.contact.count({
      where: {
        status: { in: activeStatuses },
        nextActionAt: { lte: simulatedNow }
      }
    });

    // Due later today (between simulatedNow and 23:59:59 UTC today)
    const dueLaterToday = await prisma.contact.count({
      where: {
        status: { in: activeStatuses },
        nextActionAt: {
          gt: simulatedNow,
          lte: today.end
        }
      }
    });

    // Due tomorrow (between 00:00:00 and 23:59:59 UTC tomorrow)
    const dueTomorrow = await prisma.contact.count({
      where: {
        status: { in: activeStatuses },
        nextActionAt: {
          gte: tomorrow.start,
          lte: tomorrow.end
        }
      }
    });

    // 4. Overall Rates & Deliverability Metrics
    const totalEmailLogs = await prisma.emailLog.count();
    const totalDelivered = await prisma.emailLog.count({ where: { status: "SENT" } });
    const totalBounces = await prisma.emailLog.count({ where: { status: "BOUNCED" } });
    const totalReplies = await prisma.replyLog.count();
    const totalSuppressed = await prisma.suppression.count();

    const bounceRatePercent = totalEmailLogs > 0 ? (totalBounces / totalEmailLogs) * 100 : 0;
    const replyRatePercent = totalDelivered > 0 ? (totalReplies / totalDelivered) * 100 : 0;

    // 5. Role Distribution
    const roleGroups = await prisma.contact.groupBy({
      by: ["role"],
      _count: { id: true },
      orderBy: { _count: { id: "desc" } }
    });

    const breakdownByRole: Record<string, number> = {};
    for (const r of roleGroups) {
      breakdownByRole[r.role] = r._count.id;
    }

    return {
      virtualClock: {
        iso: simulatedNow.toISOString(),
        formatted: simulatedNow.toUTCString()
      },
      statusCounts,
      activityToday: {
        sentToday,
        dueNow,
        dueLaterToday,
        totalDueToday: dueNow + dueLaterToday,
        dueTomorrow
      },
      rates: {
        totalEmailsAttempted: totalEmailLogs,
        totalDelivered,
        totalBounces,
        totalReplies,
        totalSuppressed,
        bounceRatePercent: parseFloat(bounceRatePercent.toFixed(2)),
        replyRatePercent: parseFloat(replyRatePercent.toFixed(2))
      },
      breakdownByRole
    };
  }
}
