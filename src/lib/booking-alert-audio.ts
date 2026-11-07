let context: AudioContext | null = null;
export async function unlockBookingAudio(): Promise<boolean> {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return false;
    context ??= new Ctx();
    await context.resume();
    return context.state === "running";
  } catch { return false; }
}
export async function playBookingChime(): Promise<boolean> {
  if (!context) return false;
  try {
    await context.resume();
    if (context.state !== "running") return false;
    const now = context.currentTime;
    [660, 990, 1320].forEach((frequency, i) => {
      const oscillator = context.createOscillator(); const gain = context.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + i * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.25, now + i * 0.16 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.16 + 0.22);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now + i * 0.16); oscillator.stop(now + i * 0.16 + 0.26);
    });
    return true;
  } catch { return false; }
}