# ER Duty Planner AI — Step 6 Revised

ใช้แพ็กเกจนี้แทน Step 6 เดิมได้เลย เพราะรวมการเชื่อม Exact Solver เข้าหน้าแอปจริง และกฎพัก 8 ชั่วโมงฉบับแก้ไขแล้ว

## กฎใหม่เมื่อเปิดตัวเลือก

- อนุญาตลำดับเวรที่พัก 8 ชั่วโมงได้สูงสุด 3 เวร เช่น เช้า → ดึก → บ่าย
- ห้ามมีเวรที่ 4 ต่อเนื่อง เช่น เช้า → ดึก → บ่าย → เช้า
- Exact Solver ใช้กฎนี้เป็น Hard constraint
- Validator ตรวจซ้ำเป็น Hard violation
- ตัวจัดเวรออฟไลน์สำรองก็จะไม่สร้างลำดับ 4 เวรนี้

## ไฟล์ที่ต้องอัปโหลดเข้า GitHub repository เดิม

- `index.html`
- `requirements.txt`
- `.python-version`
- `vercel.json`
- `api/solve.py`
- `api/audit.js`
- `lib/planner-validator.js`
- `README-STEP6-REVISED.md`

ให้ยืนยันการแทนที่ไฟล์ชื่อซ้ำ และเก็บไฟล์เก่าอื่นไว้ตามเดิม

Commit message ที่แนะนำ:

`Connect exact solver with max 3 eight-hour-rest chain`
