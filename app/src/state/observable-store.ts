import { useSyncExternalStore } from 'react';

/** Minimal external store shared by the dictation service and the UI. */
export class ObservableStore<T> {
  private value: T;
  private readonly listeners = new Set<() => void>();

  constructor(initialValue: T) {
    this.value = initialValue;
  }

  get = (): T => this.value;

  set(next: T | ((current: T) => T)): void {
    this.value = typeof next === 'function' ? (next as (current: T) => T)(this.value) : next;
    this.listeners.forEach(listener => listener());
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

export function useStore<T>(store: ObservableStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get);
}
