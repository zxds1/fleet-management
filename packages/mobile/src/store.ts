import { useSyncExternalStore } from "react";

/**
 * Minimal observable store mirroring Kotlin's `MutableStateFlow` + `collectAsState`.
 * React Native has no coroutines; `useSyncExternalStore` is the faithful equivalent.
 */
export class Store<T> {
  private value: T;
  private listeners = new Set<() => void>();

  constructor(initial: T) {
    this.value = initial;
  }

  get = (): T => {
    return this.value;
  };

  set(next: T): void {
    if (Object.is(next, this.value)) return;
    this.value = next;
    this.listeners.forEach((l) => l());
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

/** Subscribe to a store from a React component. */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get);
}

