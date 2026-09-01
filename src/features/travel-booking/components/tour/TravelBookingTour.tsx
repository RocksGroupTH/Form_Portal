"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  GuidedTourFab,
  GuidedTourOverlay,
  type GuidedTourStep,
} from "@/components/tour/GuidedTour";

/**
 * AP-17 guided tour — mirrors AP-1's TravelExpenseTour, but the copy describes
 * a *booking* request (Admin books the room/ticket for you) rather than a
 * reimbursement claim. Anchors live on the sections a first-timer actually has
 * to act on; the note field and the trip-delete confirmation are deliberately
 * not steps.
 */
const STEPS: GuidedTourStep[] = [
  {
    selector: null,
    title: "ยินดีต้อนรับสู่ AP-17",
    body: "ทัวร์สั้นๆ แนะนำการขอจองที่พัก/ตั๋วโดยสารสำหรับไปทำงานต่างจังหวัด — ใช้เวลาประมาณ 1-2 นาที กดปุ่ม ? มุมล่างซ้ายเพื่อเปิดทัวร์อีกครั้งได้ตลอด",
  },
  {
    selector: '[data-tour="ap17-intro"]',
    title: "แบบฟอร์มขอจองที่พัก/ตั๋วโดยสาร",
    body: "ฟอร์มนี้เป็นการ “ขอให้ทีม Admin จองให้” ไม่ใช่การเบิกเงินคืน — ถ้าคุณจ่ายเองแล้วต้องการเบิก ให้ใช้ฟอร์ม AP-1 แทน",
  },
  {
    selector: '[data-tour="ap17-notice"]',
    title: "อ่านเงื่อนไขก่อนกรอก",
    body: "แจ้งล่วงหน้าอย่างน้อย 3 วันทำการ และทีม Admin ตรวจรายการจองวันจันทร์–ศุกร์ เวลา 16.00 — ยื่นกระชั้นเกินไปคือสาเหตุที่จองไม่ทันบ่อยที่สุด",
  },
  {
    selector: '[data-tour="ap17-requester"]',
    title: "ผู้ขอเบิก & หัวหน้างาน",
    body: "ข้อมูลพนักงานและหัวหน้างานดึงจากระบบ HR อัตโนมัติ กดที่อัตราเบี้ยเลี้ยงเพื่อดูประวัติย้อนหลัง — ถ้ากรอกแทนเพื่อนในแผนก กด “เปลี่ยนผู้ขอเบิก” ผู้อนุมัติจะเปลี่ยนเป็นหัวหน้าของคนนั้น",
  },
  {
    selector: '[data-tour="ap17-tabs"]',
    title: "หนึ่งทริป = หนึ่งคำขอ",
    body: "กด “เพิ่มทริป” เพื่อกรอกหลายการเดินทางในครั้งเดียว แต่ละแท็บจะถูกส่งเป็นคำขอแยกใบ — แท็บที่ขึ้นเครื่องหมายถูกสีเขียวคือกรอกครบแล้ว",
  },
  {
    selector: '[data-tour="ap17-trip"]',
    title: "เหตุผล & สถานที่ปฏิบัติงาน",
    body: "เลือกเหตุผล อธิบายงานที่ไปทำ และใส่สถานที่ปฏิบัติงานอย่างน้อย 1 แห่ง — พิมพ์ค้นหาจาก Google Maps ได้เลย ระบบจะค้นเฉพาะในประเทศที่เลือกไว้ด้านบน",
  },
  {
    selector: '[data-tour="ap17-schedule"]',
    title: "วันเดินทาง & ที่พัก",
    body: "เลือกช่วงวันไป–กลับ วันที่ถูกจองไว้ในทริปอื่นแล้วจะถูกล็อกไว้ (ซ้อนกันไม่ได้) — ที่พักบางแบบจะขึ้นป้ายว่าทีม Admin จะจองห้องให้",
  },
  {
    selector: '[data-tour="ap17-vehicle"]',
    title: "ยานพาหนะ",
    body: "เลือกยานพาหนะเพียงตัวเดียวใช้ทั้งขาไปและขากลับ — ระบบจะเปิดช่องจุดขึ้นรถ/เวลา หรือบล็อกเช่ารถให้เองตามพาหนะที่เลือก วันที่เช่าต้องอยู่ในช่วงวันเดินทาง",
  },
  {
    selector: '[data-tour="ap17-idcard"]',
    title: "แนบบัตรประชาชน",
    body: "ต้องแนบรูปบัตรประชาชน 1 รูปเพื่อใช้จองที่พัก/ตั๋ว รับเฉพาะไฟล์รูปและระบบจะตรวจก่อนว่าเป็นบัตรจริง — ถ้าเลือกให้เก็บไว้ ครั้งต่อไปกดใช้รูปเดิมซ้ำได้ทันที",
  },
  {
    selector: '[data-tour="ap17-submit"]',
    title: "สรุป & ส่งคำขอ",
    body: "ยอด Per diem ที่เห็นเป็นเพียงประมาณการ ยอดจริงคำนวณจากอัตราเบี้ยเลี้ยงย้อนหลังตอนกดส่ง — บันทึกร่างไว้ก่อนได้ ปุ่มส่งจะบอกจำนวนใบที่กำลังส่ง",
  },
  {
    selector: null,
    title: "พร้อมกรอกฟอร์มแล้ว",
    body: "เริ่มจากตรวจผู้ขอเบิก แล้วกรอกทีละแท็บจนครบทุกทริป — เปิดทัวร์นี้ซ้ำได้จากปุ่ม ? มุมล่างซ้าย",
  },
];

export function TravelBookingTour() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <>
      {mounted
        ? createPortal(
            <GuidedTourFab
              onOpen={() => setOpen(true)}
              ariaLabel="เปิดทัวร์การใช้งานฟอร์มขอจองที่พัก/ตั๋วโดยสาร"
              tipTitle="ดูทัวร์ AP-17"
              tipSub="แนะนำการกรอกฟอร์ม"
            />,
            document.body,
          )
        : null}
      {open ? (
        <GuidedTourOverlay
          steps={STEPS}
          onClose={() => setOpen(false)}
          ariaLabel="ทัวร์ฟอร์มขอจองที่พัก/ตั๋วโดยสาร AP-17"
          /* The page is wrapped in `acc-theme`, but the overlay is portalled to
             document.body and would otherwise lose those token overrides. */
          scopeClassName="acc-theme"
          accentCss="var(--nav-active-text)"
          ringColor="color-mix(in srgb, var(--nav-active-text) 85%, transparent)"
        />
      ) : null}
    </>
  );
}
