// The hosted demo's daily call limit, set in the environment. NEXT_PUBLIC_
// because the call panel shows it too; neither value is a secret.
export function callLimit(): { enabled: boolean; perDay: number } {
  const n = Number(process.env.NEXT_PUBLIC_CALLS_PER_IP_PER_DAY);
  return {
    enabled: !['false', '0', 'off'].includes((process.env.NEXT_PUBLIC_CALL_LIMIT_ENABLED ?? '').trim().toLowerCase()),
    perDay: process.env.NEXT_PUBLIC_CALLS_PER_IP_PER_DAY && Number.isInteger(n) && n >= 0 ? n : 3,
  };
}
