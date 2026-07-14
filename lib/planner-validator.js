const ACTUAL_SHIFTS = new Set(["M", "E", "N", "M1", "M2"]);

function violation(code, severity, message, details = {}) {
  return { code, severity, message, ...details };
}

function parseDate(date) {
  return new Date(`${date}T12:00:00Z`);
}

function daysInMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function dateDay(date) {
  return parseDate(date).getUTCDay();
}

function halfBoundary(state) {
  return state.month === 1
    ? Math.floor(daysInMonth(state.year, state.month) / 2)
    : 15;
}

function halfOfDate(state, date) {
  return parseDate(date).getUTCDate() <= halfBoundary(state) ? 1 : 2;
}

function proportionalCap(state, total, half) {
  const dim = daysInMonth(state.year, state.month);
  const boundary = halfBoundary(state);
  const first = Math.ceil((Number(total) * boundary) / dim);
  return half === 1 ? first : Math.max(0, Number(total) - first);
}

function isPublicHoliday(state, date) {
  return (state.holidays || []).some((item) => item.date === date);
}

function isWeekend(date) {
  const day = dateDay(date);
  return day === 0 || day === 6;
}

function isHoliday(state, date) {
  return isWeekend(date) || isPublicHoliday(state, date);
}

function rotationPeriod(state, person, date) {
  if (state.mode === "staff") return "inside";
  const rotation = person.rotation || "inside_all";
  const half = halfOfDate(state, date);

  if (rotation === "inside_all") return "inside";
  if (rotation === "out_bkk_all") return "out_bkk";
  if (rotation === "out_province_all") return "out_province";

  const outsideHalf =
    (rotation.endsWith("h1") && half === 1) ||
    (rotation.endsWith("h2") && half === 2);

  if (!outsideHalf) return "inside";
  return rotation.startsWith("out_bkk") ? "out_bkk" : "out_province";
}

function halfCap(state, person, half) {
  if (person.maxOverride !== null && person.maxOverride !== "" && Number.isFinite(Number(person.maxOverride))) {
    return proportionalCap(state, Number(person.maxOverride), half);
  }

  if (state.mode === "staff") return Number.POSITIVE_INFINITY;

  const sampleDay = half === 1 ? 1 : halfBoundary(state) + 1;
  const sampleDate = `${state.year}-${String(state.month + 1).padStart(2, "0")}-${String(sampleDay).padStart(2, "0")}`;
  const period = rotationPeriod(state, person, sampleDate);

  if (period === "out_province") return 0;
  if (period === "out_bkk") {
    return proportionalCap(state, state.settings?.residentCaps?.outBkk ?? 7, half);
  }

  return proportionalCap(
    state,
    state.settings?.residentCaps?.[person.level] ?? 22,
    half
  );
}

function personCap(state, person) {
  if (person.maxOverride !== null && person.maxOverride !== "" && Number.isFinite(Number(person.maxOverride))) {
    return Number(person.maxOverride);
  }
  if (state.mode === "staff") return Number.POSITIVE_INFINITY;
  return halfCap(state, person, 1) + halfCap(state, person, 2);
}

function conditionMatches(person, type, date, shift) {
  const conditions = person.conditions?.[type] || [];
  return conditions.some(
    (condition) =>
      condition.date === date &&
      Array.isArray(condition.shifts) &&
      condition.shifts.includes(shift)
  );
}

function requestMatches(person, date, shift) {
  return conditionMatches(person, "request", date, shift);
}

function normalizedShift(shift) {
  return ["M1", "M2"].includes(shift) ? "M" : shift;
}

function residentLevelRank(person) {
  return ({ R1: 1, R2: 2, R3: 3 }[person?.level] || 0);
}

