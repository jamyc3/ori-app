// Apple Calendar bridge.
//
// Wraps the Capacitor calendar plugin so the rest of the app sees the
// same event shape calendar-signals.js consumes:
//   { start: Date, end: Date, title: string, attendees: number,
//     allDay: boolean, durationMin: number }
//
// Only meaningful on iOS — returns empty / no-op on web.

import { Capacitor } from "@capacitor/core";
import {
  CapacitorCalendar,
  CalendarPermissionScope,
} from "@ebarooni/capacitor-calendar";

export function isAvailable() {
  return Capacitor.getPlatform() === "ios";
}

export async function requestPermission() {
  if (!isAvailable()) return { granted: false, reason: "not-ios" };
  try {
    const result = await CapacitorCalendar.requestFullCalendarAccess();
    return { granted: result?.result === "granted", reason: result?.result || "unknown" };
  } catch (err) {
    return { granted: false, reason: String(err?.message || err) };
  }
}

export async function getPermissionState() {
  if (!isAvailable()) return "not-ios";
  try {
    const result = await CapacitorCalendar.checkPermission({
      scope: CalendarPermissionScope.READ_CALENDAR,
    });
    return result?.result || "unknown";
  } catch {
    return "unknown";
  }
}

// Fetch events within [startISO, endISO]. Both must be ISO 8601 strings.
// Returns an array of normalised events. Empty array on failure or no permission.
export async function getEvents({ startISO, endISO }) {
  if (!isAvailable()) return [];
  try {
    const startTs = new Date(startISO).getTime();
    const endTs = new Date(endISO).getTime();
    const raw = await CapacitorCalendar.listEventsInRange({
      from: startTs,
      to: endTs,
    });
    const list = Array.isArray(raw?.result) ? raw.result : [];
    return list.map(normaliseEvent);
  } catch (err) {
    console.warn("[apple-calendar] getEvents failed:", err);
    return [];
  }
}

function normaliseEvent(ev) {
  const start = new Date(ev.startDate);
  const end = new Date(ev.endDate);
  return {
    start,
    end,
    title: ev.title || "",
    attendees: Array.isArray(ev.attendees) ? ev.attendees.length : 0,
    allDay: !!ev.isAllDay,
    durationMin: Math.max(0, Math.round((end - start) / 60000)),
    source: "apple-calendar",
  };
}
