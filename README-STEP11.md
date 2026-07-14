# ER Duty Planner AI — Step 11

Step 11 รวมทุกฟังก์ชันจาก Step 10 และเพิ่มเพดานเวร Staff ที่หน้าแรก

## ฟังก์ชันใหม่

เมื่อเลือกโหมด Staff ใน Step 1 จะมีช่อง:

`เพดานเวรจริง Staff/คน/เดือน`

- ค่าเริ่มต้น 20 เวร
- แก้เป็นจำนวนอื่นได้ เช่น 12, 16, 18, 24
- นับเฉพาะเวรจริง: เช้า Staff 1, เช้า Staff 2, บ่าย และดึก
- ไม่รวม On call เพราะ On call มีเพดานแยก
- ค่านี้ใช้เป็นค่าเริ่มต้นกับ Staff ทุกคน
- หากกำหนด `เพดานเวรเฉพาะบุคคล` ในหน้าบุคลากรหรือหน้าเงื่อนไข ค่ารายบุคคลจะมีลำดับสูงกว่า

Exact Solver และ Validator ใช้เพดานเดียวกัน

## ไฟล์ที่ต้องอัปโหลด

- index.html
- api/solve.py
- lib/planner-validator.js
- README-STEP11.md

ไฟล์อื่นใน repository เดิมไม่ต้องลบ

## Commit message

`Add configurable Staff maximum duty`
