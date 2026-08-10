"use client";
import React, { useMemo } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "icon";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
}

const variantStyles: Record<ButtonVariant, React.CSSProperties> = {
  primary: { background: "var(--btn-primary-bg)", color: "var(--btn-primary-text)", border: "none" },
  secondary: {
    background: "color-mix(in srgb, var(--bg-card) 80%, transparent)",
    color: "var(--text-primary)", border: "1px solid var(--border-card)",
  },
  ghost: { background: "transparent", color: "var(--text-secondary)", border: "1px solid transparent" },
  danger: { background: "var(--btn-danger-bg)", color: "var(--btn-danger-text)", border: "none" },
  icon: { background: "transparent", color: "var(--text-muted)", border: "none", padding: 0 },
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "text-[11px] px-2 py-1 rounded-lg",
  md: "text-[13px] px-3 py-1.5 rounded-xl",
  lg: "text-[14px] px-4 py-2 rounded-xl",
};

export const Button = React.memo(
  React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    { variant = "secondary", size = "md", loading, icon, children, className = "", style, disabled, ...props },
    ref
  ) {
    const isIcon = variant === "icon";
    const sizeClass = isIcon ? "w-8 h-8 rounded-lg flex items-center justify-center" : sizeClasses[size];
    const liftClass = variant === "primary" || variant === "secondary" ? "btn-lift" : "";
    const merged = useMemo(() => (style ? { ...variantStyles[variant], ...style } : variantStyles[variant]), [variant, style]);

    return (
      <button ref={ref}
        className={`font-bold cursor-pointer inline-flex items-center justify-center gap-1.5 transition-opacity shrink-0 disabled:opacity-50 disabled:cursor-not-allowed ${liftClass} ${sizeClass} ${className}`}
        style={merged} disabled={disabled || loading} {...props}
      >
        {loading ? <span className="inline-block w-3.5 h-3.5 border-2 rounded-full animate-spin" style={{ borderColor: "currentColor", borderTopColor: "transparent" }} />
          : icon ? icon : null}
        {children}
      </button>
    );
  })
);
