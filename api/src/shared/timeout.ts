export class TimeoutError extends Error {
  constructor(milliseconds: number) {
    super(`Timed out after ${milliseconds} ms`);
    this.name = 'TimeoutError';
  }
}

export async function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(milliseconds)), milliseconds);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
