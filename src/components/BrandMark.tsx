"use client";

import { useState } from "react";

/**
 * A brand's logo, falling back to its code where there is no usable image.
 *
 * **The fallback is driven by `onError`, not by the value being null.** A logo
 * URL is always built — an uploaded one, or the `/brandlogo/{code}-200.png`
 * convention — and a brand added to the company brand master brings no artwork
 * with it, so it is the *file* that may be missing rather than the value.
 * Paloma and SANMAI are exactly that case today.
 *
 * **A plain `<img>`, deliberately, not `next/image`.** An uploaded logo is
 * served by `/api/brand-logo/[code]`, which requires a session; Next's image
 * optimizer fetches on the server and would not carry the viewer's cookie, so
 * every uploaded logo would 401 into a broken image. The browser sends the
 * cookie itself. These are 64px marks — there is nothing for the optimizer to
 * win here.
 */
export function BrandMark({
  src,
  alt,
  code,
  size,
  rounded = "rounded-lg",
}: {
  src: string | null;
  alt: string;
  code: string;
  size: number;
  rounded?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <span
        className={`${rounded} flex items-center justify-center font-bold shrink-0`}
        style={{
          width: size,
          height: size,
          fontSize: Math.max(9, Math.round(size * 0.32)),
          background: "var(--nav-active-bg)",
          color: "var(--nav-active-text)",
        }}
        aria-label={alt}
      >
        {code.slice(0, 3)}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      className={`${rounded} object-contain shrink-0`}
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}
