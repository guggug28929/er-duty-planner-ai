from http.server import BaseHTTPRequestHandler
import json
import math
import random
import time
from datetime import date, datetime, timezone

from ortools.sat.python import cp_model


def parse_iso(value):
    return datetime.strptime(value, "%Y-%m-%d").date()


def is_weekend(value):
    return parse_iso(value).weekday() >= 5


def half_boundary(year, month_zero):
    if month_zero == 1:
        import calendar
        return calendar.monthrange(year, month_zero + 1)[1] // 2
    return 15


def half_of_date(value, boundary):
    return 1 if parse_iso(value).day <= boundary else 2


def proportional_cap(total, half, year, month_zero):
    import calendar
    dim = calendar.monthrange(year, month_zero + 1)[1]
    boundary = half_boundary(year, month_zero)
    first = math.ceil(total * boundary / dim)
    return first if half == 1 else max(0, total - first)


def rotation_period(person, value, boundary):
    rotation = person.get("rotation") or "inside_all"
    half = half_of_date(value, boundary)
    if rotation == "inside_all":
        return "inside"
    if rotation == "out_bkk_all":
        return "out_bkk"
    if rotation == "out_province_all":
        return "out_province"
    outside_half = (
        rotation.endswith("h1") and half == 1
    ) or (
        rotation.endswith("h2") and half == 2
    )
    if not outside_half:
        return "inside"
    return "out_bkk" if rotation.startswith("out_bkk") else "out_province"


def person_half_cap(person, half, payload):
    year = int(payload["year"])
    month_zero = int(payload["month"])
    boundary = half_boundary(year, month_zero)
    sample_day = 1 if half == 1 else boundary + 1
    sample = date(year, month_zero + 1, sample_day).isoformat()
    override = person.get("maxOverride")
    if override not in (None, ""):
        return proportional_cap(int(override), half, year, month_zero)
    period = rotation_period(person, sample, boundary)
    if period == "out_province":
        return 0
    settings = payload.get("settings") or {}
    caps = settings.get("residentCaps") or {}
    if period == "out_bkk":
        return proportional_cap(int(caps.get("outBkk", 7)), half, year, month_zero)
    return proportional_cap(int(caps.get(person.get("level"), 22)), half, year, month_zero)


def condition_contains(person, kind, value, shift):
    conditions = ((person.get("conditions") or {}).get(kind) or [])
    return any(
        item.get("date") == value and shift in (item.get("shifts") or [])
        for item in conditions
    )


def request_contains(person, value, shift):
    return condition_contains(person, "request", value, shift)


def normalized_shift(shift):
    return "M" if shift in ("M1", "M2") else shift


