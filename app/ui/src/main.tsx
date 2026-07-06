import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

const saved = localStorage.getItem("bw-theme");
if (saved === "light") document.documentElement.dataset.theme = "light";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
