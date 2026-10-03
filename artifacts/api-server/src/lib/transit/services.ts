/**
 * Which trips run on a given service day: Japanese public holidays (and
 * Sundays) run the holiday timetable, Saturdays the Saturday one.
 */
import holidayJp from "@holiday-jp/holiday_jp";
import type { DayType, Service } from "./model";

const holidays = holidayJp.holidays as Record<string, unknown>;

/** Day of week for a "YYYY-MM-DD" date, Monday = 0 … Sunday = 6. */
function weekdayIndex(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const sundayFirst = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return (sundayFirst + 6) % 7;
}

export function dayTypeOf(date: string): DayType {
  if (date in holidays) return "holiday";
  const weekday = weekdayIndex(date);
  if (weekday === 6) return "holiday";
  if (weekday === 5) return "saturday";
  return "weekday";
}

export function serviceRunsOn(service: Service, date: string): boolean {
  if (service.removed?.includes(date)) return false;
  if (service.added?.includes(date)) return true;
  if (service.startDate && date < service.startDate) return false;
  if (service.endDate && date > service.endDate) return false;
  if (service.dayTypes) return service.dayTypes.includes(dayTypeOf(date));
  if (service.weekdays) return service.weekdays[weekdayIndex(date)];
  return false;
}
