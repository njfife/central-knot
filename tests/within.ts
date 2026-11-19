// A test's wait for something its subject does: it goes on the moment that happens, and a generous deadline in real time only
// says that it never happened, naming what was awaited, instead of hanging. Never a guess at how long the subject takes.
export async function within<T>(what: string, happens: Promise<T>): Promise<T> {
  let deadline: NodeJS.Timeout | undefined;
  const never = new Promise<never>((_, fail) => { deadline = setTimeout(() => fail(new Error(`never happened: ${what}`)), 30_000); });
  try { return await Promise.race([happens, never]); } finally { clearTimeout(deadline); }
}
