"use client";

export type Orientation = "portrait" | "landscape";

/**
 * Mutate the cloned document right before html2canvas snapshots it.
 *
 * Goal: capture the dashboard EXACTLY as it looks on screen — same column
 * widths, same text positions, same wrapping, same truncation. The only
 * mutations we make are ones that don't move pixels around:
 *
 *   1. Solid background under the page (gradient bgs wash colours out
 *      under html2canvas).
 *   2. Lock the cloned doc's color-scheme so the browser doesn't apply
 *      forced-colour heuristics that lighten captures.
 *   3. Inject CSS that disables transitions / animations / filters /
 *      blend-modes (snapshotting mid-transition is what produces faded
 *      colours) AND zeros Tailwind's `ring-offset-shadow` (otherwise the
 *      filter button selected-rings render as a thick white inset border
 *      because html2canvas can't parse Tailwind's modern color syntax).
 *      Note: every rule here is paint-only — none of it changes box size.
 *   4. Replace native `<select>` elements with a `<div>` mirroring the
 *      selected option text and the same box dimensions. html2canvas
 *      cannot render form-control widgets, so without this the select
 *      renders empty.
 *
 * We intentionally DO NOT touch overflow / white-space / text-overflow on
 * any element, and DO NOT inline computed colors — both cause visible
 * layout drift versus the live page.
 */
export function prepareCloneForCapture(
  doc: Document,
  targetEl: HTMLElement,
  themeBg: string
): void {
  doc.documentElement.style.background = themeBg;
  doc.body.style.background = themeBg;
  targetEl.style.background = themeBg;

  doc.documentElement.style.colorScheme =
    themeBg.toLowerCase() === "#ffffff" ? "light" : "dark";
  // forcedColorAdjust isn't typed on CSSStyleDeclaration in TS, so set via
  // setProperty which does work in browsers that support the property.
  doc.documentElement.style.setProperty("forced-color-adjust", "none");

  const styleEl = doc.createElement("style");
  styleEl.setAttribute("data-html2canvas-override", "true");
  styleEl.textContent = `
    *, *::before, *::after {
      transition: none !important;
      animation: none !important;
      mix-blend-mode: normal !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
      filter: none !important;
      text-shadow: none !important;
      --tw-ring-offset-shadow: 0 0 transparent !important;
      --tw-ring-offset-width: 0px !important;
    }
    [class*="ring-accent"] {
      --tw-ring-shadow: 0 0 transparent !important;
      box-shadow: none !important;
    }
    /* html2canvas typesets HTML text ~3-4% wider than the live browser
       engine, so any text that lives inside a fixed-width parent — KPI
       month labels, "Average Ticket Usage" cells, filter triggers
       ("3 selected", "All"), Select-View options, legend pills, Branch
       ADS percentages, etc. — overflows and either wraps or gets cut off
       even though it fits cleanly on the live page.

       Tightening letter-spacing in the clone compresses the glyph run
       back to the live width without changing any element's box
       dimensions, so layout is byte-identical to the live page but text
       no longer drops off. -0.035em is well below visual perception at
       10–14px and large enough to clear html2canvas's overshoot in every
       case we've measured.

       Applied globally (not only to .truncate / .whitespace-nowrap)
       because the cards themselves use overflow-hidden — any inner text
       that goes wider than its card gets clipped, regardless of whether
       it has a truncation class on it. */
    *, *::before, *::after {
      letter-spacing: -0.035em !important;
    }
    /* SVG <text> in Recharts (axis ticks, legend pills, value labels)
       uses font-family declared via CSS variables on the live page. In
       isolated SVG rasterisation those vars don't always resolve, so the
       browser falls back to the default serif/sans which has wildly
       different metrics — that's why axis ticks "touch the line" and
       Branch ADS percentages don't match the live render. Force a
       concrete font stack so the SVG paints with the same metrics
       Recharts used when it positioned the text. */
    svg, svg text, svg tspan {
      font-family: var(--font-noto), var(--font-noto-thai), "Noto Sans", "Noto Sans Thai", ui-sans-serif, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
    }
    html, body {
      background: ${themeBg} !important;
      background-image: none !important;
    }
  `;
  doc.head.appendChild(styleEl);

  const win = doc.defaultView;
  if (!win) return;

  targetEl.querySelectorAll<HTMLSelectElement>("select").forEach((sel) => {
    const optText = sel.options[sel.selectedIndex]?.text ?? "";
    const cs = win.getComputedStyle(sel);
    const replacement = doc.createElement("div");
    replacement.textContent = optText;
    replacement.className = sel.className;
    replacement.style.width = cs.width;
    replacement.style.height = cs.height;
    replacement.style.padding = cs.padding;
    replacement.style.display = "flex";
    replacement.style.alignItems = "center";
    replacement.style.color = cs.color;
    replacement.style.fontSize = cs.fontSize;
    replacement.style.fontFamily = cs.fontFamily;
    replacement.style.fontWeight = cs.fontWeight;
    replacement.style.boxSizing = "border-box";
    sel.replaceWith(replacement);
  });
}

export interface PdfTarget {
  /** DOM element to capture. */
  element: HTMLElement;
  /** Title shown in the page header (optional). */
  title?: string;
}

