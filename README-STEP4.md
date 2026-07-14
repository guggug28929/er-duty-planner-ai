# ER Duty Planner AI — Step 4

ขั้นนี้เชื่อมระบบตรวจเข้ากับหน้าแอปจริงแล้ว

## ไฟล์ที่ต้องอัปโหลดเข้า GitHub repository เดิม

- `index.html` — แทนที่ไฟล์เดิม
- `package.json` — แทนที่ไฟล์เดิม
- `api/audit.js`
- `lib/planner-validator.js`
- `README-STEP4.md`

ไม่ต้องลบไฟล์เก่าใน `api/` และ `lib/`

หลัง Deploy เป็น Ready:

1. เปิด `https://er-duty-planner-ai.vercel.app`
2. จัดเวรให้ได้ตารางก่อน
3. ไปหน้า “ผลลัพธ์”
4. กด “AI ตรวจสอบตาราง”

ระบบจะตรวจ Hard constraints ด้วยโค้ดฝั่ง server ก่อน แล้ว AI จะอธิบายผลเป็นภาษาไทย
ขั้นนี้ยังไม่ให้ AI ย้ายเวรอัตโนมัติ การซ่อมตารางจะเพิ่มในขั้นถัดไปหลังยืนยันว่าการตรวจข้อมูลจริงทำงานถูกต้อง
