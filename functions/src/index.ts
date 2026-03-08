import {setGlobalOptions} from "firebase-functions";
import {HttpsError, onCall} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {initializeApp} from "firebase-admin/app";
import {FieldValue, getFirestore} from "firebase-admin/firestore";
import {genkit, z} from "genkit";
import {gemini20Flash, vertexAI} from "@genkit-ai/vertexai";
import nodemailer from "nodemailer";

setGlobalOptions({maxInstances: 10});

initializeApp();
const adminDb = getFirestore();

const BUDGET_EUR = 5;
const MAX_CALL_EUR = 0.01;
const TRAINING_PLAN_BUDGET_EUR = 10;
const TRAINING_PLAN_MAX_CALL_EUR = 0.05;
const USD_TO_EUR = 0.92;
const PRICE_INPUT_USD_PER_TOKEN = 0.15 / 1_000_000;
const PRICE_OUTPUT_USD_PER_TOKEN = 0.60 / 1_000_000;
const ADMIN_EMAIL_ALLOWLIST = new Set([
  "jesusrodriguezsanchez@gmail.com",
]);

const ai = genkit({
  plugins: [vertexAI({location: "us-central1"})],
});

const outputSchema = z.object({
  technique: z.string().max(800),
  mistakes: z.string().max(800),
  equipment: z.string().max(240),
  notes: z.string().max(800),
});

const trainingPlanExerciseSchema = z.object({
  muscleGroup: z.string().max(80),
  exercise: z.string().max(120),
  trackingMode: z.enum(["strength", "endurance"]),
  prescription: z.string().max(120),
  intensity: z.string().max(120),
  restSec: z.number().int().min(0).max(600).nullable().optional(),
  durationMin: z.number().min(0).max(240).nullable().optional(),
  distanceKm: z.number().min(0).max(100).nullable().optional(),
  reason: z.string().max(240),
});

const trainingPlanDaySchema = z.object({
  day: z.string().max(40),
  focus: z.string().max(120),
  objective: z.string().max(240),
  warmup: z.string().max(400),
  notes: z.string().max(400),
  exercises: z.array(trainingPlanExerciseSchema).min(2).max(10),
});

const trainingPlanOutputSchema = z.object({
  summary: z.string().max(1000),
  rationale: z.string().max(1200),
  warnings: z.array(z.string().max(240)).max(8),
  recovery: z.array(z.string().max(200)).max(6),
  weeklyPlan: z.array(trainingPlanDaySchema).min(1).max(7),
});

const round2 = (value: number): number => Math.round(value * 100) / 100;

const toFiniteNumber = (value: unknown): number => {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
};

const normalizeText = (value: unknown): string =>
  String(value ?? "").trim().replace(/\s+/g, " ");

const normalizeEmail = (value: unknown): string =>
  normalizeText(value).toLowerCase();

const capText = (value: unknown, max: number): string =>
  normalizeText(value).slice(0, max);

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  const next = Math.round(toFiniteNumber(value));
  if (!Number.isFinite(next)) return fallback;
  return Math.min(max, Math.max(min, next));
};

const toStringArray = (value: unknown, maxItems = 12, maxLength = 80): string[] => {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\n,;|]+/)
      : [];

  const deduped = new Set<string>();
  source.forEach((item) => {
    const normalized = capText(item, maxLength);
    if (!normalized) return;
    deduped.add(normalized);
  });

  return Array.from(deduped).slice(0, maxItems);
};

const parseYoutube = (rawUrl: unknown): {valid: boolean; watchUrl?: string; videoId?: string} => {
  const raw = normalizeText(rawUrl);
  if (!raw) return {valid: false};

  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return {valid: false};
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  let videoId = "";

  if (host === "youtu.be") {
    videoId = parsed.pathname.split("/").filter(Boolean)[0] || "";
  } else if (host === "youtube.com" || host === "m.youtube.com") {
    videoId = parsed.searchParams.get("v") || "";
    if (!videoId && parsed.pathname.startsWith("/shorts/")) {
      videoId = parsed.pathname.split("/")[2] || "";
    }
    if (!videoId && parsed.pathname.startsWith("/embed/")) {
      videoId = parsed.pathname.split("/")[2] || "";
    }
  }

  if (!/^[a-zA-Z0-9_-]{6,}$/.test(videoId)) {
    return {valid: false};
  }

  return {
    valid: true,
    videoId,
    watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
};

const getMonthKeyMadrid = (date = new Date()): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);

  const year = parts.find((item) => item.type === "year")?.value || "1970";
  const month = parts.find((item) => item.type === "month")?.value || "01";
  return `${year}-${month}`;
};

