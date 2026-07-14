import OpenAI from "openai";
import { validatePlannerSchedule } from "../lib/planner-validator.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function cleanPlainText(value) {
  return String(value || "")
    .replace(/\*\*/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/^ACTION=.*$/gm, "")
    .trim();
}

const ALLOWED_ACTIONS = new Set([
  "REFRESH_EXACT",
  "ALLOW_REQUESTED_OFF",
  "ALLOW_LONG_888",
  "REDUCE_WEEKDAY_MORNING",
  "NONE"
]);

function fallbackAction(audit) {
  const codes = new Set((audit.hardViolations || []).map((item) => item.code));
  if (codes.has("ADJACENT_SHIFTS")) return "REFRESH_EXACT";
  if (codes.has("MORE_THAN_THREE_8_HOUR_REST_SHIFTS")) return "ALLOW_LONG_888";
  if ([...codes].some((code) => code.includes("UNFILLED") || code.includes("MISSING_CHIEF"))) return "REDUCE_WEEKDAY_MORNING";
  if (codes.has("REQUESTED_OFF_ASSIGNED")) return "ALLOW_REQUESTED_OFF";
  return audit.status === "PASS" ? "NONE" : "ALLOW_REQUESTED_OFF";
}

function parseRecommendedAction(raw, audit) {
  const match = String(raw || "").match(/ACTION=(REFRESH_EXACT|ALLOW_REQUESTED_OFF|ALLOW_LONG_888|REDUCE_WEEKDAY_MORNING|NONE)/);
  const value = match?.[1];
  return ALLOWED_ACTIONS.has(value) ? value : fallbackAction(audit);
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({
      ok: false,
      error: "METHOD_NOT_ALLOWED",
      message: "Endpoint นี้รองรับเฉพาะ POST"
    });
  }

  const plannerState = request.body?.plannerState;
  if (!plannerState || typeof plannerState !== "object") {
    return response.status(400).json({
      ok: false,
      error: "INVALID_PAYLOAD",
      message: "ไม่พบข้อมูล plannerState สำหรับตรวจสอบ"
    });
  }

  const audit = validatePlannerSchedule(plannerState);

  if (!process.env.OPENAI_API_KEY) {
    return response.status(200).json({
      ok: true,
      audit,
      aiExplanation: "Validator ตรวจตารางแล้ว แต่ยังไม่พบ OPENAI_API_KEY จึงยังไม่มีคำอธิบายจาก AI",
      aiRecommendedAction: fallbackAction(audit),
      timestamp: new Date().toISOString()
    });
  }

  try {
    const compactAudit = {
      status: audit.status,
      qualityStatus: audit.qualityStatus,
      hardViolations: audit.hardViolations.slice(0, 30),
      softViolations: audit.softViolations.slice(0, 30),
      metrics: {
        mode: audit.metrics.mode,
        peopleCount: audit.metrics.peopleCount,
        slotCount: audit.metrics.slotCount,
        assignmentCount: audit.metrics.assignmentCount,
        unfilledCount: audit.metrics.unfilledCount,
        actualDutyRange: audit.metrics.actualDutyRange,
        holidayDutyRange: audit.metrics.holidayDutyRange
      }
    };

    const aiResult = await openai.responses.create({
      model: "gpt-5.6-luna",
      reasoning: { effort: "low" },
      input: [
        {
          role: "system",
          content:
            "คุณเป็นผู้ช่วยตรวจตารางเวร ER อธิบายภาษาไทยแบบข้อความธรรมดา ห้ามใช้ Markdown ห้ามใช้เครื่องหมายดอกจัน ห้ามแต่งข้อผิดพลาดเพิ่ม ให้ยึดรายการจาก Validator เท่านั้น เริ่มด้วยสรุปว่าผ่าน Hard constraints หรือไม่ จากนั้นบอกปัญหาสำคัญและแนวทางแก้ที่ปลอดภัย 4-8 บรรทัด และย้ำว่า Validator เป็นผู้ตัดสินผลสุดท้าย บรรทัดสุดท้ายต้องเลือกทางแก้เพียงหนึ่งค่าในรูปแบบ ACTION=REFRESH_EXACT หรือ ACTION=ALLOW_REQUESTED_OFF หรือ ACTION=ALLOW_LONG_888 หรือ ACTION=REDUCE_WEEKDAY_MORNING หรือ ACTION=NONE"
        },
        {
          role: "user",
          content: JSON.stringify(compactAudit)
        }
      ],
      max_output_tokens: 450
    });

    return response.status(200).json({
      ok: true,
      audit,
      aiExplanation: cleanPlainText(aiResult.output_text),
      aiRecommendedAction: parseRecommendedAction(aiResult.output_text, audit),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Planner audit failed", error);
    return response.status(200).json({
      ok: true,
      audit,
      aiExplanation: "Validator ตรวจตารางเรียบร้อยแล้ว แต่ AI อธิบายผลไม่สำเร็จในครั้งนี้",
      aiRecommendedAction: fallbackAction(audit),
      aiError: error?.message || "UNKNOWN_AI_ERROR",
      timestamp: new Date().toISOString()
    });
  }
}
