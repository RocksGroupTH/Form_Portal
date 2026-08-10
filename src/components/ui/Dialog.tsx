"use client";
import React from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

const VISUALLY_HIDDEN: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

export function Dialog({ open, onOpenChange, title, description, children, contentClassName = "", scrollable = true, uniformSurface = false, hideCloseButton = false, bleedBackground = false, hideTitle = false }: {
  open: boolean; onOpenChange: (open: boolean) => void;
  title?: string; description?: string; children: React.ReactNode; contentClassName?: string;
  /** When false, content uses flex column layout — children manage their own scroll region */
  scrollable?: boolean;
  /** Single clean surface (white / dark modal) — no extra shadows */
  uniformSurface?: boolean;
  /** Hide the default top-right close — e.g. when children provide their own */
  hideCloseButton?: boolean;
  /** Children paint the full surface (e.g. ambient gradient backgrounds) */
  bleedBackground?: boolean;
  /** Keep title for screen readers only (Radix a11y requirement) */
  hideTitle?: boolean;
}) {
  const overflowClass = scrollable ? "overflow-visible flex flex-col" : "overflow-hidden flex flex-col";
  const paddingClass = scrollable ? "p-0" : "p-0";
  const surfaceBg = bleedBackground ? undefined : uniformSurface ? "var(--bg-modal)" : undefined;

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-[70]"
          style={{ backgroundColor: "var(--overlay-bg)", animation: "overlayFadeIn 0.15s ease-out" }} />
        <RadixDialog.Content
          aria-describedby={undefined}
          className={`fixed left-[50%] top-[50%] z-[71] w-full translate-x-[-50%] translate-y-[-50%] rounded-xl max-h-[90vh] ${paddingClass} ${overflowClass} ${uniformSurface ? "" : "shadow-2xl"} ${contentClassName || "max-w-lg"}`}
          style={{
            backgroundColor: surfaceBg ?? "var(--bg-modal)",
            borderWidth: 1,
            borderStyle: "solid",
            borderColor: uniformSurface ? "var(--border-main)" : "var(--border-card)",
            boxShadow: uniformSurface ? "var(--shadow-modal)" : "var(--shadow-lg)",
            animation: "dialogIn 0.2s var(--ease-out-expo)",
          }}
        >
          {title && hideTitle && (
            <RadixDialog.Title style={VISUALLY_HIDDEN}>{title}</RadixDialog.Title>
          )}
          {title && !hideTitle && scrollable && (
            <RadixDialog.Title
              className="text-lg font-semibold shrink-0 px-6 pt-6 pb-3 pr-12 m-0"
              style={{ color: "var(--text-heading)" }}
            >
              {title}
            </RadixDialog.Title>
          )}
          {title && !hideTitle && !scrollable && (
            <div
              className="shrink-0 flex items-center justify-between px-5 py-3.5"
              style={{ borderBottom: "1px solid var(--border-light)", background: surfaceBg ?? "var(--bg-card)" }}
            >
              <RadixDialog.Title className="text-[15px] font-bold m-0" style={{ color: "var(--text-heading)" }}>{title}</RadixDialog.Title>
            </div>
          )}
          {description && !scrollable && (
            <RadixDialog.Description className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>{description}</RadixDialog.Description>
          )}
          {scrollable ? (
            <div className="dialog-scroll flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 pb-6">
              {description && (
                <RadixDialog.Description className="mb-3 text-sm" style={{ color: "var(--text-muted)" }}>
                  {description}
                </RadixDialog.Description>
              )}
              {children}
            </div>
          ) : (
            <div className="flex flex-col flex-1 min-h-0 overflow-hidden">{children}</div>
          )}
          {!hideCloseButton && (
            <RadixDialog.Close className="absolute right-4 top-4 rounded-lg p-1 opacity-70 hover:opacity-100"
              style={{ color: "var(--text-muted)" }} aria-label="Close">
              <X className="h-5 w-5" />
            </RadixDialog.Close>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
