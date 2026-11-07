/** Accepted kitchen orders cannot be cancelled by guests; pending requests expire after one minute. */
export function guestCanCancel(status: string, createdAt: string, now: number): boolean {
  const placed = Date.parse(createdAt);
  return status === "new" && Number.isFinite(placed) && now >= placed && now <= placed + 60_000;
}