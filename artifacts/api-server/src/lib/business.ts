/**
 * LastRide for Business is off unless the stack is deployed with
 * EnableBusiness=true, which is also what gives the server its Supabase
 * settings (infra/template.yaml). While it's off, its endpoints aren't served
 * and its scheduled jobs don't query the database.
 */
export function businessEnabled(): boolean {
  return Boolean(process.env.SUPABASE_URL?.trim());
}
