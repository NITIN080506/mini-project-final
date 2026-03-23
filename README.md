# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## LLM Setup for Course Material Analysis

This app supports true LLM-generated page summaries, quizzes, and fill-in-the-blank questions from uploaded TXT/PDF/DOCX files.

1. Copy `.env.example` to `.env`.
2. Set `VITE_GOOGLE_AI_API_KEY` with your Google AI Studio API key.
3. Optionally set `VITE_GOOGLE_AI_MODEL` (default is `gemini-2.0-flash`).
4. Restart the dev server after editing `.env`.

If the API key is missing or the request fails, the app falls back to local heuristic question generation.
