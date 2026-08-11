"use client";

import { useState } from "react";

// Default fill for members with no TeamMember.Color — the Sky navy, not the old
// maroon identity. Feeds `background` below, so a token works here.
export function Avatar({ name, color = "var(--color-brand-navy)", size = 32, photo }: {
  name: string; color?: string; size?: number; photo?: string | null;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const src = photo?.trim();

  if (src && !imgFailed) {
    return (
      <img
        src={src}
        alt={name}
        className="rounded-full shrink-0 object-cover"
        style={{ width: size, height: size }}
        onError={() => setImgFailed(true)}
      />
    );
  }
  return (
    <div className="rounded-full flex items-center justify-center font-bold shrink-0"
      style={{ width: size, height: size, background: color, color: "var(--btn-primary-text)", fontSize: size * 0.35 }}>
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}
