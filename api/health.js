export default function handler(request, response) {
  response.status(200).json({
    ok: true,
    service: "ER Duty Planner Backend",
    step: 1,
    message: "Backend เชื่อมต่อสำเร็จ",
    timestamp: new Date().toISOString()
  });
}