function addDays(date, amount) {
  const value = parseDate(date);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function weekendOffMatches(schedule, personId, date, shift, mode) {
  const starts = schedule?.weekendBlocks?.[personId] || [];
  for (const saturday of starts) {
    const friday = addDays(saturday, -1);
    const sunday = addDays(saturday, 1);
    if (date === friday && ["E", "N"].includes(shift)) return true;
    if (date === saturday || date === sunday) {
      if (mode === "staff" && ["M1", "M2", "E", "N", "OC"].includes(shift)) return true;
      if (mode === "resident" && ["M", "E", "N"].includes(shift)) return true;
    }
  }
  return false;
}

function shiftStart(date, shift) {
  const dayIndex = parseDate(date).getUTCDate() - 1;
  const base = dayIndex * 24;
  if (shift === "M" || shift === "M1" || shift === "M2") return base + 8;
  if (shift === "E" || shift === "OC") return base + 16;
  return base + 24;
}

function hasFourShiftEightHourRestChain(starts) {
  const values = new Set(starts);
  for (const start of values) {
    if (
      values.has(start + 16) &&
      values.has(start + 32) &&
      values.has(start + 48)
    ) {
      return true;
    }
  }
  return false;
}

function isFriday(date) {
  return dateDay(date) === 5;
}

function isSunday(date) {
  return dateDay(date) === 0;
}

function staffDefaultMinimum(state) {
  let count = 0;
  const dim = daysInMonth(state.year, state.month);
  for (let day = 1; day <= dim; day += 1) {
    const date = `${state.year}-${String(state.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dow = dateDay(date);
    if (dow !== 0 && dow !== 6 && !isPublicHoliday(state, date)) count += 1;
  }
  return count;
}

export function validatePlannerSchedule(plannerState) {
  const state = plannerState || {};
  const mode = state.mode;
  const people = state.people?.[mode] || [];
  const schedule = state.schedules?.[mode];
  const hardViolations = [];
  const softViolations = [];

  if (!mode || !["resident", "staff"].includes(mode)) {
    return {
      status: "FAIL",
      qualityStatus: "FAIL",
      hardViolations: [violation("INVALID_MODE", "HARD", "ไม่พบโหมด Resident หรือ Staff ที่ถูกต้อง")],
      softViolations: [],
      metrics: {},
      summary: { hardViolationCount: 1, softViolationCount: 0 }
    };
  }

  if (!schedule || !Array.isArray(schedule.slots) || !Array.isArray(schedule.assignments)) {
    return {
      status: "FAIL",
      qualityStatus: "FAIL",
      hardViolations: [violation("NO_SCHEDULE", "HARD", "ยังไม่มีตารางเวรสำหรับเดือนและโหมดนี้")],
      softViolations: [],
      metrics: {},
      summary: { hardViolationCount: 1, softViolationCount: 0 }
    };
  }

  const personById = new Map(people.map((person) => [person.id, person]));
  const slotByKey = new Map(schedule.slots.map((slot) => [slot.key, slot]));
  const assignmentsBySlot = new Map();
  const assignmentsByPerson = new Map();
  const counts = {};

  for (const person of people) {
    counts[person.id] = {
      name: person.name,
      total: 0,
      actual: 0,
      oncall: 0,
      holiday: 0,
      half: { 1: 0, 2: 0 },
      shifts: { M: 0, E: 0, N: 0, M1: 0, M2: 0, OC: 0 },
      starts: []
    };
    assignmentsByPerson.set(person.id, []);
  }

  for (const assignment of schedule.assignments) {
    if (!assignmentsBySlot.has(assignment.key)) assignmentsBySlot.set(assignment.key, []);
    assignmentsBySlot.get(assignment.key).push(assignment);

    const person = personById.get(assignment.personId);
    const slot = slotByKey.get(assignment.key);

    if (!slot) {
      hardViolations.push(
        violation(
          "ASSIGNMENT_WITHOUT_SLOT",
          "HARD",
          `พบการจัดเวร ${assignment.date || "ไม่ทราบวันที่"} ที่ไม่มีตำแหน่งเวรรองรับ`,
          { assignment }
        )
      );
      continue;
    }

    if (!person) {
      hardViolations.push(
        violation(
          "UNKNOWN_PERSON",
          "HARD",
          `พบ personId ${assignment.personId} ที่ไม่มีในรายชื่อ`,
          { assignment }
        )
      );
      continue;
    }

    assignmentsByPerson.get(person.id).push(assignment);
    const stat = counts[person.id];
    stat.total += 1;
    stat.shifts[assignment.shift] = (stat.shifts[assignment.shift] || 0) + 1;

    if (assignment.shift === "OC") {
      stat.oncall += 1;
    } else {
      stat.actual += 1;
      stat.half[halfOfDate(state, assignment.date)] += 1;
      stat.starts.push(Number.isFinite(assignment.start) ? assignment.start : shiftStart(assignment.date, assignment.shift));
      if (isHoliday(state, assignment.date)) stat.holiday += 1;
    }

    if (conditionMatches(person, "hardOff", assignment.date, assignment.shift)) {
      hardViolations.push(
        violation(
          "MANDATORY_OFF_ASSIGNED",
          "HARD",
          `${person.name} ถูกจัดในช่วง OFF บังคับ (เรียน/สอบ/Vacation)`,
          { personId: person.id, date: assignment.date, shift: assignment.shift, slotKey: assignment.key }
        )
      );
    }

    const relaxations = state.settings?.solverRelaxations || {};
    const requestedOffBroken =
      conditionMatches(person, "off", assignment.date, assignment.shift) ||
      weekendOffMatches(schedule, person.id, assignment.date, assignment.shift, mode);

    if (requestedOffBroken) {
      const target = relaxations.allowRequestedOffBreak ? softViolations : hardViolations;
      target.push(
        violation(
          relaxations.allowRequestedOffBreak ? "REQUESTED_OFF_BROKEN" : "REQUESTED_OFF_ASSIGNED",
          relaxations.allowRequestedOffBreak ? "SOFT" : "HARD",
          `${person.name} ถูกจัดในช่วงขอ Off`,
          { personId: person.id, date: assignment.date, shift: assignment.shift, slotKey: assignment.key }
        )
      );
    }

    if (conditionMatches(person, "avoid", assignment.date, assignment.shift)) {
      softViolations.push(
        violation(
          "AVOID_ASSIGNED",
          "SOFT",
          `${person.name} ถูกจัดในช่วงที่ขอให้เลี่ยง`,
          { personId: person.id, date: assignment.date, shift: assignment.shift, slotKey: assignment.key }
        )
      );
    }

    if (assignment.role === "Chief" && !person.chiefEligible) {
      hardViolations.push(
        violation(
          "INELIGIBLE_CHIEF",
          "HARD",
          `${person.name} ถูกตั้งเป็น Chief ทั้งที่ไม่มีสิทธิ์`,
          { personId: person.id, date: assignment.date, shift: assignment.shift, slotKey: assignment.key }
        )
      );
    }

    if (mode === "resident") {
      const period = rotationPeriod(state, person, assignment.date);
      if (period === "out_province") {
        hardViolations.push(
          violation(
            "OUT_PROVINCE_ASSIGNED",
            "HARD",
            `${person.name} วนนอกต่างจังหวัด แต่ถูกจัดเวรในช่วงดังกล่าว`,
            { personId: person.id, date: assignment.date, shift: assignment.shift }
          )
        );
      }

      if (
        period === "out_bkk" &&
        !isHoliday(state, assignment.date) &&
        assignment.shift === "M"
      ) {
        hardViolations.push(
          violation(
            "OUT_BKK_WEEKDAY_MORNING",
            "HARD",
            `${person.name} วนนอก กทม. แต่ถูกจัดเวรเช้าวันทำการ`,
            { personId: person.id, date: assignment.date, shift: assignment.shift }
          )
        );
      }

      if (
        state.settings?.r1WedOff &&
        person.level === "R1" &&
        dateDay(assignment.date) === 3 &&
        assignment.shift === "M"
      ) {
        hardViolations.push(
          violation(
            "R1_WEDNESDAY_MORNING",
            "HARD",
            `${person.name} เป็น R1 แต่ถูกจัดเวรเช้าวันพุธ ขณะเปิด Basic science OFF`,
            { personId: person.id, date: assignment.date, shift: assignment.shift }
          )
        );
      }

      if (period === "out_bkk" && !requestMatches(person, assignment.date, assignment.shift)) {
        if (isSunday(assignment.date) && assignment.shift === "N") {
          softViolations.push(
            violation(
              "OUT_BKK_SUNDAY_NIGHT",
              "SOFT",
              `${person.name} วนนอกและถูกจัดดึกวันอาทิตย์ ทั้งที่ไม่ได้ขออยู่`,
              { personId: person.id, date: assignment.date, shift: assignment.shift }
            )
          );
        } else if (isWeekend(assignment.date)) {
          softViolations.push(
            violation(
              "OUT_BKK_WEEKEND",
              "SOFT",
              `${person.name} วนนอกและถูกจัดเสาร์–อาทิตย์ ทั้งที่ไม่ได้ขออยู่`,
              { personId: person.id, date: assignment.date, shift: assignment.shift }
            )
          );
        } else if (!isPublicHoliday(state, assignment.date) && assignment.shift === "N") {
          softViolations.push(
            violation(
              isFriday(assignment.date) ? "OUT_BKK_FRIDAY_NIGHT" : "OUT_BKK_WEEKDAY_NIGHT",
              "SOFT",
              isFriday(assignment.date)
                ? `${person.name} วนนอกและถูกจัดดึกวันศุกร์ ซึ่งจัดได้แต่ควรเลี่ยง`
                : `${person.name} วนนอกและถูกจัดดึกวันทำการ ควร prefer เวรบ่ายก่อน`,
              { personId: person.id, date: assignment.date, shift: assignment.shift }
            )
          );
        }
      }
    }
  }

  if (mode === "resident") {
    const shiftGroups = new Map();
    for (const assignment of schedule.assignments) {
      if (assignment.shift === "OC") continue;
      const key = `${assignment.date}|${normalizedShift(assignment.shift)}`;
      if (!shiftGroups.has(key)) shiftGroups.set(key, []);
      shiftGroups.get(key).push(assignment);
    }

    for (const [groupKey, groupAssignments] of shiftGroups.entries()) {
      const eligibleAssigned = groupAssignments
        .map((assignment) => ({
          assignment,
          person: personById.get(assignment.personId)
        }))
        .filter((item) => item.person?.chiefEligible);

      const highestRank = Math.max(
        0,
        ...eligibleAssigned.map((item) => residentLevelRank(item.person))
      );

      for (const item of eligibleAssigned) {
        if (
          item.assignment.role === "Chief" &&
          residentLevelRank(item.person) < highestRank
        ) {
          const higherNames = eligibleAssigned
            .filter((other) => residentLevelRank(other.person) === highestRank)
            .map((other) => other.person.name)
            .join(", ");
          hardViolations.push(
            violation(
              "LOWER_LEVEL_CHIEF",
              "HARD",
              `${item.person.name} เป็น Chief ทั้งที่มี Resident ปีสูงกว่าที่เป็น Chief ได้ร่วมเวร (${higherNames})`,
              {
                personId: item.person.id,
                date: item.assignment.date,
                shift: item.assignment.shift,
                groupKey
              }
            )
          );
        }
      }
    }
  }

  for (const slot of schedule.slots) {
    const assigned = assignmentsBySlot.get(slot.key) || [];
    if (assigned.length === 0) {
      hardViolations.push(
        violation(
          slot.role === "Chief" ? "MISSING_CHIEF_SLOT" : "UNFILLED_SLOT",
          "HARD",
          `${slot.date} เวร ${slot.shift} ตำแหน่ง ${slot.role} ยังว่าง`,
          { date: slot.date, shift: slot.shift, role: slot.role, slotKey: slot.key }
        )
      );
    } else if (assigned.length > 1) {
      hardViolations.push(
        violation(
          "DUPLICATE_SLOT_ASSIGNMENT",
          "HARD",
          `${slot.date} เวร ${slot.shift} ตำแหน่งเดียวกันถูกจัดมากกว่า 1 คน`,
          { date: slot.date, shift: slot.shift, role: slot.role, slotKey: slot.key, assigned: assigned.length }
        )
      );
    }
  }

  for (const person of people) {
    const stat = counts[person.id];
    const personAssignments = assignmentsByPerson.get(person.id) || [];

    if (mode === "resident") {
      const cap = personCap(state, person);
      if (stat.actual > cap) {
        hardViolations.push(
          violation(
            "MAX_DUTY_EXCEEDED",
            "HARD",
            `${person.name} มี ${stat.actual} เวร เกินเพดาน ${cap} เวร`,
            { personId: person.id, actual: stat.actual, cap }
          )
        );
      }

      for (const half of [1, 2]) {
        const capHalf = halfCap(state, person, half);
        if (stat.half[half] > capHalf) {
          hardViolations.push(
            violation(
              "HALF_MONTH_CAP_EXCEEDED",
              "HARD",
              `${person.name} มี ${stat.half[half]} เวรในครึ่งเดือนที่ ${half} เกินเพดาน ${capHalf} เวร`,
              { personId: person.id, half, actual: stat.half[half], cap: capHalf }
            )
          );
        }
      }
    } else {
      if (
        person.maxOverride !== null &&
        person.maxOverride !== "" &&
        Number.isFinite(Number(person.maxOverride)) &&
        stat.actual > Number(person.maxOverride)
      ) {
        hardViolations.push(
          violation(
            "STAFF_MAX_ACTUAL_EXCEEDED",
            "HARD",
            `${person.name} มีเวรจริง ${stat.actual} เวร เกินเพดาน ${Number(person.maxOverride)} เวร`,
            { personId: person.id, actual: stat.actual, cap: Number(person.maxOverride) }
          )
        );
      }

      if (
        person.onCallMax !== null &&
        person.onCallMax !== "" &&
        Number.isFinite(Number(person.onCallMax)) &&
        stat.oncall > Number(person.onCallMax)
      ) {
        hardViolations.push(
          violation(
            "ONCALL_MAX_EXCEEDED",
            "HARD",
            `${person.name} มี On call ${stat.oncall} เวร เกินเพดาน ${Number(person.onCallMax)} เวร`,
            { personId: person.id, actual: stat.oncall, cap: Number(person.onCallMax) }
          )
        );
      }

      const minimum =
        person.minTotalDuty === null || person.minTotalDuty === ""
          ? staffDefaultMinimum(state)
          : Number(person.minTotalDuty);

      if (Number.isFinite(minimum) && stat.total < minimum) {
        hardViolations.push(
          violation(
            "MIN_TOTAL_DUTY_NOT_MET",
            "HARD",
            `${person.name} มีเวรรวมจริง + On call ${stat.total} เวร ต่ำกว่าขั้นต่ำ ${minimum} เวร`,
            { personId: person.id, actual: stat.total, minimum }
          )
        );
      }
    }

    const actualAssignments = personAssignments
      .filter((assignment) => ACTUAL_SHIFTS.has(assignment.shift))
      .map((assignment) => ({
        ...assignment,
        computedStart: Number.isFinite(assignment.start)
          ? assignment.start
          : shiftStart(assignment.date, assignment.shift)
      }))
      .sort((a, b) => a.computedStart - b.computedStart);

    const seenStarts = new Map();
    for (const assignment of actualAssignments) {
      if (!seenStarts.has(assignment.computedStart)) seenStarts.set(assignment.computedStart, []);
      seenStarts.get(assignment.computedStart).push(assignment);
    }

    for (const sameTime of seenStarts.values()) {
      if (sameTime.length > 1) {
        hardViolations.push(
          violation(
            "SIMULTANEOUS_ASSIGNMENTS",
            "HARD",
            `${person.name} ถูกจัดหลายตำแหน่งในเวลาเดียวกัน`,
            { personId: person.id, assignments: sameTime }
          )
        );
      }
    }

    for (let index = 0; index < actualAssignments.length - 1; index += 1) {
      const current = actualAssignments[index];
      const next = actualAssignments[index + 1];
      if (next.computedStart - current.computedStart !== 8) continue;

      const strictAdjacent =
        mode === "resident"
          ? Boolean(state.settings?.noAdjacent)
          : state.settings?.staffConsecutivePolicy === "strict";

      if (strictAdjacent) {
        hardViolations.push(
          violation(
            "ADJACENT_SHIFTS",
            "HARD",
            `${person.name} ถูกจัดเวรติดกันโดยพักไม่ถึง 8 ชั่วโมงเต็ม`,
            { personId: person.id, from: current, to: next }
          )
        );
      } else if (mode === "staff") {
        const preferredPair = current.shift === "E" && next.shift === "N";
        softViolations.push(
          violation(
            preferredPair ? "STAFF_CONSECUTIVE_E_N" : "STAFF_CONSECUTIVE_NONPREFERRED",
            "SOFT",
            preferredPair
              ? `${person.name} อยู่เวรบ่ายต่อดึก ซึ่งอนุโลมได้เมื่อจำเป็น`
              : `${person.name} อยู่เวรติดกันในรูปแบบที่ควรเลี่ยง`,
            { personId: person.id, from: current, to: next }
          )
        );
      }
    }

    if (
      state.settings?.avoid888 &&
      hasFourShiftEightHourRestChain(stat.starts)
    ) {
      const relaxed = Boolean(state.settings?.solverRelaxations?.allowLong888);
      const target = relaxed ? softViolations : hardViolations;
      target.push(
        violation(
          relaxed ? "LONG_888_CHAIN_APPROVED" : "MORE_THAN_THREE_8_HOUR_REST_SHIFTS",
          relaxed ? "SOFT" : "HARD",
          `${person.name} มีลำดับเวรพัก 8 ชั่วโมงต่อเนื่องเกิน 3 เวร`,
          { personId: person.id }
        )
      );
    }

    for (const request of person.conditions?.request || []) {
      for (const shift of request.shifts || []) {
        const assigned = personAssignments.some(
          (item) => item.date === request.date && item.shift === shift
        );
        if (!assigned) {
          const strict = Boolean(state.settings?.strictRequests);
          const target = strict ? hardViolations : softViolations;
          target.push(
            violation(
              strict ? "STRICT_REQUEST_NOT_MET" : "REQUEST_NOT_MET",
              strict ? "HARD" : "SOFT",
              `ยังจัดคำขอของ ${person.name} ไม่ได้: ${request.date} เวร ${shift}`,
              { personId: person.id, date: request.date, shift }
            )
          );
        }
      }
    }
  }

  for (const reducedDate of state.settings?.solverRelaxations?.weekdayMorningReducedDates || []) {
    softViolations.push(
      violation(
        "WEEKDAY_MORNING_REDUCED",
        "SOFT",
        `${reducedDate} อนุมัติให้ลดกำลังเวรเช้าวันธรรมดาลง 1 คน`,
        { date: reducedDate, shift: "M" }
      )
    );
  }

  const actualTotals = people.map((person) => counts[person.id]?.actual || 0);
  const holidayTotals = people.map((person) => counts[person.id]?.holiday || 0);
  const metrics = {
    mode,
    peopleCount: people.length,
    slotCount: schedule.slots.length,
    assignmentCount: schedule.assignments.length,
    unfilledCount: schedule.slots.filter((slot) => !(assignmentsBySlot.get(slot.key) || []).length).length,
    actualDutyRange: actualTotals.length
      ? { min: Math.min(...actualTotals), max: Math.max(...actualTotals) }
      : { min: 0, max: 0 },
    holidayDutyRange: holidayTotals.length
      ? { min: Math.min(...holidayTotals), max: Math.max(...holidayTotals) }
      : { min: 0, max: 0 },
    countsByPerson: counts
  };

  const status = hardViolations.length === 0 ? "PASS" : "FAIL";
  const qualityStatus =
    hardViolations.length > 0
      ? "FAIL"
      : softViolations.length > 0
        ? "WARNING"
        : "PASS";

  return {
    status,
    qualityStatus,
    hardViolations,
    softViolations,
    metrics,
    summary: {
      hardViolationCount: hardViolations.length,
      softViolationCount: softViolations.length
    }
  };
}
