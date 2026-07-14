import OpenAI from "openai";
import { validateSchedule } from "../lib/validator.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function buildMockDataset() {
  return {
    people: [
      {
        id: "p1",
        name: "Resident A",
        chiefEligible: false,
        maxDuty: 5
      },
      {
        id: "p2",
        name: "Resident B",
        chiefEligible: true,
        maxDuty: 5
      }
    ],
    requirements: [
      {
        date: "2026-05-01",
        shift: "M",
        required: 2,
        max: 2,
        chiefRequired: 1
      },
      {
        date: "2026-05-01",
        shift: "E",
        required: 1,
        max: 1,
        chiefRequired: 1
      }
    ],
    hardOff: [
      {
        personId: "p1",
        date: "2026-05-01",
        shift: "M"
      }
    ],
    avoid: [
      {
        personId: "p2",
        date: "2026-05-01",
        shift: "E"
      }
    ],
    assignments: [
      {
        personId: "p1",
        date: "2026-05-01",
        shift: "M",
        role: "chief"
      },
      {
        personId: "p2",
        date: "2026-05-01",
        shift: "E",
        role: "chief"
      }
    ],
    rules: {
      noSameDayMultipleShifts: true,
      noAdjacentShifts: true
    }
  };
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    return response.status(405).json({
      ok: false,
      error: "METHOD_NOT_ALLOWED",
      message: "รองรับเฉพาะ GET สำหรับชุดทดสอบนี้"
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    return response.status(500).json({
      ok: false,
      error: "MISSING_OPENAI_API_KEY",
      message: "ยังไม่พบ OPENAI_API_KEY ใน Vercel"
    });
  }

  const dataset = buildMockDataset();
  const audit = validateSchedule(dataset);

  try {
    const aiResult = await openai.responses.create({
      model: "gpt-5.6-luna",
      reasoning: { effort: "low" },
      input: [
        {
          role: "system",
          content:
            "คุณเป็นผู้ช่วยอธิบายผลตรวจตารางเวร ER ตอบภาษาไทย 3-5 บรรทัด ห้ามแต่งปัญหาเพิ่ม และต้องย้ำว่าตัว validator เป็นผู้ตัดสินว่าผ่านหรือไม่"
        },
        {
          role: "user",
          content: JSON.stringify({
            status: audit.status,
            hardViolations: audit.hardViolations,
            softViolations: audit.softViolations
          })
        }
      ],
      max_output_tokens: 220
    });

    return response.status(200).json({
      ok: true,
      service: "ER Duty Planner Hybrid Audit",
      validator: audit,
      aiExplanation:
        aiResult.output_text?.trim() ||
        "AI ตอบกลับแล้ว แต่ไม่มีข้อความสำหรับแสดงผล",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Hybrid audit test failed", error);

    return response.status(500).json({
      ok: false,
      error: "HYBRID_AUDIT_FAILED",
      message: error?.message || "ทดสอบระบบตรวจร่วมกับ AI ไม่สำเร็จ",
      validator: audit
    });
  }
}
