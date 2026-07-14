# ER Duty Planner AI — Step 5

ขั้นนี้เพิ่ม Google OR-Tools CP-SAT เป็น Exact Constraint Solver บน Vercel

## ไฟล์ที่ต้องอัปโหลดเข้า GitHub repository เดิม

- `requirements.txt`
- `.python-version`
- `vercel.json`
- `api/solver-test.py`
- `solver-test.html`
- `README-STEP5.md`

ไฟล์เดิมทั้งหมดให้เก็บไว้

## หลัง Deploy เป็น Ready

เปิด:

`https://er-duty-planner-ai.vercel.app/solver-test.html`

แล้วกด “เริ่มทดสอบ OR-Tools”

ผลที่คาด:
- สถานะ OPTIMAL หรือ FEASIBLE
- ตำแหน่งทั้งหมด 42
- ตาราง 7 วัน × 3 เวร × 2 คน
- ทุกเวรมีผู้ที่เป็น Chief ได้อย่างน้อยหนึ่งคน
- แต่ละคนได้เวรประมาณ 7 เวร
