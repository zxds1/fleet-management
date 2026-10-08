declare module 'expo-task-manager' {
  export interface TaskManagerTask {
    data?: unknown;
    error?: Error | null;
  }

  export function defineTask(
    taskName: string,
    task: (options: TaskManagerTask) => void | Promise<void>,
  ): void;

  export function getTaskAsync(taskName: string): Promise<unknown>;
  export function isTaskRegisteredAsync(taskName: string): Promise<boolean>;
  export function unregisterTaskAsync(taskName: string): Promise<void>;
}
