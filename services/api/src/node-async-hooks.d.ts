// Tipos mínimos de node:async_hooks (lo da nodejs_compat en Workers); el proyecto no instala @types/node.
declare module "node:async_hooks" {
  export class AsyncLocalStorage<T> {
    getStore(): T | undefined;
    run<R>(store: T, fn: () => R): R;
  }
}
