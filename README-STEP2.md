# ER Duty Planner AI — Step 2

อัปโหลดไฟล์ต่อไปนี้เข้า root ของ GitHub repository เดิม:

- `package.json` — แทนที่ไฟล์เดิม
- `api/ai-test.js` — เพิ่ม endpoint ทดสอบ OpenAI

เมื่อ commit แล้ว Vercel จะ deploy ใหม่อัตโนมัติ จากนั้นเปิด:

`https://er-duty-planner-ai.vercel.app/api/ai-test`

ผลที่ถูกต้องควรมี `"ok": true` และ `"message": "AI เชื่อมต่อสำเร็จ"`