def solve_schedule(payload):
    started = time.perf_counter()
    mode = payload.get("mode")
    people = payload.get("people") or []
    slots = payload.get("slots") or []
    settings = payload.get("settings") or {}
    relaxations = settings.get("solverRelaxations") or {}
    allow_requested_off_break = bool(relaxations.get("allowRequestedOffBreak"))
    allow_long_888 = bool(relaxations.get("allowLong888"))
    public_holidays = {item.get("date") for item in (payload.get("holidays") or [])}
    weekend_blocks = payload.get("weekendBlocks") or {}
    seed = int(payload.get("randomSeed") or 2569) % 2_147_483_647
    rng = random.Random(seed)

    if mode not in ("resident", "staff"):
        return {"ok": False, "status": "INVALID_MODE", "message": "โหมดไม่ถูกต้อง"}
    if not people:
        return {"ok": False, "status": "NO_PEOPLE", "message": "ยังไม่มีรายชื่อ"}
    if not slots:
        return {"ok": False, "status": "NO_SLOTS", "message": "ยังไม่มีตำแหน่งเวร"}

    boundary = half_boundary(int(payload["year"]), int(payload["month"]))

    model = cp_model.CpModel()
    x = {}
    eligible = {}
    objective_terms = []
    impossible_reasons = []

    def slot_is_holiday(slot):
        return is_weekend(slot["date"]) or slot["date"] in public_holidays

    def static_eligible(person, slot):
        if slot.get("role") == "Chief" and not person.get("chiefEligible"):
            return False
        if condition_contains(person, "hardOff", slot["date"], slot["shift"]):
            return False
        if not allow_requested_off_break and condition_contains(person, "off", slot["date"], slot["shift"]):
            return False
        blocked = set(weekend_blocks.get(person["id"]) or [])
        if not allow_requested_off_break and f'{slot["date"]}|{slot["shift"]}' in blocked:
            return False
        if mode == "resident":
            period = rotation_period(person, slot["date"], boundary)
            if period == "out_province":
                return False
            if period == "out_bkk" and not slot_is_holiday(slot) and normalized_shift(slot["shift"]) == "M":
                return False
            if (
                settings.get("r1WedOff")
                and person.get("level") == "R1"
                and parse_iso(slot["date"]).weekday() == 2
                and normalized_shift(slot["shift"]) == "M"
            ):
                return False
        return True

    for pi, person in enumerate(people):
        for si, slot in enumerate(slots):
            allowed = static_eligible(person, slot)
            eligible[(pi, si)] = allowed
            variable = model.new_bool_var(f"x_{pi}_{si}")
            x[(pi, si)] = variable
            if not allowed:
                model.add(variable == 0)

    # ทุกตำแหน่งต้องมีคนหนึ่งคนพอดี
    for si, slot in enumerate(slots):
        candidates = [x[(pi, si)] for pi in range(len(people)) if eligible[(pi, si)]]
        if not candidates:
            impossible_reasons.append({
                "code": "NO_ELIGIBLE_PERSON",
                "date": slot.get("date"),
                "shift": slot.get("shift"),
                "role": slot.get("role"),
                "message": f'{slot.get("date")} เวร {slot.get("shift")} ตำแหน่ง {slot.get("role")} ไม่มีผู้มีสิทธิ์เลย'
            })
        else:
            model.add(sum(candidates) == 1)

    if impossible_reasons:
        return {
            "ok": False,
            "status": "INFEASIBLE_PRECHECK",
            "message": "มีตำแหน่งที่ไม่มีผู้มีสิทธิ์ตาม Hard constraints",
            "reasons": impossible_reasons,
            "wallTimeSeconds": round(time.perf_counter() - started, 4),
        }

    actual_slot_indices = [si for si, slot in enumerate(slots) if slot.get("shift") != "OC"]
    oc_slot_indices = [si for si, slot in enumerate(slots) if slot.get("shift") == "OC"]
    starts = sorted({int(slots[si].get("start", 0)) for si in actual_slot_indices})
    slots_by_start = {
        start: [si for si in actual_slot_indices if int(slots[si].get("start", 0)) == start]
        for start in starts
    }

    count_actual = {}
    count_total = {}
    count_holiday = {}
    count_shift = {}
    at_start = {}

    for pi, person in enumerate(people):
        # คนเดียวกันห้ามกินสองตำแหน่งจริงในเวลาเดียวกัน
        for start, indices in slots_by_start.items():
            z = model.new_bool_var(f"start_{pi}_{start}")
            at_start[(pi, start)] = z
            model.add(z == sum(x[(pi, si)] for si in indices))

        # On call คนเดียวกันไม่เกินหนึ่งตำแหน่งต่อวัน
        oc_dates = sorted({slots[si]["date"] for si in oc_slot_indices})
        for value in oc_dates:
            indices = [si for si in oc_slot_indices if slots[si]["date"] == value]
            if indices:
                model.add(sum(x[(pi, si)] for si in indices) <= 1)

        actual = sum(x[(pi, si)] for si in actual_slot_indices)
        total = sum(x[(pi, si)] for si in range(len(slots)))
        count_actual[pi] = actual
        count_total[pi] = total
        count_holiday[pi] = sum(
            x[(pi, si)] for si in actual_slot_indices if slot_is_holiday(slots[si])
        )
        for shift in ("M", "E", "N", "M1", "M2", "OC"):
            count_shift[(pi, shift)] = sum(
                x[(pi, si)] for si, slot in enumerate(slots) if slot.get("shift") == shift
            )

        if mode == "resident":
            first_cap = person_half_cap(person, 1, payload)
            second_cap = person_half_cap(person, 2, payload)
            model.add(actual <= first_cap + second_cap)
            for half, cap in ((1, first_cap), (2, second_cap)):
                indices = [
                    si for si in actual_slot_indices
                    if half_of_date(slots[si]["date"], boundary) == half
                ]
                model.add(sum(x[(pi, si)] for si in indices) <= cap)
        else:
            max_actual = person.get("maxOverride")
            if max_actual not in (None, ""):
                model.add(actual <= int(max_actual))
            max_oc = person.get("onCallMax")
            if max_oc not in (None, ""):
                model.add(sum(x[(pi, si)] for si in oc_slot_indices) <= int(max_oc))
            minimum = person.get("computedMinTotal")
            if minimum not in (None, ""):
                model.add(total >= int(minimum))

    # เวรติดกัน
    strict_adjacent = (
        mode == "resident" and bool(settings.get("noAdjacent"))
    ) or (
        mode == "staff" and settings.get("staffConsecutivePolicy") == "strict"
    )
    for pi, person in enumerate(people):
        for start in starts:
            next_start = start + 8
            if (pi, next_start) not in at_start:
                continue
            first = at_start[(pi, start)]
            second = at_start[(pi, next_start)]
            if strict_adjacent:
                model.add(first + second <= 1)
            elif mode == "staff":
                pair = model.new_bool_var(f"adj_{pi}_{start}")
                model.add(pair <= first)
                model.add(pair <= second)
                model.add(pair >= first + second - 1)
                first_slots = slots_by_start[start]
                second_slots = slots_by_start[next_start]
                first_shifts = {normalized_shift(slots[si]["shift"]) for si in first_slots}
                second_shifts = {normalized_shift(slots[si]["shift"]) for si in second_slots}
                is_evening_night = first_shifts == {"E"} and second_shifts == {"N"}
                policy = settings.get("staffConsecutivePolicy") or "prefer"
                penalty = 220 if is_evening_night else (1100 if policy == "prefer" else 450)
                objective_terms.append(pair * penalty)

        # เมื่อเปิดกฎนี้ อนุญาตลำดับพัก 8 ชั่วโมงได้สูงสุด 3 เวร
        # เช่น เช้า → ดึก → บ่าย แต่ห้ามมีเวรที่ 4 ต่อเนื่อง
        # เวรในลำดับดังกล่าวมีเวลาเริ่มห่างกันครั้งละ 16 ชั่วโมง
        if settings.get("avoid888"):
            for start in starts:
                chain_starts = (start, start + 16, start + 32, start + 48)
                if not all((pi, chain_start) in at_start for chain_start in chain_starts):
                    continue
                chain_sum = sum(at_start[(pi, chain_start)] for chain_start in chain_starts)
                if not allow_long_888:
                    model.add(chain_sum <= 3)
                else:
                    chain_violation = model.new_bool_var(f"long888_{pi}_{start}")
                    model.add(chain_violation <= at_start[(pi, start)])
                    model.add(chain_violation <= at_start[(pi, start + 16)])
                    model.add(chain_violation <= at_start[(pi, start + 32)])
                    model.add(chain_violation <= at_start[(pi, start + 48)])
                    model.add(chain_violation >= chain_sum - 3)
                    objective_terms.append(chain_violation * 18000)

    # ขออยู่เวร: strict = hard, ไม่ strict = soft priority สูง
    strict_requests = bool(settings.get("strictRequests"))
    for pi, person in enumerate(people):
        for item in ((person.get("conditions") or {}).get("request") or []):
            for shift in item.get("shifts") or []:
                indices = [
                    si for si, slot in enumerate(slots)
                    if slot.get("date") == item.get("date")
                    and slot.get("shift") == shift
                    and eligible[(pi, si)]
                ]
                if not indices:
                    if strict_requests:
                        impossible_reasons.append({
                            "code": "IMPOSSIBLE_STRICT_REQUEST",
                            "personId": person.get("id"),
                            "personName": person.get("name"),
                            "date": item.get("date"),
                            "shift": shift,
                            "message": f'{person.get("name")} ขออยู่ {item.get("date")} เวร {shift} แต่ขัด Hard constraints'
                        })
                    continue
                satisfied = sum(x[(pi, si)] for si in indices)
                if strict_requests:
                    model.add(satisfied >= 1)
                else:
                    missed = model.new_bool_var(f"request_missed_{pi}_{item.get('date')}_{shift}")
                    model.add(missed + satisfied == 1)
                    objective_terms.append(missed * 15000)

    if impossible_reasons:
        return {
            "ok": False,
            "status": "INFEASIBLE_PRECHECK",
            "message": "มีคำขอบังคับที่ขัดกับ Hard constraints",
            "reasons": impossible_reasons,
            "wallTimeSeconds": round(time.perf_counter() - started, 4),
        }

    # Soft: ไม่ Prefer และ preference ของวนนอก กทม.
    for pi, person in enumerate(people):
        for si, slot in enumerate(slots):
            var = x[(pi, si)]
            if condition_contains(person, "avoid", slot["date"], slot["shift"]):
                objective_terms.append(var * 6500)

            if allow_requested_off_break and condition_contains(person, "off", slot["date"], slot["shift"]):
                objective_terms.append(var * 22000)

            if allow_requested_off_break and f'{slot["date"]}|{slot["shift"]}' in set(weekend_blocks.get(person["id"]) or []):
                objective_terms.append(var * 20000)

            if mode == "resident" and rotation_period(person, slot["date"], boundary) == "out_bkk":
                if request_contains(person, slot["date"], slot["shift"]):
                    continue
                shift = normalized_shift(slot["shift"])
                holiday = slot_is_holiday(slot)
                weekday = parse_iso(slot["date"]).weekday()
                penalty = 0
                if is_weekend(slot["date"]):
                    penalty = 9000 if weekday == 6 and shift == "N" else 6000
                elif slot["date"] in public_holidays:
                    penalty = 350 if shift == "E" else 900
                elif shift == "E":
                    penalty = 0
                elif shift == "N":
                    penalty = 3200 if weekday == 4 else 5200
                if penalty:
                    objective_terms.append(var * penalty)

            # tiny randomized tie breaker for alternative schedules
            objective_terms.append(var * rng.randint(0, 4))

    # Fairness: ปริมาณเวร, ชนิดเวร, วันหยุด
    active_indices = []
    effective_caps = []
    for pi, person in enumerate(people):
        eligible_actual = sum(1 for si in actual_slot_indices if eligible[(pi, si)])
        if eligible_actual <= 0:
            continue
        active_indices.append(pi)
        if mode == "resident":
            effective_caps.append(max(1, min(eligible_actual, person_half_cap(person, 1, payload) + person_half_cap(person, 2, payload))))
        else:
            maximum = person.get("maxOverride")
            effective_caps.append(max(1, min(eligible_actual, int(maximum) if maximum not in (None, "") else eligible_actual)))

    total_actual_slots = len(actual_slot_indices)
    cap_sum = sum(effective_caps) or 1
    for pi, cap in zip(active_indices, effective_caps):
        target = round(total_actual_slots * cap / cap_sum)
        deviation = model.new_int_var(0, total_actual_slots, f"load_dev_{pi}")
        model.add_abs_equality(deviation, count_actual[pi] - target)
        objective_terms.append(deviation * 180)

        if mode == "resident":
            m = count_shift[(pi, "M")]
            e = count_shift[(pi, "E")]
            n = count_shift[(pi, "N")]
            for label, left, right in (("me", m, e), ("en", e, n), ("mn", m, n)):
                diff = model.new_int_var(0, total_actual_slots, f"shift_diff_{label}_{pi}")
                model.add_abs_equality(diff, left - right)
                objective_terms.append(diff * 45)

    for index, pi in enumerate(active_indices):
        for pj in active_indices[index + 1:]:
            holiday_diff = model.new_int_var(0, total_actual_slots, f"holiday_diff_{pi}_{pj}")
            model.add_abs_equality(holiday_diff, count_holiday[pi] - count_holiday[pj])
            objective_terms.append(holiday_diff * 35)

    if mode == "staff" and len(active_indices) > 1:
        weighted = {}
        for pi in active_indices:
            weighted[pi] = sum(
                int(round(float(slot.get("weight", 1)) * 100)) * x[(pi, si)]
                for si, slot in enumerate(slots)
                if slot.get("shift") != "OC"
            )
        for index, pi in enumerate(active_indices):
            for pj in active_indices[index + 1:]:
                diff = model.new_int_var(0, 100 * len(slots), f"weighted_diff_{pi}_{pj}")
                model.add_abs_equality(diff, weighted[pi] - weighted[pj])
                objective_terms.append(diff * 2)

    model.minimize(sum(objective_terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = float(payload.get("maxTimeSeconds") or 45)
    solver.parameters.num_search_workers = 8
    solver.parameters.random_seed = seed
    solver.parameters.log_search_progress = False

    status = solver.solve(model)
    status_name = solver.status_name(status)
    feasible = status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
    if not feasible:
        return {
            "ok": False,
            "status": status_name,
            "message": "Exact Solver ไม่พบตารางที่ผ่าน Hard constraints ภายในเวลาที่กำหนด",
            "reasons": [],
            "wallTimeSeconds": round(solver.wall_time, 4),
        }

    assignments = []
    for si, slot in enumerate(slots):
        selected = None
        for pi, person in enumerate(people):
            if solver.value(x[(pi, si)]) == 1:
                selected = person
                break
        if selected is None:
            continue
        assignment = dict(slot)
        assignment["personId"] = selected["id"]
        assignment["personName"] = selected.get("name") or selected["id"]
        assignments.append(assignment)

    assignments.sort(key=lambda item: item.get("order", 0))
    return {
        "ok": True,
        "status": status_name,
        "objective": solver.objective_value,
        "bestObjectiveBound": solver.best_objective_bound,
        "wallTimeSeconds": round(solver.wall_time, 4),
        "branches": solver.num_branches,
        "conflicts": solver.num_conflicts,
        "assignments": assignments,
        "slotCount": len(slots),
        "assignmentCount": len(assignments),
        "randomSeed": seed,
        "relaxations": {
            "allowRequestedOffBreak": allow_requested_off_break,
            "allowLong888": allow_long_888,
            "weekdayMorningReducedDates": relaxations.get("weekdayMorningReducedDates") or [],
        },
    }


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length)
            body = json.loads(raw.decode("utf-8") or "{}")
            payload = body.get("planner") or body
            result = solve_schedule(payload)
            status_code = 200 if result.get("ok") else 422
            response = {
                "ok": result.get("ok", False),
                "service": "ER Duty Planner Exact Solver",
                "solver": "Google OR-Tools CP-SAT",
                "result": result,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as error:
            status_code = 500
            response = {
                "ok": False,
                "error": "EXACT_SOLVER_FAILED",
                "message": str(error),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

        encoded = json.dumps(response, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        response = {
            "ok": True,
            "service": "ER Duty Planner Exact Solver",
            "message": "Endpoint พร้อมรับ POST /api/solve",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        encoded = json.dumps(response, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)
