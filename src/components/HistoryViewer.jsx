import { useEffect, useMemo, useState } from "react";
import { collection, query, where, orderBy, getDocs } from "firebase/firestore";
import { db } from "../firebase/config";
import { isMarkedDeleted } from "../utils/isMarkedDeleted";

const pad2 = (value) => String(value).padStart(2, "0");
const dateKeyLocal = (date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

const parseDateKeyLocal = (dateKey) => {
  const [year, month, day] = String(dateKey || "").split("-").map((part) => Number(part));
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, 12, 0, 0, 0);
};

const startOfMonth = (value) => {
  const date = value instanceof Date ? new Date(value) : parseDateKeyLocal(value) || new Date();
  date.setDate(1);
  date.setHours(12, 0, 0, 0);
  return date;
};

const HistoryViewer = ({ user, onBack }) => {
  const [selectedDate, setSelectedDate] = useState("");
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(new Date()));
  const [monthActivity, setMonthActivity] = useState({});
  const [monthLoading, setMonthLoading] = useState(false);

  const [openKey, setOpenKey] = useState(null);

  // PowerScore = round(avgWeight * totalReps) = round(sum(weight*reps))
  const calcPowerFromRows = (rows) => {
    if (!Array.isArray(rows) || rows.length === 0) return 0;
    const totalWR = rows.reduce((s, r) => s + ((Number(r.weight) || 0) * (Number(r.reps) || 0)), 0);
    const totalReps = rows.reduce((s, r) => s + (Number(r.reps) || 0), 0);
    if (totalReps === 0) return 0;
    const avgWeight = totalWR / totalReps;
    return Math.round(avgWeight * totalReps);
  };

  const groupByExercise = (items) => {
    const map = new Map();
    for (const it of items) {
      const key = `${it.muscleGroup}||${it.exercise}`;
      if (!map.has(key)) map.set(key, { key, muscleGroup: it.muscleGroup, exercise: it.exercise, rows: [] });
      map.get(key).rows.push(it);
    }
    // produce array with computed power
    const arr = Array.from(map.values()).map((g) => ({
      ...g,
      powerScore: calcPowerFromRows(g.rows),
    }));
    // sort by muscleGroup then exercise (asc)
    arr.sort((a, b) => (a.muscleGroup || '').localeCompare(b.muscleGroup || '') || (a.exercise || '').localeCompare(b.exercise || ''));
    return arr;
  };

  const fetchRecords = async (dateStr) => {
    if (!user || !dateStr) return;
    setLoading(true);

    try {
      const parsed = parseDateKeyLocal(dateStr);
      if (!parsed) {
        setRecords([]);
        return;
      }
      const start = new Date(parsed);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);

      const q = query(
        collection(db, "workouts"),
        where("uid", "==", user.uid),
        where("timestamp", ">=", start),
        where("timestamp", "<", end),
        orderBy("timestamp", "asc")
      );

      const snapshot = await getDocs(q);
      const data = snapshot.docs
        .map((doc) => doc.data())
        .filter((d) => !isMarkedDeleted(d))
        .map((d) => ({
          muscleGroup: d.muscleGroup || "-",
          exercise: d.exercise || "-",
          weight: d.weight ?? "-",
          reps: d.reps ?? "-", // NUEVO
          timestamp: d.timestamp?.seconds ? new Date(d.timestamp.seconds * 1000) : null,
        }));

      setRecords(data);
    } catch (err) {
      console.error("Error recuperando registros:", err);
      setRecords([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDateChange = (e) => {
    const date = e.target.value;
    setSelectedDate(date);
    setOpenKey(null);
    if (date) {
      setMonthCursor(startOfMonth(date));
    }
    fetchRecords(date);
  };

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const loadMonthActivity = async () => {
      setMonthLoading(true);
      try {
        const start = new Date(monthCursor);
        start.setDate(1);
        start.setHours(0, 0, 0, 0);

        const end = new Date(start);
        end.setMonth(end.getMonth() + 1);

        const q = query(
          collection(db, "workouts"),
          where("uid", "==", user.uid),
          where("timestamp", ">=", start),
          where("timestamp", "<", end),
          orderBy("timestamp", "asc")
        );

        const snapshot = await getDocs(q);
        if (cancelled) return;

        const nextActivity = {};
        snapshot.docs.forEach((snapshotDoc) => {
          const data = snapshotDoc.data();
          if (isMarkedDeleted(data)) return;

          const date =
            data.timestamp?.toDate?.() ||
            (data.timestamp?.seconds ? new Date(data.timestamp.seconds * 1000) : null);
          if (!date) return;

          const key = dateKeyLocal(date);
          nextActivity[key] = (nextActivity[key] || 0) + 1;
        });

        setMonthActivity(nextActivity);
      } catch (err) {
        console.error("Error recuperando actividad mensual:", err);
        if (!cancelled) setMonthActivity({});
      } finally {
        if (!cancelled) setMonthLoading(false);
      }
    };

    loadMonthActivity();

    return () => {
      cancelled = true;
    };
  }, [user, monthCursor]);

  const calendarCells = useMemo(() => {
    const base = new Date(monthCursor);
    const year = base.getFullYear();
    const month = base.getMonth();
    const first = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const lead = (first.getDay() + 6) % 7; // lunes=0
    const total = Math.ceil((lead + daysInMonth) / 7) * 7;

    return Array.from({ length: total }, (_, index) => {
      const dayNumber = index - lead + 1;
      if (dayNumber < 1 || dayNumber > daysInMonth) {
        return { key: `outside-${index}`, dayNumber: "", inMonth: false };
      }
      const date = new Date(year, month, dayNumber, 12, 0, 0, 0);
      const key = dateKeyLocal(date);
      const hits = monthActivity[key] || 0;
      return {
        key,
        dayNumber,
        inMonth: true,
        dateKey: key,
        hits,
        hasActivity: hits > 0,
        isSelected: selectedDate === key,
      };
    });
  }, [monthCursor, monthActivity, selectedDate]);

  const monthLabel = useMemo(
    () => monthCursor.toLocaleDateString("es-ES", { month: "long", year: "numeric" }),
    [monthCursor]
  );

  const shiftMonth = (delta) => {
    setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1, 12, 0, 0, 0));
  };

  const quickPickDate = (dateKey) => {
    if (!dateKey) return;
    setSelectedDate(dateKey);
    setOpenKey(null);
    fetchRecords(dateKey);
  };

  return (
    <div className="history-viewer-shell history-page">
      <header className="history-head">
        <h2>Historial diario</h2>
        <p>Selecciona una fecha y consulta el detalle por ejercicio.</p>
      </header>

      <label className="history-label" htmlFor="date-picker">Selecciona una fecha</label>
      <input
        className="history-date-input"
        type="date"
        id="date-picker"
        value={selectedDate}
        onChange={handleDateChange}
      />
      <section className="history-calendar-card">
        <div className="history-calendar-head">
          <strong>Días con actividad</strong>
          <div className="history-month-nav">
            <button type="button" onClick={() => shiftMonth(-1)} aria-label="Mes anterior">←</button>
            <span>{monthLabel}</span>
            <button type="button" onClick={() => shiftMonth(1)} aria-label="Mes siguiente">→</button>
          </div>
        </div>
        <div className="history-calendar-weekdays" aria-hidden="true">
          {["L", "M", "X", "J", "V", "S", "D"].map((dayLabel) => (
            <span key={dayLabel}>{dayLabel}</span>
          ))}
        </div>
        {monthLoading ? (
          <p className="history-calendar-state">Cargando días...</p>
        ) : (
          <div className="history-calendar-grid">
            {calendarCells.map((cell) => (
              <button
                key={cell.key}
                type="button"
                disabled={!cell.inMonth}
                className={[
                  "history-calendar-day",
                  !cell.inMonth ? "is-outside" : "",
                  cell.hasActivity ? "has-activity" : "",
                  cell.isSelected ? "is-selected" : "",
                ]
                  .join(" ")
                  .trim()}
                onClick={() => quickPickDate(cell.dateKey)}
                title={
                  cell.inMonth
                    ? cell.hasActivity
                      ? `${cell.hits} registro(s) el ${cell.dateKey}`
                      : `Sin registros el ${cell.dateKey}`
                    : ""
                }
              >
                <span>{cell.dayNumber}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {loading && <p className="history-state">Cargando...</p>}

      {!loading && records.length > 0 && (() => {
        const groups = groupByExercise(records);
        return (
          <div className="history-list">
            {groups.map((g) => {
              const isOpen = openKey === g.key;
              return (
                <article key={g.key} className={`history-card${isOpen ? " is-open" : ""}`}>
                  <button
                    type="button"
                    className="history-card-btn"
                    onClick={() => setOpenKey(isOpen ? null : g.key)}
                    aria-expanded={isOpen}
                  >
                    <div className="history-card-line">
                      <span className="history-card-group">{g.muscleGroup}</span>
                      <span className="history-card-exercise">{g.exercise}</span>
                    </div>
                    <div className="history-card-scoreline">
                      <span>PowerScore</span>
                      <strong>{g.powerScore}</strong>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="history-detail">
                      <strong>Series del día</strong>
                      <table className="history-series-table">
                        <thead>
                          <tr>
                            <th>Hora</th>
                            <th>Peso (kg)</th>
                            <th>Reps</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.rows
                            .slice()
                            .sort((a, b) => (a.timestamp?.getTime?.() || 0) - (b.timestamp?.getTime?.() || 0))
                            .map((r, i) => (
                              <tr key={`${g.key}#${i}`}>
                                <td>{r.timestamp ? r.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "-"}</td>
                                <td>{r.weight ?? "-"}</td>
                                <td>{r.reps ?? "-"}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        );
      })()}

      {!loading && selectedDate && records.length === 0 && (
        <p className="history-empty">No hay registros para esta fecha.</p>
      )}

      {onBack && (
        <button className="history-back" onClick={onBack}>
          ← Volver
        </button>
      )}
    </div>
  );
};

export default HistoryViewer;
