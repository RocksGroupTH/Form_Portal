"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  GuidedTourFab,
  GuidedTourOverlay,
  type GuidedTourStep,
} from "@/components/tour/GuidedTour";

const STEPS: GuidedTourStep[] = [
  {
    selector: null,
    title: "ยินดีต้อนรับสู่ AP-1",
    body: "ทัวร์สั้นๆ แนะนำการกรอกใบเบิกค่าใช้จ่ายในการเดินทาง — ใช้เวลาประมาณ 1-2 นาที กดปุ่ม ? มุมล่างซ้ายเพื่อเปิดทัวร์อีกครั้งได้ตลอด",
  },
  {
    selector: '[data-tour="ap1-intro"]',
    title: "ใบเบิกค่าใช้จ่ายในการเดินทาง",
    body: "ฟอร์ม AP-1 สำหรับพนักงานออฟฟิศ — กรอกข้อมูลให้ครบทุกส่วนก่อนกดส่งคำขอ",
  },
  {
    selector: '[data-tour="ap1-requester"]',
    title: "ผู้ขอเบิก & ผู้จัดการ",
    body: "ตรวจสอบข้อมูลพนักงานและหัวหน้างานอัตโนมัติจาก HR — หากไม่พบผู้จัดการ ติดต่อ HR ก่อนส่งคำขอ",
  },
  {
    selector: '[data-tour="ap1-travel"]',
    title: "รายละเอียดการเดินทาง",
    body: "เลือกแบรนด์ที่เบิกและวันเดินทาง (เลือกได้หลายวัน) — ต้องกรอกส่วนนี้ให้ครบก่อนส่วนอื่นจะเปิดให้กรอก",
  },
  {
    selector: '[data-tour="ap1-work"]',
    title: "รายละเอียดการไปปฏิบัติงาน",
    body: "อธิบายจุดประสงค์และสถานที่ที่ไปในวันนั้น — ถ้าเดินทางหลายวัน ใช้แท็บสลับวันและกรอกแยกแต่ละวัน",
  },
  {
    selector: '[data-tour="ap1-vehicle"]',
    title: "พาหนะ & ระยะทาง",
    body: "เลือกพาหนะที่ใช้ (หลายคันได้) — รถที่คิดตามเรทจะให้เลือกเส้นทางบนแผนที่ ระบบคำนวณระยะทางและค่าใช้จ่ายให้",
  },
  {
    selector: '[data-tour="ap1-expense"]',
    title: "ค่าใช้จ่าย & ใบเสร็จ",
    body: "กรอกค่าโดยสาร ทางด่วน ที่จอดรถ ฯลฯ และแนบรูปใบเสร็จทุกรายการที่มียอดเงิน",
  },
  {
    selector: '[data-tour="ap1-summary"]',
    title: "สรุป & ส่งคำขอ",
    body: "ตรวจยอดรวมและรายการที่ยังไม่ครบ — บันทึกร่างได้ตลอด หรือกดส่งคำขอเมื่อข้อมูลครบถ้วน",
  },
  {
    selector: null,
    title: "พร้อมกรอกฟอร์มแล้ว",
    body: "เริ่มจากเลือกแบรนด์และวันเดินทาง แล้วกรอกทีละส่วน — เปิดทัวร์นี้ซ้ำได้จากปุ่ม ? มุมล่างซ้าย",
  },
];

export function TravelExpenseTour() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <>
      {mounted
        ? createPortal(
            <GuidedTourFab
              onOpen={() => setOpen(true)}
              ariaLabel="เปิดทัวร์การใช้งานฟอร์มเบิกค่าเดินทาง"
              tipTitle="ดูทัวร์ AP-1"
              tipSub="แนะนำการกรอกฟอร์ม"
            />,
            document.body,
          )
        : null}
      {open ? (
        <GuidedTourOverlay
          steps={STEPS}
          onClose={() => setOpen(false)}
          ariaLabel="ทัวร์ฟอร์มเบิกค่าเดินทาง AP-1"
          scopeClassName="acc-theme"
          accentCss="var(--nav-active-text)"
          ringColor="color-mix(in srgb, var(--nav-active-text) 85%, transparent)"
        />
      ) : null}
    </>
  );
}
