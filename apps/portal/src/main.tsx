import "@fontsource/atkinson-hyperlegible/latin-400.css";
import "@fontsource/atkinson-hyperlegible/latin-700.css";
// Títulos: Bricolage con su eje de tamaño óptico (el mismo archivo que usa la landing).
import "@fontsource-variable/bricolage-grotesque/opsz.css";
import "@blindaje/shared/theme.css";
import "./styles/app.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { createApi } from "./api";
import { AppProviders } from "./app/context";

const api = createApi();
const root = document.getElementById("root");
if (!root) throw new Error("Falta #root");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <AppProviders api={api}>
        <App />
      </AppProviders>
    </BrowserRouter>
  </StrictMode>,
);
