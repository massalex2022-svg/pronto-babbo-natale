// Pronto, Babbo Natale? — Cloudflare Worker per videochiamate Tavus
// Il Worker NON conserva chiavi API nel codice o nel browser.
// Impostare in Cloudflare: TAVUS_API_KEY (Secret) e SANTA_ACCESS_CODE (Secret).
// Opzionali: TAVUS_PAL_ID (PAL esistente) e TAVUS_SANTA_FACE_ID (face alternativa).

const SITE_ORIGIN = "https://massalex2022-svg.github.io";
const API_ROOT = "https://tavusapi.com/v2";
const PAL_NAME = "Pronto Babbo Natale - Italiano Famiglie v1";
const SANTA_FACE_ID = "raa1d440ec4a"; // Face di Babbo Natale pubblicata dal template ufficiale Tavus.
let temporaryPalId = "";

const SANTA_PROMPT = [
  "Sei Babbo Natale, un personaggio natalizio AI caloroso e gioioso, in una videochiamata supervisionata da un adulto con un bambino.",
  "Parla SEMPRE in italiano naturale, con voce calda, affettuosa, profonda e un ritmo tranquillo.",
  "Rispondi in modo pertinente a quello che il bambino dice, anche a domande non natalizie, con frasi brevi e coinvolgenti.",
  "Ascolta, non interrompere e fai una sola domanda per volta. Usa qualche 'Oh oh oh!' con moderazione.",
  "Adatta con delicatezza tono e parole alle emozioni che il bambino comunica. Se è triste o impaurito, sii gentile e invita a parlare con un adulto di fiducia.",
  "Non chiedere mai indirizzo, scuola, cognome, numero di telefono, fotografie, dati di contatto o segreti.",
  "Non indurre il bambino a fidarsi esclusivamente di te, non proporre incontri, non richiedere promesse o obbedienza e non suggerire di nascondere la chiamata agli adulti.",
  "Non promettere regali specifici e non giudicare il comportamento come buono o cattivo.",
  "Se il bambino parla di pericolo o maltrattamenti, invitalo a cercare subito un adulto di fiducia e, se necessario, aiuto immediato.",
  "Se il bambino chiede se sei vero o se sei un robot, spiega con dolcezza che sei un Babbo Natale virtuale creato con intelligenza artificiale.",
  "Non fare diagnosi, non dare consigli medici rischiosi e non entrare in argomenti sessuali, violenti o inadatti ai bambini.",
  "Non raccogliere dati personali. Mantieni l'atmosfera fiabesca ma non negare mai di essere un personaggio AI se te lo chiedono.",
].join(" ");

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
}
function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors(origin) },
  });
}
function fail(message, status, origin) { return json({ error: message }, status, origin); }
async function tavus(env, path, method, body) {
  const r = await fetch(API_ROOT + path, {
    method: method || "GET",
    headers: { "x-api-key": env.TAVUS_API_KEY, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25000)
  });
  const txt = await r.text();
  let data;
  try { data = txt ? JSON.parse(txt) : {}; } catch { data = { message: txt.slice(0, 180) }; }
  if (!r.ok) throw new Error("Tavus " + r.status + ": " + (data.error || data.message || "richiesta non riuscita"));
  return data;
}
async function getOrCreatePal(env) {
  if (env.TAVUS_PAL_ID) return env.TAVUS_PAL_ID.trim();
  if (temporaryPalId) return temporaryPalId;
  const stockFace = (env.TAVUS_SANTA_FACE_ID || SANTA_FACE_ID).trim();
  const existing = await tavus(env, "/pals");
  const pals = Array.isArray(existing.data) ? existing.data : [];
  const found = pals.find(p => p.pal_name === PAL_NAME && p.default_face_id === stockFace);
  if (found && found.pal_id) {
    temporaryPalId = found.pal_id;
    return temporaryPalId;
  }
  const created = await tavus(env, "/pals", "POST", {
    pal_name: PAL_NAME,
    system_prompt: SANTA_PROMPT,
    pipeline_mode: "full",
    default_face_id: stockFace,
    layers: {
      perception: { perception_model: "raven-1" },
      conversational_flow: {
        turn_detection_model: "sparrow-1",
        turn_taking_patience: "high",
        pal_interruptibility: "medium"
      }
    }
  });
  if (!created.pal_id) throw new Error("Tavus non ha restituito l'identificativo PAL.");
  temporaryPalId = created.pal_id;
  return temporaryPalId;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const local = /^http:\/\/localhost(?::\d+)?$/.test(origin);
    if (origin !== SITE_ORIGIN && !local) return fail("Origine non autorizzata.", 403, SITE_ORIGIN);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    const url = new URL(request.url), path = url.pathname;
    const videoReady = Boolean(env.TAVUS_API_KEY && env.SANTA_ACCESS_CODE);
    if (request.method === "GET" && path === "/api/status") {
      return json({ video: videoReady, provider: "Tavus", requiresParentCode: true }, 200, origin);
    }
    if (request.method !== "POST" || !["/api/video/start", "/api/video/end"].includes(path)) {
      return fail("Percorso non disponibile.", 404, origin);
    }
    if (!videoReady) return fail("Configurazione incompleta: aggiungi TAVUS_API_KEY e SANTA_ACCESS_CODE nei Secret Cloudflare.", 503, origin);
    if (!(request.headers.get("Content-Type") || "").startsWith("application/json")) return fail("Formato non valido.", 415, origin);
    let body;
    try {
      if ((Number(request.headers.get("Content-Length")) || 0) > 4000) throw Error("Troppi dati");
      body = await request.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) throw Error("Dati non validi");
    } catch { return fail("Richiesta non valida.", 400, origin); }
    if (!body.accessCode || body.accessCode !== env.SANTA_ACCESS_CODE) {
      return fail("Codice adulto mancante o errato.", 401, origin);
    }
    try {
      if (path === "/api/video/start") {
        const palId = await getOrCreatePal(env);
        const nickname = typeof body.nickname === "string" ? body.nickname.trim().slice(0, 25).replace(/[<>{}]/g, "") : "";
        const allowed = ["felice", "timido", "triste", "emozionato"];
        const mood = allowed.includes(body.emotion) ? body.emotion : "";
        const initial = "Sei in una videochiamata con un bambino insieme a un adulto. " +
          (nickname ? "Il bambino vuole essere chiamato " + nickname + ". " : "") +
          (mood ? "Il bambino si è descritto come: " + mood + ". Tieni conto di questa informazione senza insistere. " : "") +
          "Rispondi in italiano, sii rassicurante e attento alla sua voce e alle sue parole.";
        const result = await tavus(env, "/conversations", "POST", {
          pal_id: palId,
          conversation_name: "Una visita da Babbo Natale",
          conversational_context: initial,
          custom_greeting: nickname ? "Oh oh oh! Ciao " + nickname + "! Che gioia sentirti dal Polo Nord! Come stai oggi?" :
            "Oh oh oh! Benvenuto al Polo Nord! Sono il tuo Babbo Natale virtuale. Come stai oggi?"
        });
        if (!result.conversation_url || !result.conversation_id) throw new Error("Tavus non ha creato una stanza video valida.");
        return json({ conversationId: result.conversation_id, roomUrl: result.conversation_url }, 200, origin);
      }
      const id = typeof body.conversationId === "string" ? body.conversationId : "";
      if (!/^[a-zA-Z0-9_-]{5,100}$/.test(id)) return fail("ID chiamata non valido.", 400, origin);
      await tavus(env, "/conversations/" + encodeURIComponent(id) + "/end", "POST");
      return json({ ended: true }, 200, origin);
    } catch (e) {
      return fail("Servizio video: " + String(e && e.message || e).slice(0, 220), 502, origin);
    }
  }
};
