/**
 * Per-project mutexes to prevent concurrent issue creation
 */

const projectMutexes = new Map();

export async function acquireProjectMutex(projectPath) {
  if (!projectMutexes.has(projectPath)) {
    projectMutexes.set(projectPath, { locked: false, queue: [] });
  }

  const mutex = projectMutexes.get(projectPath);

  if (!mutex.locked) {
    mutex.locked = true;
    return () => {
      mutex.locked = false;
      if (mutex.queue.length > 0) {
        const next = mutex.queue.shift();
        next();
      }
    };
  }

  return new Promise(resolve => {
    mutex.queue.push(() => {
      mutex.locked = true;
      resolve(() => {
        mutex.locked = false;
        if (mutex.queue.length > 0) {
          const next = mutex.queue.shift();
          next();
        }
      });
    });
  });
}
