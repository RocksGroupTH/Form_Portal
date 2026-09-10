/**
 * What to print for the BC document behind the advance being cleared.
 *
 * The account officer is deciding whether a clearing can go to BC at all, and
 * the state of the advance underneath it is part of that: three AP-3 clearings
 * were cancelled in September 2026 because their advance had already reached BC
 * in a shape nothing on the portal could correct. A bare dash would have said
 * none of that.
 *
 * So absence is reported by its reason. A number always wins — once the
 * document exists, how the send went is history.
 */
export function advanceBcDocLabel(
  documentNo: string | null | undefined,
  erpStatus: string | null | undefined,
): { text: string; muted: boolean } {
  const no = (documentNo ?? "").trim();
  if (no) return { text: no, muted: false };

  switch (erpStatus) {
    case "Sent":
      // Sent, but no number kept — a record from before it was stored.
      return { text: "ส่ง BC แล้ว (ไม่มีเลขที่)", muted: true };
    case "Failed":
      return { text: "ส่ง BC ไม่สำเร็จ", muted: true };
    case "Pending":
      return { text: "กำลังส่ง BC", muted: true };
    default:
      return { text: "ยังไม่ได้ส่ง BC", muted: true };
  }
}
