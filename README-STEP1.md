# ER Duty Planner AI — Step 1

ชุดนี้ใช้ทดสอบว่าเว็บ HTML และ Vercel backend ทำงานร่วมกันได้ก่อนต่อ OpenAI API

โครงสร้างไฟล์:

- `index.html` — ER Duty Planner v5
- `api/health.js` — Vercel Function สำหรับทดสอบ backend
- `package.json` — ตั้งค่า Node.js project

หลัง Deploy ให้เปิด:

`https://ชื่อโปรเจกต์.vercel.app/api/health`

ผลที่ถูกต้องควรเป็น JSON ที่มี `"ok": true`
