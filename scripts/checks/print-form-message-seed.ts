/**
 * Print migration 164's seed bodies, so AP-4's compliance copy is never
 * retyped by hand. `src/features/reimburse/constants.test.ts` asserts the
 * migration still contains exactly this output.
 */
import { AP17_HEADER_MESSAGE_LINES } from "@/features/travel-booking/constants";
import { REIMBURSE_NOTICE } from "@/features/reimburse/constants";

const AP1 = [
  "รอบการเบิกจ่ายค่าเดินทาง — ตัดรอบวันจันทร์ (อนุมัติแล้ว) และจ่ายตามปฏิทินการชำระของบริษัท (ทุกศุกร์ที่ 2 และศุกร์ที่ 4 ของเดือน)",
  "ถ้า ผจก. อนุมัติก่อนเที่ยง เข้ารอบจ่ายถัดไป · ตั้งแต่เที่ยงเป็นต้นไป ข้ามไปอีกหนึ่งรอบ",
  "พนักงานออฟฟิศที่กลับบ้านเกิน 21.00 น. หรือมีชั่วโมงทำงานเกิน 8 ชั่วโมง เบิกค่าเดินทางกลับบ้านได้",
  "กรณีต้องการยกเลิกติดต่อเจ้าของฟอร์ม: {เจ้าของฟอร์ม}",
];

for (const [code, lines] of [
  ["AP-1", AP1],
  ["AP-17", Array.from(AP17_HEADER_MESSAGE_LINES)],
  ["AP-4", Array.from(REIMBURSE_NOTICE)],
] as const) {
  const body = lines.join("\n\n");
  if (body.indexOf("'") !== -1) throw new Error(`${code}: apostrophe — escape it as '' by hand`);
  console.log(`\n----- ${code} -----\nN'${body}'`);
}
