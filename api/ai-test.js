import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(request, response) {
  if (request.method !== "GET") {
    return response.status(405).json({
      ok: false,
      error: "METHOD_NOT_ALLOWED",
      message: "รองรับเฉพาะ GET",
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    return response.status(500).json({
      ok: false,
      error: "MISSING_OPENAI_API_KEY",
      message: "ยังไม่พบ OPENAI_API_KEY ใน Vercel",
    });
  }

  try {
    const result = await openai.responses.create({
      model: "gpt-5.6-luna",
      reasoning: { effort: "low" },
      input: [
        {
          role: "system",
          content: "คุณเป็นระบบทดสอบการเชื่อมต่อ ตอบสั้นและทำตามคำสั่งเท่านั้น",
        },
        {
          role: "user",
          content: "ตอบข้อความนี้เท่านั้น: AI เชื่อมต่อสำเร็จ",
        },
      ],
      max_output_tokens: 40,
    });

    return response.status(200).json({
      ok: true,
      service: "ER Duty Planner AI",
      model: "gpt-5.6-luna",
      message: result.output_text?.trim() || "AI ตอบกลับแล้ว",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("OpenAI test failed", error);

    return response.status(500).json({
      ok: false,
      error: "OPENAI_REQUEST_FAILED",
      message: error?.message || "เรียก OpenAI API ไม่สำเร็จ",
    });
  }
}