const computeCostEur = (inputTokens: number, outputTokens: number): number => {
  const costUsd =
    inputTokens * PRICE_INPUT_USD_PER_TOKEN +
    outputTokens * PRICE_OUTPUT_USD_PER_TOKEN;
  return costUsd * USD_TO_EUR;
};

const TRACKING_MODE_ENDURANCE = "endurance";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const numberFormatter = new Intl.NumberFormat("es-ES");
let cachedTestTransportPromise:
Promise<nodemailer.Transporter<nodemailer.SentMessageInfo>> | null = null;

const isDeletedRecord = (value: Record<string, unknown>): boolean =>
  value.delete === true ||
  value.deleted === true ||
  value.isDeleted === true ||
  value.softDeleted === true ||
  value.deletedAt != null;

const getDateKeyMadrid = (date = new Date()): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((item) => item.type === "year")?.value || "1970";
  const month = parts.find((item) => item.type === "month")?.value || "01";
  const day = parts.find((item) => item.type === "day")?.value || "01";
  return `${year}-${month}-${day}`;
};

const getDateRange = (days: number): {start: Date; end: Date; dateKeys: string[]} => {
  const safeDays = days === 30 ? 30 : 7;
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (safeDays - 1));

  const dateKeys: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dateKeys.push(getDateKeyMadrid(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return {start, end, dateKeys};
};

const formatMetricValue = (value: number | null, suffix = ""): string => {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${numberFormatter.format(value)}${suffix}`;
};

const formatDistance = (value: number | null): string => {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)} km`;
};

const formatPace = (value: number | null): string => {
  if (value == null || !Number.isFinite(value) || value <= 0) return "-";
  const wholeMinutes = Math.floor(value);
  const seconds = Math.round((value - wholeMinutes) * 60);
  return `${wholeMinutes}:${String(seconds).padStart(2, "0")} min/km`;
};

const buildRankRows = (
  items: Array<{label: string; value: number}>,
  suffix = "",
): string => {
  if (!items.length) {
    return "<p style=\"margin:0;color:#64748b;\">Sin datos suficientes.</p>";
  }
  const maxValue = Math.max(...items.map((item) => item.value), 1);
  return [
    "<div style=\"display:grid;gap:12px;\">",
    ...items.map((item) => {
      const width = Math.max(8, Math.round((item.value / maxValue) * 100));
      return [
        "<div>",
        `<div style="display:flex;justify-content:space-between;gap:12px;font-size:14px;margin-bottom:4px;">`,
        `<strong style="color:#0f172a;">${item.label}</strong>`,
        `<span style="color:#334155;">${formatMetricValue(item.value, suffix)}</span>`,
        "</div>",
        `<div style="height:10px;border-radius:999px;background:#e2e8f0;overflow:hidden;">`,
        `<div style="height:100%;width:${width}%;border-radius:999px;background:linear-gradient(90deg,#0f766e,#14b8a6);"></div>`,
        "</div>",
        "</div>",
      ].join("");
    }),
    "</div>",
  ].join("");
};

const buildSummaryEmailHtml = (summary: {
  days: number;
  recipientEmail: string;
  activeDays: number;
  totalRecords: number;
  uniqueExercises: number;
  activeMuscleGroups: number;
  totalMinutes: number | null;
  averageMinutesPerActiveDay: number | null;
  totalCalories: number | null;
  strengthRecords: number;
  enduranceRecords: number;
  enduranceMinutes: number;
  enduranceDistance: number | null;
  averageSpeedKmh: number | null;
  endurancePace: number | null;
  topGroups: Array<{label: string; value: number}>;
  topExercises: Array<{label: string; value: number}>;
  enduranceGroups: Array<{label: string; value: number}>;
}): string => {
  const heading = summary.days === 30 ? "Últimos 30 días" : "Últimos 7 días";
  const cards = [
    {label: "Días activos", value: formatMetricValue(summary.activeDays)},
    {label: "Minutos totales", value: summary.totalMinutes != null ? `${summary.totalMinutes} min` : "-"},
    {label: "Registros", value: formatMetricValue(summary.totalRecords)},
    {label: "Ejercicios únicos", value: formatMetricValue(summary.uniqueExercises)},
    {label: "Grupos activos", value: formatMetricValue(summary.activeMuscleGroups)},
    {label: "Minutos / día activo", value: summary.averageMinutesPerActiveDay != null ? `${summary.averageMinutesPerActiveDay} min` : "-"},
    {label: "Calorías totales", value: summary.totalCalories != null ? `${summary.totalCalories} kcal` : "-"},
    {label: "Series fuerza", value: formatMetricValue(summary.strengthRecords)},
    {label: "Registros resistencia", value: formatMetricValue(summary.enduranceRecords)},
    {label: "Min resistencia", value: summary.enduranceMinutes > 0 ? `${summary.enduranceMinutes} min` : "-"},
    {label: "Distancia resistencia", value: formatDistance(summary.enduranceDistance)},
    {label: "Velocidad media", value: formatMetricValue(summary.averageSpeedKmh, " km/h")},
    {label: "Ritmo medio resistencia", value: formatPace(summary.endurancePace)},
  ];

  return `<!doctype html>
  <html lang="es">
    <body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a;">
      <div style="max-width:760px;margin:0 auto;padding:24px 16px 40px;">
        <div style="background:linear-gradient(135deg,#0f172a,#0f766e);border-radius:24px;padding:28px;color:#fff;">
          <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;opacity:0.78;">Gym Tracker</div>
          <h1 style="margin:10px 0 8px;font-size:30px;line-height:1.1;">Resumen visual · ${heading}</h1>
          <p style="margin:0;font-size:15px;opacity:0.88;">Preparado para ${summary.recipientEmail}</p>
        </div>

        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:18px;">
          ${cards.map((card) => `
            <div style="background:#fff;border:1px solid #dbeafe;border-radius:18px;padding:18px;box-shadow:0 16px 30px rgba(15,23,42,0.06);">
              <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">${card.label}</div>
              <div style="margin-top:8px;font-size:28px;font-weight:800;color:#0f172a;">${card.value}</div>
            </div>
          `).join("")}
        </div>

        <div style="display:grid;gap:18px;margin-top:18px;">
          <section style="background:#fff;border:1px solid #dbeafe;border-radius:18px;padding:18px;">
            <h2 style="margin:0 0 14px;font-size:18px;">Top grupos por registros</h2>
            ${buildRankRows(summary.topGroups)}
          </section>

          <section style="background:#fff;border:1px solid #dbeafe;border-radius:18px;padding:18px;">
            <h2 style="margin:0 0 14px;font-size:18px;">Top ejercicios por frecuencia</h2>
            ${buildRankRows(summary.topExercises)}
          </section>

          <section style="background:#fff;border:1px solid #dbeafe;border-radius:18px;padding:18px;">
            <h2 style="margin:0 0 14px;font-size:18px;">Minutos de resistencia por grupo</h2>
            ${buildRankRows(summary.enduranceGroups, " min")}
          </section>
        </div>
      </div>
    </body>
  </html>`;
};

const getTestTransport = async (): Promise<nodemailer.Transporter<nodemailer.SentMessageInfo>> => {
  if (cachedTestTransportPromise) return cachedTestTransportPromise;
  cachedTestTransportPromise = nodemailer.createTestAccount().then((account) =>
    nodemailer.createTransport({
      host: account.smtp.host,
      port: account.smtp.port,
      secure: account.smtp.secure,
      auth: {
        user: account.user,
        pass: account.pass,
      },
    })
  );
  return cachedTestTransportPromise;
};

const fetchYoutubeMetadata = async (watchUrl: string): Promise<{title: string; author: string}> => {
  try {
    const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`;
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {accept: "application/json"},
    });
    if (!response.ok) return {title: "", author: ""};
    const data = await response.json() as {title?: unknown; author_name?: unknown};
    return {
      title: capText(data.title, 140),
      author: capText(data.author_name, 90),
    };
  } catch {
    return {title: "", author: ""};
  }
};

export const analyzeExerciseYoutube = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    }
    const callerEmail = normalizeEmail(request.auth.token.email);
    const isAdminByClaim = request.auth.token.adminApp === true;
    const isAdminByEmail = ADMIN_EMAIL_ALLOWLIST.has(callerEmail);
    if (!isAdminByClaim && !isAdminByEmail) {
      throw new HttpsError("permission-denied", "Esta acción está reservada al administrador.");
    }

    const payload = (request.data ?? {}) as Record<string, unknown>;
    const muscleGroup = capText(payload.muscleGroup, 80);
    const exercise = capText(payload.exercise, 120);
    const parsed = parseYoutube(payload.youtubeUrl);

    if (!muscleGroup || !exercise) {
      throw new HttpsError("invalid-argument", "Grupo y ejercicio son obligatorios.");
    }
    if (!parsed.valid || !parsed.watchUrl) {
      throw new HttpsError("invalid-argument", "Enlace de YouTube no válido.");
    }

    const monthKey = getMonthKeyMadrid();
    const costRef = adminDb.collection("auditLogs").doc(`ai-cost-${monthKey}`);
    const costSnap = await costRef.get();
    const currentMonthCostEur = toFiniteNumber(costSnap.data()?.totalEur);
    if (currentMonthCostEur + MAX_CALL_EUR > BUDGET_EUR) {
      throw new HttpsError("resource-exhausted", "Límite mensual de IA alcanzado.");
    }

    const youtubeMeta = await fetchYoutubeMetadata(parsed.watchUrl);

    const prompt = [
      "Actúa como entrenador personal. Devuelve texto breve y práctico en español.",
      `Grupo muscular: ${muscleGroup}.`,
      `Ejercicio: ${exercise}.`,
      `Enlace YouTube: ${parsed.watchUrl}.`,
      youtubeMeta.title ? `Título del vídeo: ${youtubeMeta.title}.` : "",
      youtubeMeta.author ? `Canal: ${youtubeMeta.author}.` : "",
      "Importante: no inventes detalles específicos no verificables del vídeo.",
      "Si faltan datos, da recomendaciones generales seguras y útiles para el ejercicio.",
      "Devuelve:",
      "- technique: técnica clave (2-4 frases).",
      "- mistakes: errores comunes (2-4 frases).",
      "- equipment: material recomendado (lista corta en una frase).",
      "- notes: notas de seguridad/progresión (2-4 frases).",
    ].filter(Boolean).join("\n");

    let response;
    try {
      response = await ai.generate({
        model: gemini20Flash,
        prompt,
        config: {
          temperature: 0.2,
          maxOutputTokens: 360,
        },
        output: {
          schema: outputSchema,
        },
      });
    } catch (err) {
      logger.error("Error en IA analyzeExerciseYoutube", err);
      throw new HttpsError("internal", "No se pudo ejecutar IA en backend.");
    }

    const usage = (response as {usage?: {inputTokens?: number; outputTokens?: number}}).usage;
    const inputTokens = Math.max(0, Math.floor(toFiniteNumber(usage?.inputTokens)));
    const outputTokens = Math.max(0, Math.floor(toFiniteNumber(usage?.outputTokens)));

    let costEur = computeCostEur(inputTokens, outputTokens);
    if (!Number.isFinite(costEur) || costEur <= 0) {
      costEur = MAX_CALL_EUR;
    }
    costEur = Math.min(MAX_CALL_EUR, round2(costEur));

    const remaining = Math.max(0, round2(BUDGET_EUR - currentMonthCostEur));
    const chargedCostEur = Math.min(costEur, remaining);
    const newTotalEur = round2(currentMonthCostEur + chargedCostEur);

    await costRef.set({
      monthKey,
      budgetEur: BUDGET_EUR,
      maxPerCallEur: MAX_CALL_EUR,
      totalEur: newTotalEur,
      calls: FieldValue.increment(1),
      inputTokens: FieldValue.increment(inputTokens),
      outputTokens: FieldValue.increment(outputTokens),
      lastCostEur: chargedCostEur,
      lastUid: request.auth.uid,
      lastExercise: exercise,
      lastMuscleGroup: muscleGroup,
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});

    const output = response.output;
    return {
      technique: capText(output?.technique, 800),
      mistakes: capText(output?.mistakes, 800),
      equipment: capText(output?.equipment, 240),
      notes: capText(output?.notes, 800),
      costEur: chargedCostEur,
      totalMonthEur: newTotalEur,
      monthKey,
      inputTokens,
      outputTokens,
      watchUrl: parsed.watchUrl,
    };
  }
);

export const generateAdminTrainingPlan = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    }

    const callerEmail = normalizeEmail(request.auth.token.email);
    const isAdminByClaim = request.auth.token.adminApp === true;
    const isAdminByEmail = ADMIN_EMAIL_ALLOWLIST.has(callerEmail);
    if (!isAdminByClaim && !isAdminByEmail) {
      throw new HttpsError("permission-denied", "Esta acción está reservada al administrador.");
    }

    const payload = (request.data ?? {}) as Record<string, unknown>;
    const targetEmail = normalizeEmail(payload.targetEmail);
    const targetName = capText(payload.targetName, 120);
    const objective = capText(payload.objective, 600);
    const goalType = capText(payload.goalType, 80) || "general_fitness";
    const experienceLevel = capText(payload.experienceLevel, 40) || "intermediate";
    const sessionsPerWeek = clampInt(payload.sessionsPerWeek, 1, 7, 4);
    const sessionDurationMin = clampInt(payload.sessionDurationMin, 20, 180, 60);
    const preferredSplit = capText(payload.preferredSplit, 120);
    const preferredDays = capText(payload.preferredDays, 160);
    const injuries = capText(payload.injuries, 800);
    const notes = capText(payload.notes, 1400);
    const focusMuscleGroups = toStringArray(payload.focusMuscleGroups, 10, 60);
    const availableEquipment = toStringArray(payload.availableEquipment, 16, 60);
    const dislikedExercises = toStringArray(payload.dislikedExercises, 16, 80);
    const coachingInsights = toStringArray(payload.coachingInsights, 8, 240);

    if (!objective) {
      throw new HttpsError("invalid-argument", "El objetivo principal es obligatorio.");
    }

    const rawSnapshot =
      payload.userSnapshot && typeof payload.userSnapshot === "object"
        ? payload.userSnapshot as Record<string, unknown>
        : {};

    const snapshotLines = [
      `Sesiones últimos 30 días: ${clampInt(rawSnapshot.sessions30d, 0, 90, 0)}`,
      `Días activos últimos 30 días: ${clampInt(rawSnapshot.activeDays30d, 0, 31, 0)}`,
      `Frecuencia media semanal estimada: ${toFiniteNumber(rawSnapshot.avgSessionsPerWeek).toFixed(1)}`,
      `Carga media semanal fuerza: ${Math.round(toFiniteNumber(rawSnapshot.avgWeeklyLoad))}`,
      `Monotonía media: ${toFiniteNumber(rawSnapshot.avgMonotony).toFixed(2)}`,
      `Strain medio: ${Math.round(toFiniteNumber(rawSnapshot.avgStrain))}`,
      `Tendencia carga fuerza: ${toFiniteNumber(rawSnapshot.loadTrendPct).toFixed(1)}%`,
      `Ejercicio principal: ${capText(rawSnapshot.mainExercise, 120) || "-"}`,
      `PR recientes: ${clampInt(rawSnapshot.recentPRHits, 0, 20, 0)}`,
      `Semanas sin PR: ${clampInt(rawSnapshot.weeksSinceLastPR, 0, 52, 0)}`,
      `Grupo dominante: ${capText(rawSnapshot.topGroupName, 80) || "-"}`,
      `Share grupo dominante: ${toFiniteNumber(rawSnapshot.topGroupSharePct).toFixed(1)}%`,
      `Minutos resistencia 30d: ${Math.round(toFiniteNumber(rawSnapshot.enduranceMinutes30d))}`,
      `Distancia resistencia 30d: ${toFiniteNumber(rawSnapshot.enduranceDistance30d).toFixed(1)} km`,
      `Grupos a reforzar: ${toStringArray(rawSnapshot.weakestGroups, 4, 60).join(", ") || "-"}`,
    ];

    const rawLibrary = Array.isArray(payload.exerciseLibrary) ? payload.exerciseLibrary : [];
    const exerciseLibrary = rawLibrary
      .slice(0, 80)
      .map((entry) => {
        const item = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
        return {
          muscleGroup: capText(item.muscleGroup, 80),
          exercise: capText(item.exercise, 120),
          trackingMode: item.trackingMode === "endurance" ? "endurance" : "strength",
          youtubeUrl: capText(item.youtubeUrl, 240),
          notes: capText(item.notes, 160),
        };
      })
      .filter((entry) => entry.muscleGroup && entry.exercise);

    const libraryLines = exerciseLibrary.length
      ? exerciseLibrary
        .map((entry, index) =>
          `${index + 1}. ${entry.muscleGroup} | ${entry.exercise} | ${entry.trackingMode}` +
          `${entry.youtubeUrl ? ` | YouTube: ${entry.youtubeUrl}` : ""}` +
          `${entry.notes ? ` | Nota: ${entry.notes}` : ""}`
        )
        .join("\n")
      : "Sin biblioteca específica. Puedes proponer ejercicios genéricos y seguros.";

    const monthKey = getMonthKeyMadrid();
    const costRef = adminDb.collection("auditLogs").doc(`ai-plan-cost-${monthKey}`);
    const costSnap = await costRef.get();
    const currentMonthCostEur = toFiniteNumber(costSnap.data()?.totalEur);
    if (currentMonthCostEur + TRAINING_PLAN_MAX_CALL_EUR > TRAINING_PLAN_BUDGET_EUR) {
      throw new HttpsError("resource-exhausted", "Límite mensual de IA para planes alcanzado.");
    }

    const prompt = [
      "Actúa como entrenador personal senior especializado en hipertrofia, fuerza y recomposición corporal.",
      "Escribe en español claro, útil y sin relleno.",
      "Debes crear un plan semanal realista, seguro y accionable.",
      `Objetivo principal: ${objective}.`,
      `Meta tipo: ${goalType}.`,
      `Nivel del usuario: ${experienceLevel}.`,
      `Sesiones por semana exactas: ${sessionsPerWeek}.`,
      `Duración objetivo por sesión: ${sessionDurationMin} minutos.`,
      preferredSplit ? `Split o preferencia estructural: ${preferredSplit}.` : "",
      preferredDays ? `Días preferidos o restricciones de agenda: ${preferredDays}.` : "",
      focusMuscleGroups.length ? `Grupos prioritarios: ${focusMuscleGroups.join(", ")}.` : "",
      availableEquipment.length ? `Material disponible: ${availableEquipment.join(", ")}.` : "",
      dislikedExercises.length ? `Ejercicios a evitar: ${dislikedExercises.join(", ")}.` : "",
      injuries ? `Lesiones, molestias o limitaciones: ${injuries}.` : "",
      notes ? `Notas extra del usuario: ${notes}.` : "",
      targetEmail ? `Usuario objetivo: ${targetEmail}.` : "",
      targetName ? `Nombre o alias objetivo: ${targetName}.` : "",
      "Contexto de histórico reciente:",
      ...snapshotLines.map((line) => `- ${line}`),
      coachingInsights.length ? "Insights detectados:" : "",
      ...coachingInsights.map((line) => `- ${line}`),
      "Biblioteca prioritaria de ejercicios disponibles. Úsala cuando tenga sentido y prioriza ejercicios listados aquí:",
      libraryLines,
      "Reglas de decisión:",
      "1. Respeta exactamente el número de sesiones por semana.",
      "2. La suma de ejercicios y volumen debe caber aproximadamente en la duración marcada.",
      "3. Si hay molestias o ejercicios prohibidos, evita variantes agresivas.",
      "4. Equilibra estímulo, recuperación y progresión.",
      "5. Usa ejercicios de resistencia solo cuando aporten al objetivo.",
      "6. En fuerza usa prescripciones tipo '4 x 6-8', '3 x 10-12' o similares dentro del campo prescription.",
      "7. En resistencia usa prescription con formato práctico como '30 min Z2' o '6 x 2 min fuerte / 2 min suave'.",
      "8. No inventes métricas clínicas, no des consejos médicos y no prometas resultados.",
      "9. En cada ejercicio explica brevemente por qué está ahí dentro del campo reason.",
      "10. Devuelve solo datos válidos para el esquema solicitado.",
    ].filter(Boolean).join("\n");

    let response;
    try {
      response = await ai.generate({
        model: gemini20Flash,
        prompt,
        config: {
          temperature: 0.35,
          maxOutputTokens: 2200,
        },
        output: {
          schema: trainingPlanOutputSchema,
        },
      });
    } catch (err) {
      logger.error("Error en IA generateAdminTrainingPlan", err);
      throw new HttpsError("internal", "No se pudo ejecutar IA en backend.");
    }

    const usage = (response as {usage?: {inputTokens?: number; outputTokens?: number}}).usage;
    const inputTokens = Math.max(0, Math.floor(toFiniteNumber(usage?.inputTokens)));
    const outputTokens = Math.max(0, Math.floor(toFiniteNumber(usage?.outputTokens)));

    let costEur = computeCostEur(inputTokens, outputTokens);
    if (!Number.isFinite(costEur) || costEur <= 0) {
      costEur = TRAINING_PLAN_MAX_CALL_EUR;
    }
    costEur = Math.min(TRAINING_PLAN_MAX_CALL_EUR, round2(costEur));

    const remaining = Math.max(0, round2(TRAINING_PLAN_BUDGET_EUR - currentMonthCostEur));
    const chargedCostEur = Math.min(costEur, remaining);
    const newTotalEur = round2(currentMonthCostEur + chargedCostEur);

    await costRef.set({
      monthKey,
      budgetEur: TRAINING_PLAN_BUDGET_EUR,
      maxPerCallEur: TRAINING_PLAN_MAX_CALL_EUR,
      totalEur: newTotalEur,
      calls: FieldValue.increment(1),
      inputTokens: FieldValue.increment(inputTokens),
      outputTokens: FieldValue.increment(outputTokens),
      lastCostEur: chargedCostEur,
      lastUid: request.auth.uid,
      targetEmail,
      goalType,
      sessionsPerWeek,
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});

    const output = response.output;
    return {
      summary: capText(output?.summary, 1000),
      rationale: capText(output?.rationale, 1200),
      warnings: Array.isArray(output?.warnings)
        ? output.warnings.map((item) => capText(item, 240)).filter(Boolean)
        : [],
      recovery: Array.isArray(output?.recovery)
        ? output.recovery.map((item) => capText(item, 200)).filter(Boolean)
        : [],
      weeklyPlan: Array.isArray(output?.weeklyPlan) ? output.weeklyPlan : [],
      costEur: chargedCostEur,
      totalMonthEur: newTotalEur,
      monthKey,
      inputTokens,
      outputTokens,
      objective,
    };
  }
);

export const sendWorkoutSummaryEmail = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    }

    const payload = (request.data ?? {}) as Record<string, unknown>;
    const days = Number(payload.days) === 30 ? 30 : 7;
    const authEmail = normalizeEmail(request.auth.token.email);
    const isEmulator = process.env.FUNCTIONS_EMULATOR === "true";
    const recipientEmail = authEmail;

    if (!recipientEmail || !EMAIL_REGEX.test(recipientEmail)) {
      throw new HttpsError("invalid-argument", "No hay un correo válido disponible para el envío.");
    }

    if (!isEmulator) {
      throw new HttpsError(
        "failed-precondition",
        "El envío de correo visual está habilitado solo en entorno de prueba por ahora."
      );
    }

    const range = getDateRange(days);
    const [workoutsSnap, userSnap, exerciseMasterSnap] = await Promise.all([
      adminDb.collection("workouts")
        .where("uid", "==", request.auth.uid)
        .where("timestamp", ">=", range.start)
        .where("timestamp", "<=", range.end)
        .get(),
      adminDb.collection("users").doc(request.auth.uid).get(),
      adminDb.collection("users").doc(request.auth.uid).collection("exercises").get(),
    ]);

    const workouts = workoutsSnap.docs
      .map((docSnap) => docSnap.data() as Record<string, unknown>)
      .filter((item) => !isDeletedRecord(item));
    const exerciseMasterById = exerciseMasterSnap.docs.reduce((acc, docSnap) => {
      const data = docSnap.data() as Record<string, unknown>;
      const exerciseId = normalizeText(data.exerciseId || docSnap.id);
      if (!exerciseId) return acc;
      acc[exerciseId] = {
        exercise: normalizeText(data.exercise || data.name),
        muscleGroup: normalizeText(data.muscleGroup),
      };
      return acc;
    }, {} as Record<string, {exercise: string; muscleGroup: string}>);

    const activeDays = new Set<string>();
    const exercises = new Set<string>();
    const groups = new Set<string>();
    const topGroups = new Map<string, number>();
    const topExercises = new Map<string, number>();
    const enduranceGroups = new Map<string, number>();
    let strengthRecords = 0;
    let enduranceRecords = 0;
    let enduranceMinutes = 0;
    let enduranceDistance = 0;
    let hasEnduranceDistance = false;

    workouts.forEach((item) => {
      const exerciseId = normalizeText(item.exerciseId);
      const master = exerciseMasterById[exerciseId];
      const exercise = normalizeText(master?.exercise || item.exercise || item.exerciseNameSnapshot);
      const muscleGroup = normalizeText(master?.muscleGroup || item.muscleGroup || item.muscleGroupSnapshot);
      const trackingMode = normalizeText(item.trackingModeSnapshot || item.trackingMode);
      const timestamp = item.timestamp as {toDate?: () => Date} | undefined;
      const date = timestamp?.toDate ? timestamp.toDate() : null;
      if (date) activeDays.add(getDateKeyMadrid(date));
      if (exercise) exercises.add(exercise);
      if (muscleGroup) groups.add(muscleGroup);
      if (muscleGroup) {
        topGroups.set(muscleGroup, (topGroups.get(muscleGroup) || 0) + 1);
      }
      if (exercise) {
        topExercises.set(exercise, (topExercises.get(exercise) || 0) + 1);
      }

      if (trackingMode === TRACKING_MODE_ENDURANCE) {
        const duration = Math.max(0, Math.round(toFiniteNumber(item.durationMin)));
        const distance = toFiniteNumber(item.distanceKm);
        enduranceRecords += 1;
        enduranceMinutes += duration;
        if (distance > 0) {
          enduranceDistance += distance;
          hasEnduranceDistance = true;
        }
        if (muscleGroup && duration > 0) {
          enduranceGroups.set(muscleGroup, (enduranceGroups.get(muscleGroup) || 0) + duration);
        }
      } else {
        strengthRecords += 1;
      }
    });

    const rawDailyMetrics = userSnap.data()?.dailyMetrics as Record<string, {minutes?: unknown; calories?: unknown}> | undefined;
    let totalMinutes = 0;
    let totalCalories = 0;
    let hasMinutes = false;
    let hasCalories = false;

    range.dateKeys.forEach((dateKey) => {
      const metric = rawDailyMetrics?.[dateKey];
      if (!metric || typeof metric !== "object") return;
      const minutes = Math.max(0, Math.round(toFiniteNumber(metric.minutes)));
      const calories = Math.max(0, Math.round(toFiniteNumber(metric.calories)));
      if (minutes > 0) {
        totalMinutes += minutes;
        hasMinutes = true;
        activeDays.add(dateKey);
      }
      if (calories > 0) {
        totalCalories += calories;
        hasCalories = true;
      }
    });

    const sortedTopGroups = Array.from(topGroups.entries())
      .map(([label, value]) => ({label, value}))
      .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label, "es", {sensitivity: "base"}))
      .slice(0, 5);
    const sortedTopExercises = Array.from(topExercises.entries())
      .map(([label, value]) => ({label, value}))
      .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label, "es", {sensitivity: "base"}))
      .slice(0, 5);
    const sortedEnduranceGroups = Array.from(enduranceGroups.entries())
      .map(([label, value]) => ({label, value}))
      .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label, "es", {sensitivity: "base"}))
      .slice(0, 5);

    const averageMinutesPerActiveDay =
      hasMinutes && activeDays.size > 0 ? Math.round(totalMinutes / activeDays.size) : null;
    const averageSpeedKmh =
      hasEnduranceDistance && enduranceMinutes > 0 ? Number(((enduranceDistance / enduranceMinutes) * 60).toFixed(2)) : null;
    const endurancePace =
      hasEnduranceDistance && enduranceMinutes > 0 ? Number((enduranceMinutes / enduranceDistance).toFixed(2)) : null;

    const html = buildSummaryEmailHtml({
      days,
      recipientEmail,
      activeDays: activeDays.size,
      totalRecords: workouts.length,
      uniqueExercises: exercises.size,
      activeMuscleGroups: groups.size,
      totalMinutes: hasMinutes ? totalMinutes : null,
      averageMinutesPerActiveDay,
      totalCalories: hasCalories ? totalCalories : null,
      strengthRecords,
      enduranceRecords,
      enduranceMinutes,
      enduranceDistance: hasEnduranceDistance ? Number(enduranceDistance.toFixed(2)) : null,
      averageSpeedKmh,
      endurancePace,
      topGroups: sortedTopGroups,
      topExercises: sortedTopExercises,
      enduranceGroups: sortedEnduranceGroups,
    });

    const transport = await getTestTransport();
    const info = await transport.sendMail({
      from: "Gym Tracker Test <no-reply@gymtracker.local>",
      to: recipientEmail,
      subject: `Gym Tracker · Resumen ${days} días`,
      html,
    });

    return {
      recipientEmail,
      days,
      previewUrl: nodemailer.getTestMessageUrl(info),
      messageId: info.messageId,
    };
  }
);
