import { useEffect, useMemo, useState } from "react";
import { collection, doc, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase/config";
import { getDocWithFreshAuth, getDocsWithFreshAuth } from "../firebase/firestoreRetry";
import { listUserExercises } from "../data/exerciseMaster";
import { buildKpiSummary, getKpiDateRange } from "../utils/buildKpiSummary";
import { formatDistanceKm, formatPace } from "../utils/workoutMetrics";
import { isMarkedDeleted } from "../utils/isMarkedDeleted";

const numberFormatter = new Intl.NumberFormat("es-ES");

const formatDateLabel = (value) =>
  value instanceof Date ? value.toLocaleDateString("es-ES") : "";

const formatMetric = (value, suffix = "") => {
  if (value == null || !Number.isFinite(Number(value))) return "-";
  return `${numberFormatter.format(Number(value))}${suffix}`;
};

const explainKpiLoadError = (error, fallback) => {
  const code = String(error?.code || "").toLowerCase();
  if (code.includes("permission-denied")) return `${fallback} (permisos)`;
  if (code.includes("unauthenticated")) return `${fallback} (sesión)`;
  if (code.includes("unavailable")) return `${fallback} (sin conexión a Firestore)`;
  if (code.includes("failed-precondition")) return `${fallback} (índice o configuración)`;
  const message = String(error?.message || "").trim();
  return message ? `${fallback} (${message})` : fallback;
};

const buildExerciseMasterById = (items = []) =>
  items.reduce((acc, item) => {
    if (!item.exerciseId) return acc;
    acc[item.exerciseId] = item;
    return acc;
  }, {});

const buildStatCards = (summary) => {
  const cards = [
    { label: "Días activos", value: formatMetric(summary.activeDays) },
    { label: "Minutos", value: summary.totalMinutes != null ? `${summary.totalMinutes} min` : "-" },
    { label: "Ejercicios", value: formatMetric(summary.uniqueExercises) },
    { label: "Grupos", value: formatMetric(summary.activeMuscleGroups) },
    { label: "Min/día activo", value: summary.averageMinutesPerActiveDay != null ? `${summary.averageMinutesPerActiveDay} min` : "-" },
  ];

  if (summary.totalCalories != null) {
    cards.push({ label: "Calorías", value: `${summary.totalCalories} kcal` });
  }
  if (summary.totalStrengthPower != null) {
    cards.push({ label: "Power fuerza", value: formatMetric(summary.totalStrengthPower) });
  }
  if (summary.bestStrengthDayPower != null) {
    cards.push({ label: "Pico fuerza", value: formatMetric(summary.bestStrengthDayPower) });
  }
  if (summary.averageStrengthPowerPerDay != null) {
    cards.push({ label: "Power/día", value: formatMetric(summary.averageStrengthPowerPerDay) });
  }
  if (summary.enduranceMinutes > 0) {
    cards.push({ label: "Min resistencia", value: `${summary.enduranceMinutes} min` });
  }
  if (summary.enduranceDistance != null) {
    cards.push({ label: "Distancia", value: formatDistanceKm(summary.enduranceDistance) });
  }
  if (summary.averageSpeedKmh != null) {
    cards.push({ label: "Vel.Media", value: `${summary.averageSpeedKmh} km/h` });
  }
  if (summary.endurancePace != null) {
    cards.push({ label: "Ritmo", value: formatPace(summary.endurancePace) });
  }

  return cards;
};

const KpiRankSection = ({ title, items = [], suffix = "" }) => {
  const maxValue = Math.max(...items.map((item) => item.value), 1);

  return (
    <section className="kpi-section">
      <div className="kpi-section-head">
        <strong>{title}</strong>
        <span>{items.length ? `${items.length} dato(s)` : "Sin datos"}</span>
      </div>
      {items.length === 0 ? (
        <p className="kpi-empty-copy">Sin datos suficientes.</p>
      ) : (
        <div className="kpi-rank-list">
          {items.map((item) => {
            const width = Math.max(8, Math.round((item.value / maxValue) * 100));
            return (
              <div className="kpi-rank-item" key={`${title}-${item.label}`}>
                <div className="kpi-rank-line">
                  <span className="kpi-rank-label">{item.label}</span>
                  <strong>{formatMetric(item.value, suffix)}</strong>
                </div>
                <div className="kpi-rank-bar">
                  <span style={{ width: `${width}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

const KpiViewer = ({ user }) => {
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");
  const selectedRange = useMemo(() => getKpiDateRange(days), [days]);

  useEffect(() => {
    if (!user) {
      setSummary(null);
      return;
    }
    let cancelled = false;

    const loadSummary = async () => {
      setLoading(true);
      setError("");
      try {
        const workoutsQuery = query(
          collection(db, "workouts"),
          where("uid", "==", user.uid),
          where("timestamp", ">=", selectedRange.start),
          where("timestamp", "<=", selectedRange.end),
          orderBy("timestamp", "asc")
        );

        const [workoutsSnap, userSnap, exercises] = await Promise.all([
          getDocsWithFreshAuth(workoutsQuery),
          getDocWithFreshAuth(doc(db, "users", user.uid)),
          listUserExercises(db, user.uid),
        ]);

        if (cancelled) return;

        const workouts = workoutsSnap.docs
          .map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }))
          .filter((record) => !isMarkedDeleted(record));
        const dailyMetricsByDate = userSnap.data()?.dailyMetrics || {};
        const masterById = buildExerciseMasterById(exercises);

        setSummary(buildKpiSummary({
          days: selectedRange.days,
          workouts,
          dateKeys: selectedRange.dateKeys,
          dailyMetricsByDate,
          exerciseMasterById: masterById,
        }));
      } catch (loadErr) {
        console.error("Error cargando KPIs:", loadErr);
        if (!cancelled) {
          setSummary(null);
          setError(explainKpiLoadError(loadErr, "No se pudieron cargar los KPIs."));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadSummary();

    return () => {
      cancelled = true;
    };
  }, [selectedRange, user]);

  const statCards = useMemo(() => (summary ? buildStatCards(summary) : []), [summary]);

  return (
    <div className="exercise-chart-shell kpi-page">
      <header className="kpi-head">
        <h2>KPIs</h2>
        <p>Resumen útil de fuerza y resistencia de los últimos 7 o 30 días.</p>
        <span className="kpi-period">
          Periodo: {formatDateLabel(selectedRange.start)} - {formatDateLabel(selectedRange.end)}
        </span>
      </header>

      <section className="kpi-controls">
        <div className="kpi-range-switch" role="tablist" aria-label="Rango de KPIs">
          <button
            type="button"
            className={`kpi-range-btn${days === 7 ? " is-active" : ""}`}
            onClick={() => setDays(7)}
          >
            Últimos 7 días
          </button>
          <button
            type="button"
            className={`kpi-range-btn${days === 30 ? " is-active" : ""}`}
            onClick={() => setDays(30)}
          >
            Últimos 30 días
          </button>
        </div>
      </section>

      {loading && <p className="kpi-empty-copy">Cargando KPIs...</p>}
      {error && <p className="kpi-message is-error">{error}</p>}

      {!loading && summary && (
        <>
          <section className="kpi-card-grid">
            {statCards.map((card) => (
              <article className="kpi-stat-card" key={card.label}>
                <span>{card.label}</span>
                <strong>{card.value}</strong>
              </article>
            ))}
          </section>

          <section className="kpi-section-grid">
            <KpiRankSection title="Fuerza por grupo" items={summary.strengthGroups} />
            <KpiRankSection title="Fuerza por ejercicio" items={summary.strengthExercises} />
            <KpiRankSection title="Resistencia por ejercicio" items={summary.enduranceExercises} suffix=" min" />
            <KpiRankSection title="Resistencia por grupo" items={summary.enduranceGroups} suffix=" min" />
          </section>
        </>
      )}
    </div>
  );
};

export default KpiViewer;
