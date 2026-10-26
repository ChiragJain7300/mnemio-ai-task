/**
 * =============================================================================
 * Virtual Clock Service
 * =============================================================================
 * 
 * Purpose:
 * Provides a controllable "Time Machine" for the entire cold-email engine.
 * Instead of relying on the real system clock (which would require waiting days
 * between follow-ups), all services, batch workers, and queries reference this
 * persistent virtual clock.
 * 
 * Storage:
 * Stored in PostgreSQL in the `VirtualClock` singleton row (`id = "singleton"`).
 * This ensures that CLI scripts, web server endpoints, and worker tasks all
 * share the exact same simulated timestamp without drift.
 * =============================================================================
 */

import { prisma } from "../lib/prisma.js";

export interface ClockStatus {
  simulatedNow: Date;
  iso: string;
  formatted: string;
  updatedAt: Date;
}

export class ClockService {
  private static readonly SINGLETON_ID = "singleton";

  /**
   * Retrieves the current simulated date and time.
   * If the singleton row does not exist yet, initializes it to the current real time.
   */
  public static async now(): Promise<Date> {
    const record = await prisma.virtualClock.findUnique({
      where: { id: this.SINGLETON_ID }
    });

    if (record) {
      return record.simulatedNow;
    }

    // Default initialization if seed hasn't run
    const defaultDate = new Date("2026-10-24T09:00:00.000Z");
    const created = await prisma.virtualClock.create({
      data: {
        id: this.SINGLETON_ID,
        simulatedNow: defaultDate
      }
    });

    return created.simulatedNow;
  }

  /**
   * Returns a detailed status object of the current virtual clock.
   */
  public static async getStatus(): Promise<ClockStatus> {
    const simulatedNow = await this.now();
    const record = await prisma.virtualClock.findUnique({
      where: { id: this.SINGLETON_ID }
    });

    return {
      simulatedNow,
      iso: simulatedNow.toISOString(),
      formatted: simulatedNow.toUTCString(),
      updatedAt: record?.updatedAt ?? new Date()
    };
  }

  /**
   * Advances the virtual clock forward by a specified amount of days, hours, or minutes.
   * 
   * Example:
   * await ClockService.advance({ days: 3, hours: 2 });
   * 
   * @param options Object containing days, hours, minutes to advance
   * @returns Object with previous time, new time, and delta applied
   */
  public static async advance(options: {
    days?: number;
    hours?: number;
    minutes?: number;
  }): Promise<{ previousNow: Date; currentNow: Date; deltaDescription: string }> {
    const days = options.days ?? 0;
    const hours = options.hours ?? 0;
    const minutes = options.minutes ?? 0;

    const previousNow = await this.now();
    const newTimestamp = new Date(previousNow.getTime());

    if (days) newTimestamp.setUTCDate(newTimestamp.getUTCDate() + days);
    if (hours) newTimestamp.setUTCHours(newTimestamp.getUTCHours() + hours);
    if (minutes) newTimestamp.setUTCMinutes(newTimestamp.getUTCMinutes() + minutes);

    const updated = await prisma.virtualClock.upsert({
      where: { id: this.SINGLETON_ID },
      update: { simulatedNow: newTimestamp },
      create: { id: this.SINGLETON_ID, simulatedNow: newTimestamp }
    });

    const deltaParts: string[] = [];
    if (days) deltaParts.push(`${days} day(s)`);
    if (hours) deltaParts.push(`${hours} hour(s)`);
    if (minutes) deltaParts.push(`${minutes} minute(s)`);
    const deltaDescription = deltaParts.length > 0 ? `+${deltaParts.join(", ")}` : "No change";

    return {
      previousNow,
      currentNow: updated.simulatedNow,
      deltaDescription
    };
  }

  /**
   * Resets or sets the virtual clock to an explicit target date.
   * 
   * @param targetDate The Date object or ISO string to set
   */
  public static async setTime(targetDate: Date | string): Promise<Date> {
    const parsedDate = typeof targetDate === "string" ? new Date(targetDate) : targetDate;
    if (isNaN(parsedDate.getTime())) {
      throw new Error(`Invalid date supplied to ClockService.setTime: "${targetDate}"`);
    }

    const updated = await prisma.virtualClock.upsert({
      where: { id: this.SINGLETON_ID },
      update: { simulatedNow: parsedDate },
      create: { id: this.SINGLETON_ID, simulatedNow: parsedDate }
    });

    return updated.simulatedNow;
  }
}
