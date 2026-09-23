"use client";

import Link from "next/link";
import { useCallback, useSyncExternalStore } from "react";
import {
  CaretDownIcon,
  CheckCircleIcon,
  CircleDashedIcon,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

export type SetupState = {
  hasConnection: boolean;
  hasDashboard: boolean;
  hasWidget: boolean;
};

export function isSetupComplete(state: SetupState): boolean {
  return state.hasConnection && state.hasDashboard && state.hasWidget;
}

type Step = {
  title: string;
  description: string;
  done: boolean;
  href: string;
};

const STORAGE_KEY = "bussola.gettingStarted.collapsed";

/** Same read-straight-from-localStorage pattern as the sidebar's collapse
 *  state in app-shell.tsx — collapsing here is a per-browser preference, not
 *  a dismissal, so it starts expanded on every fresh session. */
const collapseListeners = new Set<() => void>();

function subscribeCollapsed(listener: () => void) {
  collapseListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    collapseListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(next: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    /* a preference that cannot be stored is not worth failing over */
  }
  for (const listener of collapseListeners) listener();
}

/**
 * The first-run path, in the order it has to happen: a source, a canvas,
 * something on it.
 *
 * Progress is derived from what actually exists rather than stored, so it can
 * never drift out of sync with reality — deleting your only connection puts
 * step one back, which is correct. The panel disappears once all three are
 * done and never comes back on its own.
 */
export function GettingStarted({ state }: { state: SetupState }) {
  const collapsed = useSyncExternalStore(
    subscribeCollapsed,
    readCollapsed,
    () => false,
  );

  const toggleCollapsed = useCallback(() => {
    writeCollapsed(!readCollapsed());
  }, []);

  if (isSetupComplete(state)) return null;

  const steps: Step[] = [
    {
      title: "Connect a source",
      description:
        "Paste a read-only API token. It is encrypted before it is stored.",
      done: state.hasConnection,
      href: "/connections",
    },
    {
      title: "Create a dashboard",
      description: "A canvas you arrange yourself. You can have several.",
      done: state.hasDashboard,
      href: "/dashboards",
    },
    {
      title: "Add your first widget",
      description: "Drag, resize, and drop in the blocks you care about.",
      done: state.hasWidget,
      href: "/dashboards",
    },
  ];

  const done = steps.filter((step) => step.done).length;
  const progress = Math.round((done / steps.length) * 100);

  return (
    <section
      aria-labelledby="getting-started-title"
      className="fixed right-4 bottom-4 z-40 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-card shadow-lg">
      <button
        type="button"
        onClick={toggleCollapsed}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={!collapsed}
        aria-controls="getting-started-steps"
      >
        <div className="min-w-0">
          <p id="getting-started-title" className="text-sm font-medium">
            Get set up
          </p>
          <p className="text-xs text-muted-foreground">
            {done} of {steps.length} done
          </p>
        </div>
        <CaretDownIcon
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            collapsed && "-rotate-90",
          )}
        />
      </button>

      <div
        role="progressbar"
        aria-label="Setup progress"
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={done}
        aria-valuetext={`${done} of ${steps.length} steps done`}
        className="h-1 w-full bg-muted"
      >
        <div
          className="h-full bg-primary transition-[width] duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {!collapsed ? (
        <ol
          id="getting-started-steps"
          className="max-h-80 space-y-1 overflow-y-auto p-2">
          {steps.map((step) => (
            <li key={step.title}>
              <Link
                href={step.href}
                className="flex items-start gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/60"
              >
                {step.done ? (
                  <CheckCircleIcon
                    weight="fill"
                    aria-hidden
                    className="mt-0.5 size-5 shrink-0 text-success"
                  />
                ) : (
                  <CircleDashedIcon
                    aria-hidden
                    className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-sm font-medium",
                      step.done && "text-muted-foreground line-through",
                    )}
                  >
                    {step.title}
                    {/* The strike-through is the only other sign of it. */}
                    {step.done ? <span className="sr-only"> (done)</span> : null}
                  </p>
                  {!step.done ? (
                    <p className="text-sm text-muted-foreground">
                      {step.description}
                    </p>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
