import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { appConfig } from "./config/app";
import "./index.css";

document.title = appConfig.appTitle;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
