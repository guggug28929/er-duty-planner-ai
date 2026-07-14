import OpenAI from "openai";
import { validatePlannerSchedule } from "../lib/planner-validator.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function cleanPlainText(value) {
  return String(value || "")
    .replace(/\*\*/g, "")
    .replace(/^#+\s*/gm, "")
    .trim();
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
            "คุณเป็นผู้ช่วยตรวจตารางเวร ER อธิบายภาษาไทยแบบข้อความธรรมดา ห้ามใช้ Markdown ห้ามใช้เครื่องหมายดอกจัน ห้ามแต่งข้อผิดพลาดเพิ่ม ให้ยึดรายการจาก Validator เท่านั้น เริ่มด้วยสรุปว่าผ่าน Hard constraints หรือไม่ จากนั้นบอกปัญหาสำคัญและแนวทางแก้ที่ปลอดภัย 4-8 บรรทัด และย้ำว่า Validator เป็นผู้ตัดสินผลสุดท้าย"
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
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Planner audit failed", error);
    return response.status(200).json({
      ok: true,
      audit,
      aiExplanation: "Validator ตรวจตารางเรียบร้อยแล้ว แต่ AI อธิบายผลไม่สำเร็จในครั้งนี้",
      aiError: error?.message || "UNKNOWN_AI_ERROR",
      timestamp: new Date().toISOString()
    });
  }
}
