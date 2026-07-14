const SHIFT_ORDER = ["M", "E", "N"];

function makeViolation(code, message, extra = {}) {
  return { code, message, ...extra };
}

function keyOf(date, shift) {
  return `${date}|${shift}`;
}

function conditionKey(personId, date, shift) {
  return `${personId}|${date}|${shift}`;
}

export function validateSchedule(dataset) {
  const people = Array.isArray(dataset.people) ? dataset.people : [];
  const requirements = Array.isArray(dataset.requirements) ? dataset.requirements : [];
  const assignments = Array.isArray(dataset.assignments) ? dataset.assignments : [];
  const hardOff = Array.isArray(dataset.hardOff) ? dataset.hardOff : [];
  const avoid = Array.isArray(dataset.avoid) ? dataset.avoid : [];
  const rules = dataset.rules || {};

  const hardViolations = [];
  const softViolations = [];

  const personById = new Map(people.map((person) => [person.id, person]));
  const hardOffSet = new Set(
    hardOff.map((item) => conditionKey(item.personId, item.date, item.shift))
  );
  const avoidSet = new Set(
    avoid.map((item) => conditionKey(item.personId, item.date, item.shift))
  );

  const assignmentsBySlot = new Map();
  const assignmentsByPersonDate = new Map();
  const countByPerson = new Map();

  for (const assignment of assignments) {
    const slotKey = keyOf(assignment.date, assignment.shift);
    if (!assignmentsBySlot.has(slotKey)) assignmentsBySlot.set(slotKey, []);
    assignmentsBySlot.get(slotKey).push(assignment);

    const personDateKey = `${assignment.personId}|${assignment.date}`;
    if (!assignmentsByPersonDate.has(personDateKey)) assignmentsByPersonDate.set(personDateKey, []);
    assignmentsByPersonDate.get(personDateKey).push(assignment);

    countByPerson.set(
      assignment.personId,
      (countByPerson.get(assignment.personId) || 0) + 1
    );

    if (!personById.has(assignment.personId)) {
      hardViolations.push(
        makeViolation(
          "UNKNOWN_PERSON",
          `พบ personId ${assignment.personId} ที่ไม่มีในรายชื่อ`,
          assignment
        )
      );
      continue;
    }

    if (hardOffSet.has(conditionKey(assignment.personId, assignment.date, assignment.shift))) {
      hardViolations.push(
        makeViolation(
          "HARD_OFF_ASSIGNED",
          `${personById.get(assignment.personId).name} ถูกจัดในช่วง OFF บังคับ`,
          assignment
        )
      );
    }

    if (avoidSet.has(conditionKey(assignment.personId, assignment.date, assignment.shift))) {
      softViolations.push(
        makeViolation(
          "AVOID_ASSIGNED",
          `${personById.get(assignment.personId).name} ถูกจัดในช่วงไม่ Prefer`,
          assignment
        )
      );
    }

    if (assignment.role === "chief" && !personById.get(assignment.personId).chiefEligible) {
      hardViolations.push(
        makeViolation(
          "INELIGIBLE_CHIEF",
          `${personById.get(assignment.personId).name} ถูกตั้งเป็น Chief ทั้งที่ไม่มีสิทธิ์`,
          assignment
        )
      );
    }
  }

  for (const requirement of requirements) {
    const slotAssignments = assignmentsBySlot.get(
      keyOf(requirement.date, requirement.shift)
    ) || [];

    if (slotAssignments.length < requirement.required) {
      hardViolations.push(
        makeViolation(
          "UNDERSTAFFED",
          `${requirement.date} เวร ${requirement.shift} ต้องการ ${requirement.required} คน แต่มี ${slotAssignments.length} คน`,
          {
            date: requirement.date,
            shift: requirement.shift,
            required: requirement.required,
            assigned: slotAssignments.length
          }
        )
      );
    }

    if (slotAssignments.length > requirement.max) {
      hardViolations.push(
        makeViolation(
          "OVERSTAFFED",
          `${requirement.date} เวร ${requirement.shift} เกินจำนวนสูงสุด`,
          {
            date: requirement.date,
            shift: requirement.shift,
            max: requirement.max,
            assigned: slotAssignments.length
          }
        )
      );
    }

    if (requirement.chiefRequired > 0) {
      const chiefCount = slotAssignments.filter(
        (assignment) => assignment.role === "chief"
      ).length;

      if (chiefCount < requirement.chiefRequired) {
        hardViolations.push(
          makeViolation(
            "MISSING_CHIEF",
            `${requirement.date} เวร ${requirement.shift} ขาด Chief`,
            {
              date: requirement.date,
              shift: requirement.shift,
              chiefRequired: requirement.chiefRequired,
              chiefAssigned: chiefCount
            }
          )
        );
      }
    }
  }

  for (const person of people) {
    const total = countByPerson.get(person.id) || 0;
    if (Number.isFinite(person.maxDuty) && total > person.maxDuty) {
      hardViolations.push(
        makeViolation(
          "MAX_DUTY_EXCEEDED",
          `${person.name} มี ${total} เวร เกินเพดาน ${person.maxDuty} เวร`,
          { personId: person.id, total, maxDuty: person.maxDuty }
        )
      );
    }
  }

  if (rules.noSameDayMultipleShifts) {
    for (const [personDateKey, items] of assignmentsByPersonDate.entries()) {
      if (items.length > 1) {
        const [personId, date] = personDateKey.split("|");
        hardViolations.push(
          makeViolation(
            "MULTIPLE_SHIFTS_SAME_DAY",
            `${personById.get(personId)?.name || personId} ถูกจัดมากกว่า 1 เวรในวันเดียวกัน`,
            {
              personId,
              date,
              shifts: items.map((item) => item.shift)
            }
          )
        );
      }
    }
  }

  if (rules.noAdjacentShifts) {
    const byPerson = new Map();
    for (const assignment of assignments) {
      if (!byPerson.has(assignment.personId)) byPerson.set(assignment.personId, []);
      byPerson.get(assignment.personId).push(assignment);
    }

    for (const [personId, items] of byPerson.entries()) {
      items.sort((a, b) => {
        const dateCompare = a.date.localeCompare(b.date);
        if (dateCompare !== 0) return dateCompare;
        return SHIFT_ORDER.indexOf(a.shift) - SHIFT_ORDER.indexOf(b.shift);
      });

      for (let index = 0; index < items.length - 1; index += 1) {
        const current = items[index];
        const next = items[index + 1];

        if (
          current.date === next.date &&
          SHIFT_ORDER.indexOf(next.shift) === SHIFT_ORDER.indexOf(current.shift) + 1
        ) {
          hardViolations.push(
            makeViolation(
              "ADJACENT_SHIFTS",
              `${personById.get(personId)?.name || personId} ถูกจัดเวรติดกัน ${current.shift}→${next.shift}`,
              { personId, from: current, to: next }
            )
          );
        }
      }
    }
  }

  return {
    status: hardViolations.length === 0 ? "PASS" : "FAIL",
    hardViolations,
    softViolations,
    summary: {
      people: people.length,
      slots: requirements.length,
      assignments: assignments.length,
      hardViolationCount: hardViolations.length,
      softViolationCount: softViolations.length
    }
  };
}
