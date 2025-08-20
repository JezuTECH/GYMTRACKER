import React from "react";

const backdropStyle = {
  position: "fixed",
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
  background: "rgba(0,0,0,0.5)",
  zIndex: 1000,
};

const modalStyle = (scrollY) => ({
  position: "absolute",
  top: scrollY + 60,
  left: "50%",
  transform: "translateX(-50%)",
  background: "white",
  padding: "1.5rem",
  borderRadius: "8px",
  boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
  maxWidth: "600px",
  width: "90%",
  zIndex: 1001,
});

const CalcInfoModal = ({
  isOpen,
  onClose,
  muscleGroup,
  exercise,
  date,
  series,
  scrollY = 0,
}) => {
  if (!isOpen) return null;

  const repsValid = series.filter((s) => typeof s.reps === "number");
  const weightValid = series.filter((s) => typeof s.weight === "number");

  const repsAvg =
    repsValid.length > 0
      ? Math.round(repsValid.reduce((sum, s) => sum + s.reps, 0) / repsValid.length)
      : 10;

  const weighted =
    weightValid.length > 0
      ? Math.round(
          weightValid.reduce((sum, s) => sum + s.weight * (s.reps || 10), 0) /
            weightValid.reduce((sum, s) => sum + (s.reps || 10), 0) * 10
        ) / 10
      : null;

  return (
    <div style={backdropStyle} onClick={onClose}>
      <div style={modalStyle(scrollY)} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>📊 Explicación del cálculo</h3>
        <p>
          <strong>Grupo:</strong> {muscleGroup} <br />
          <strong>Ejercicio:</strong> {exercise} <br />
          <strong>Fecha:</strong> {date.toLocaleDateString()}
        </p>

        <p>
          <strong>Peso medio ponderado:</strong>{" "}
          {weighted != null ? `${weighted} kg` : "No disponible"}
        </p>
        <p>
          <strong>Repeticiones medias:</strong>{" "}
          {repsAvg != null ? `${repsAvg}` : "No disponible"}
        </p>

        <h4>Series de este día:</h4>
        <ul style={{ paddingLeft: "1rem" }}>
          {series.map((s, i) => (
            <li key={i}>
              {s.weight ?? "-"} kg × {s.reps ?? "-"} reps
            </li>
          ))}
        </ul>

        <div style={{ fontSize: "0.9rem", color: "#444", marginTop: "1rem" }}>
          <p>
            El <strong>peso ponderado</strong> se calcula como la suma del peso
            multiplicado por repeticiones, dividido entre el total de repeticiones.
          </p>
          <p>
            Las <strong>reps medias</strong> son la media de todas las series válidas.
          </p>
        </div>

        <button
          onClick={onClose}
          style={{
            marginTop: "1rem",
            padding: "8px 16px",
            fontSize: "1rem",
            borderRadius: "6px",
            border: "none",
            backgroundColor: "#007bff",
            color: "white",
            cursor: "pointer",
          }}
        >
          Cerrar
        </button>
      </div>
    </div>
  );
};

export default CalcInfoModal;