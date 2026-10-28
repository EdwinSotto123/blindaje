// ESLint del portal: la configuración del workspace más las reglas de hooks de React.
import reactHooks from "eslint-plugin-react-hooks";
import base from "../../eslint.config.js";

export default [
  ...base,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
];
