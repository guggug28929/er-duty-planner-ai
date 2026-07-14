# ER Duty Planner AI — Step 3

ขั้นนี้เพิ่มระบบ “Hybrid Audit”:

1. `lib/validator.js` ตรวจเงื่อนไขด้วยโค้ดที่ให้ผลแน่นอน
2. `api/audit-test.js` เรียก Validator ก่อน แล้วให้ AI อธิบายผล
3. `audit-test.html` เป็นหน้าปุ่มทดสอบแบบเห็นผลชัดเจน
4. `package.json` อัปเดตเวอร์ชันของโปรเจกต์

## ไฟล์ที่ต้องอัปโหลดเข้า GitHub repository เดิม

- `package.json` — แทนที่ไฟล์เดิม
- `lib/validator.js`
- `api/audit-test.js`
- `audit-test.html`
- `README-STEP3.md`

หลัง Vercel Deploy เป็น Ready ให้เปิด:

`https://er-duty-planner-ai.vercel.app/audit-test.html`

แล้วกด “เริ่มทดสอบ”

ชุดทดสอบตั้งใจใส่ความผิดไว้ เช่น OFF แล้วถูกจัด, ขาดกำลังคน, Chief ไม่มีสิทธิ์ และจัดช่วงไม่ Prefer เพื่อยืนยันว่าระบบจับปัญหาได้จริง
