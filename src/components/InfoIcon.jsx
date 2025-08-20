// src/components/InfoIcon.jsx
import { Info } from "lucide-react"; // npm install lucide-react
import { useState } from "react";

const InfoIcon = ({ children }) => {
  const [hover, setHover] = useState(false);

  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <Info
        size={16}
        color="#007bff"
        style={{ cursor: "pointer", verticalAlign: "middle" }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      />
      {hover && (
        <div
          style={{
            position: "absolute",
            top: "120%",
            left: 0,
            background: "#fff",
            border: "1px solid #ccc",
            borderRadius: "6px",
            padding: "0.5rem",
            fontSize: "0.85rem",
            maxWidth: "300px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
            zIndex: 10,
          }}
        >
          {children}
        </div>
      )}
    </span>
  );
};

export default InfoIcon;