export interface PdfOptions {
  fileName: string;
  orientation: Orientation;
  /** Default A4 (210 × 297 mm). */
  format?: "a4" | "a3" | "letter";
  /** Page margin in mm. Default 12. */
  marginMm?: number;
  /** Capture DPI multiplier. 2 = retina-ish, 3 = sharper but heavier. */
  scale?: number;
  /** Optional progress callback (0..1). */
  onProgress?: (pct: number) => void;
}

/**
 * Capture one or more DOM elements and emit a single PDF — one page per
 * element, fitted within `marginMm` while preserving the element's aspect
 * ratio (no crop, centered).
 *
 * Both html2canvas and jsPDF are loaded lazily so the dashboard's main
 * bundle stays small for users who never open the PDF tab. The PDF is
 * delivered through a Blob + anchor click so it always downloads (some
 * browsers — notably Safari — open `pdf.save()` results in a new tab).
 *
 * NOTE: Requires `html2canvas` and `jspdf` to be installed at runtime.
 * These are not bundled with RocksFast by default — install them if the
 * PDF export feature is needed: `npm install html2canvas jspdf`.
 */
export async function exportElementsToPdf(
  targets: PdfTarget[],
  opts: PdfOptions
): Promise<void> {
  if (targets.length === 0) throw new Error("No elements to export");

  // Lazy-load the heavy deps only when actually exporting.
  // html2canvas and jspdf are optional runtime deps — install them if needed:
  //   npm install html2canvas jspdf
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dynamicImport = (id: string): Promise<any> => import(/* webpackIgnore: true */ id as never);
  const [{ default: html2canvas }, { default: JsPDF }] = await Promise.all([
    dynamicImport("html2canvas"),
    dynamicImport("jspdf"),
  ]);

  const orientation = opts.orientation;
  const format = opts.format ?? "a4";
  const margin = opts.marginMm ?? 12;
  const scale = opts.scale ?? 2;

  const pdf = new JsPDF({ orientation, unit: "mm", format });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const usableW = pageW - margin * 2;
  const usableH = pageH - margin * 2;

  // Use a clean solid background instead of the gradient that the live page
  // shows — gradients on body wash out the captured colors. Use card bg in
  // dark mode so chart text stays readable; pure white otherwise.
  const isDark = document.documentElement.classList.contains("dark");
  const themeBg = isDark
    ? readCssVar("--bg-card") || "#14171f"
    : "#ffffff";

  // Wait for web fonts (Noto Sans, Noto Sans Thai, Space Grotesk) to be fully ready so html2canvas
  // measures text against the right metrics — otherwise it falls back to the
  // system font, computes different widths, and text overflows / gets clipped.
  if (typeof document !== "undefined" && document.fonts?.ready) {
    await document.fonts.ready;
  }

  for (let i = 0; i < targets.length; i++) {
    const { element, title } = targets[i];
    const elementId = element.getAttribute("data-export-id");
    opts.onProgress?.(i / targets.length);

    // Two RAF ticks: lets React commit any pending state (progress %) AND
    // gives the browser a chance to paint before we hand the main thread
    // back to html2canvas/jsPDF. Without this the whole UI freezes for the
    // entire multi-second capture loop.
    await waitFrame();
    await waitFrame();

    const canvas = await html2canvas(element, {
      backgroundColor: themeBg,
      scale,
      useCORS: true,
      logging: false,
      foreignObjectRendering: false,
      scrollX: 0,
      scrollY: -window.scrollY,
      windowWidth: document.documentElement.scrollWidth,
      windowHeight: document.documentElement.scrollHeight,
      onclone: (doc: Document) => {
        const sel = elementId ? `[data-export-id="${elementId}"]` : null;
        const target = sel
          ? doc.querySelector(sel) as HTMLElement | null
          : null;
        if (target) prepareCloneForCapture(doc, target, themeBg);
      },
    });

    // Lossless PNG; passing 0.92 is a no-op (PNG ignores quality).
    const imgData = canvas.toDataURL("image/png");

    const ratio = canvas.width / canvas.height;
    let drawW = usableW;
    let drawH = drawW / ratio;
    if (drawH > usableH) {
      drawH = usableH;
      drawW = drawH * ratio;
    }
    const offsetX = margin + (usableW - drawW) / 2;
    const offsetY = margin + (usableH - drawH) / 2;

    if (i > 0) pdf.addPage(format, orientation);

    if (title) {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(11);
      pdf.setTextColor("#0f172a");
      pdf.text(title, margin, margin - 3);
    }

    // compression="NONE" embeds the PNG raw — jsPDF's FAST/MEDIUM/SLOW paths
    // re-encode and noticeably dim alpha-tinted surfaces.
    pdf.addImage(
      imgData,
      "PNG",
      offsetX,
      offsetY,
      drawW,
      drawH,
      undefined,
      "NONE"
    );

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor("#64748b");
    const stamp = new Date().toISOString().slice(0, 10);
    pdf.text(stamp, margin, pageH - margin + 6);
    pdf.text(
      `${i + 1} / ${targets.length}`,
      pageW - margin,
      pageH - margin + 6,
      { align: "right" }
    );
  }

  opts.onProgress?.(1);
  // Force a real download via Blob URL — bypasses Safari's habit of opening
  // pdf.save() output as a new tab.
  const blob = pdf.output("blob");
  triggerBlobDownload(blob, opts.fileName);
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function waitFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function readCssVar(name: string): string | null {
  if (typeof window === "undefined") return null;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || null;
}
