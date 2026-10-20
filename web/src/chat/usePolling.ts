import { useEffect, useRef } from 'react';

/**
 * Runs `task` now and then every `intervalMs` while the page is visible, and
 * right away when it becomes visible again. Never overlaps two runs.
 */
export function usePolling(task: () => Promise<void>, intervalMs: number): void {
  const taskRef = useRef(task);
  taskRef.current = task;

  useEffect(() => {
    let running = false;
    const run = async () => {
      if (running || document.visibilityState !== 'visible') return;
      running = true;
      try {
        await taskRef.current();
      } finally {
        running = false;
      }
    };

    void run();
    const timer = setInterval(() => void run(), intervalMs);
    const onVisibilityChange = () => void run();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [intervalMs]);
}
