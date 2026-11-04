/**
 * Which trips run on a given service day: Japanese public holidays, the New
 * Year (12/30–1/3) and Sundays run the holiday timetable, Saturdays the Saturday one.
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

/** 12/30–1/3: Tokyo Metro and Toei run the 土休日 timetable over the New Year. */
const YEAR_END = new Set(["12-30", "12-31", "01-01", "01-02", "01-03"]);

export function dayTypeOf(date: string): DayType {
  if (date in holidays || YEAR_END.has(date.slice(5))) return "holiday";
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
