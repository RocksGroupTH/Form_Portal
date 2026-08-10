interface PageContainerProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  maxWidth?: "default" | "2k";
}

export function PageContainer({ children, className, style, maxWidth = "default" }: PageContainerProps) {
  const maxClass = maxWidth === "2k" ? "max-w-[2560px]" : "max-w-[1200px]";
  const cn = ["w-full min-w-0", maxClass, "mx-auto", className].filter(Boolean).join(" ");
  return <div className={cn} style={style}>{children}</div>;
}
