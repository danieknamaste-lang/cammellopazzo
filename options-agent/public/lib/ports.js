/**
 * Porte da provare quando si cerca il sistema multiagentico su un host.
 *
 * Ordinate per probabilità: prima i server Python (uvicorn/FastAPI, Flask),
 * poi le interfacce tipiche degli strumenti LLM locali.
 */

export const PORTE_COMUNI = [
  8000, // uvicorn / FastAPI (default)
  8080,
  8001,
  5000, // Flask
  5001,
  3000,
  7860, // Gradio
  8501, // Streamlit
  11434, // Ollama
  1234, // LM Studio
  4000,
  9000,
  8888, // Jupyter
  5173,
  3001,
];

/** Normalizza quello che l'utente scrive: "100.1.2.3", "http://100.1.2.3:8000/". */
export function parseHost(testo) {
  const grezzo = String(testo || '').trim();
  if (!grezzo) return null;
  const conSchema = /^https?:\/\//i.test(grezzo) ? grezzo : `http://${grezzo}`;
  try {
    const url = new URL(conSchema);
    return {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port ? Number(url.port) : null,
      origin: `${url.protocol}//${url.hostname}${url.port ? ':' + url.port : ''}`,
    };
  } catch {
    return null;
  }
}
