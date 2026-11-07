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
  const audio = context;
  if (!audio) return false;
  try {
    await audio.resume();
    if (audio.state !== "running") return false;
    const now = audio.currentTime;
    [660, 990, 1320].forEach((frequency, i) => {
      const oscillator = audio.createOscillator(); const gain = audio.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + i * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.25, now + i * 0.16 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.16 + 0.22);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(now + i * 0.16); oscillator.stop(now + i * 0.16 + 0.26);
    });
    return true;
  } catch { return false; }
}