import { startTransition } from "react";

type RouterReplace = { replace: (href: string, options?: { scroll?: boolean }) => void };
type RouterPush = { push: (href: string, options?: { scroll?: boolean }) => void };
type RouterBack = { back: () => void };
type RouterRefresh = { refresh: () => void };

/**
 * Run an App Router action after the client router action queue is ready.
 * Avoids "Router action dispatched before initialization" during hydration/HMR.
 */
export function deferRouterAction(fn: () => void): void {
  if (typeof window === "undefined") return;
  startTransition(() => {
    queueMicrotask(fn);
  });
}

export function safeReplace(
  router: RouterReplace,
  href: string,
  options?: { scroll?: boolean },
): void {
  deferRouterAction(() => router.replace(href, options));
}

export function safePush(
  router: RouterPush,
  href: string,
  options?: { scroll?: boolean },
): void {
  deferRouterAction(() => router.push(href, options));
}

export function safeBack(router: RouterBack): void {
  deferRouterAction(() => router.back());
}

export function safeRefresh(router: RouterRefresh): void {
  deferRouterAction(() => router.refresh());
}
