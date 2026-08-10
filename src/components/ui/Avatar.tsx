"use client";

import { useState } from "react";

export function Avatar({ name, color = "#1A0608", size = 32, photo }: {
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
      style={{ width: size, height: size, background: color, color: "#fff", fontSize: size * 0.35 }}>
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}
