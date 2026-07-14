from http.server import BaseHTTPRequestHandler
import json
from datetime import datetime, timezone

from ortools.sat.python import cp_model


PEOPLE = [
    {"id": "p1", "name": "R3 A", "chief": True, "max": 8},
    {"id": "p2", "name": "R3 B", "chief": True, "max": 8},
    {"id": "p3", "name": "R2 C", "chief": True, "max": 8},
    {"id": "p4", "name": "R1 D", "chief": False, "max": 8},
    {"id": "p5", "name": "R1 E", "chief": False, "max": 8},
    {"id": "p6", "name": "R1 F", "chief": False, "max": 8},
]

SHIFTS = ("M", "E", "N")
SHIFT_START = {"M": 8, "E": 16, "N": 24}

HARD_OFF = {
    ("p1", 1, "M"),
    ("p1", 5, "N"),
    ("p2", 2, "E"),
    ("p2", 6, "M"),
    ("p3", 3, "N"),
    ("p3", 7, "E"),
    ("p4", 4, "M"),
    ("p4", 4, "E"),
    ("p4", 4, "N"),
    ("p5", 2, "N"),
    ("p5", 5, "M"),
    ("p6", 1, "E"),
    ("p6", 6, "N"),
}

AVOID = {
    ("p1", 2, "N"),
    ("p2", 7, "N"),
    ("p3", 1, "M"),
    ("p4", 6, "E"),
    ("p5", 3, "M"),
    ("p6", 5, "N"),
}

REQUEST = {
    ("p1", 3, "M"),
    ("p2", 4, "E"),
    ("p3", 5, "N"),
    ("p4", 7, "M"),
    ("p5", 1, "N"),
    ("p6", 2, "M"),
}


def solve_demo():
    model = cp_model.CpModel()

    slots = []
    for day in range(1, 8):
        for shift in SHIFTS:
            start = ((day - 1) * 24) + SHIFT_START[shift]
            for position in range(2):
                slots.append(
                    {
                        "day": day,
                        "shift": shift,
                        "position": position,
                        "start": start,
                    }
                )

    x = {}
    for person_index, person in enumerate(PEOPLE):
        for slot_index, slot in enumerate(slots):
            variable = model.new_bool_var(f"x_{person_index}_{slot_index}")
            x[(person_index, slot_index)] = variable

            if (person["id"], slot["day"], slot["shift"]) in HARD_OFF:
                model.add(variable == 0)

    # ทุกตำแหน่งต้องมีคน exactly 1 คน
    for slot_index in range(len(slots)):
        model.add(
            sum(
                x[(person_index, slot_index)]
                for person_index in range(len(PEOPLE))
            )
            == 1
        )

    # คนเดียวกันห้ามกินสองตำแหน่งในเวรเดียวกัน
    for person_index in range(len(PEOPLE)):
        for day in range(1, 8):
            for shift in SHIFTS:
                matching_slots = [
                    slot_index
                    for slot_index, slot in enumerate(slots)
                    if slot["day"] == day and slot["shift"] == shift
                ]
                model.add(
                    sum(x[(person_index, slot_index)] for slot_index in matching_slots)
                    <= 1
                )

    # ทุกเวรต้องมี Chief อย่างน้อยหนึ่งคน
    for day in range(1, 8):
        for shift in SHIFTS:
            matching_slots = [
                slot_index
                for slot_index, slot in enumerate(slots)
                if slot["day"] == day and slot["shift"] == shift
            ]
            model.add(
                sum(
                    x[(person_index, slot_index)]
                    for person_index, person in enumerate(PEOPLE)
                    if person["chief"]
                    for slot_index in matching_slots
                )
                >= 1
            )

    # เพดานเวรและห้ามเวรติดกัน 8 ชั่วโมง
    unique_starts = sorted({slot["start"] for slot in slots})

    for person_index, person in enumerate(PEOPLE):
        model.add(
            sum(
                x[(person_index, slot_index)]
                for slot_index in range(len(slots))
            )
            <= person["max"]
        )

        for first_start in unique_starts:
            second_start = first_start + 8
            if second_start not in unique_starts:
                continue

            first_slots = [
                slot_index
                for slot_index, slot in enumerate(slots)
                if slot["start"] == first_start
            ]
            second_slots = [
                slot_index
                for slot_index, slot in enumerate(slots)
                if slot["start"] == second_start
            ]

            model.add(
                sum(
                    x[(person_index, slot_index)]
                    for slot_index in first_slots + second_slots
                )
                <= 1
            )

    objective_terms = []

    # เกลี่ยให้คนละประมาณ 7 เวร
    for person_index, person in enumerate(PEOPLE):
        total = sum(
            x[(person_index, slot_index)]
            for slot_index in range(len(slots))
        )

        deviation = model.new_int_var(0, len(slots), f"deviation_{person_index}")
        model.add_abs_equality(deviation, total - 7)
        objective_terms.append(deviation * 15)

        for slot_index, slot in enumerate(slots):
            condition_key = (person["id"], slot["day"], slot["shift"])

            if condition_key in AVOID:
                objective_terms.append(x[(person_index, slot_index)] * 30)

            if condition_key in REQUEST:
                objective_terms.append((1 - x[(person_index, slot_index)]) * 40)

    model.minimize(sum(objective_terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 10
    solver.parameters.num_search_workers = 8
    solver.parameters.random_seed = 2569

    status = solver.solve(model)
    status_name = solver.status_name(status)

    result = {
        "status": status_name,
        "isFeasible": status in (cp_model.OPTIMAL, cp_model.FEASIBLE),
        "objective": solver.objective_value if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) else None,
        "wallTimeSeconds": round(solver.wall_time, 4),
        "people": [],
        "schedule": [],
    }

    if not result["isFeasible"]:
        return result

    for person_index, person in enumerate(PEOPLE):
        assignments = []
        for slot_index, slot in enumerate(slots):
            if solver.value(x[(person_index, slot_index)]) == 1:
                assignments.append(
                    {
                        "day": slot["day"],
                        "shift": slot["shift"],
                        "position": slot["position"] + 1,
                    }
                )

        result["people"].append(
            {
                "id": person["id"],
                "name": person["name"],
                "chiefEligible": person["chief"],
                "total": len(assignments),
                "assignments": assignments,
            }
        )

    for day in range(1, 8):
        for shift in SHIFTS:
            names = []
            for person_index, person in enumerate(PEOPLE):
                for slot_index, slot in enumerate(slots):
                    if (
                        slot["day"] == day
                        and slot["shift"] == shift
                        and solver.value(x[(person_index, slot_index)]) == 1
                    ):
                        names.append(
                            {
                                "name": person["name"],
                                "chiefEligible": person["chief"],
                            }
                        )

            result["schedule"].append(
                {
                    "day": day,
                    "shift": shift,
                    "assigned": names,
                }
            )

    return result


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            result = solve_demo()
            payload = {
                "ok": result["isFeasible"],
                "service": "ER Duty Planner Exact Solver",
                "solver": "Google OR-Tools CP-SAT",
                "testCase": "7 วัน × 3 เวร × 2 คน พร้อม Chief, OFF, ขออยู่, ไม่ Prefer และห้ามเวรติดกัน",
                "result": result,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            status_code = 200 if result["isFeasible"] else 422
        except Exception as error:
            payload = {
                "ok": False,
                "error": "SOLVER_TEST_FAILED",
                "message": str(error),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            status_code = 500

        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")

        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
