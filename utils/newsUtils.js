const crypto = require("crypto");
const Parser = require("rss-parser");
const { decode } = require("html-entities");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

// -------------------- Noticias RSS --------------------

const fuentesRss = {
  "Prensa Libre": "https://www.prensalibre.com/feed/",
  "Prensa Libre Guatemala": "https://www.prensalibre.com/guatemala/feed/",
  "Emisoras Unidas": "https://emisorasunidas.com/feed/",
  "Soy502": "https://www.soy502.com/rss.xml",
  "Publinews": "https://www.publinews.gt/gt/feed",
  "La Hora": "https://lahora.gt/feed/",
  "República": "https://republica.com/feed/",
};
const maxNoticiasPorFuente = 15;
const categoriasIncidentes = {
  "TRÁNSITO": [
    "accidente", "choque", "colision", "volcadura",
    "atropellado", "atropello", "camion volcado",
    "vehiculo volcado", "motorista", "hecho de transito",
  ],
  "INCENDIO": [
    "incendio", "se incendia", "fuego", "llamas",
    "bomberos combaten",
  ],
  "PNC / DELINCUENCIA": [
    "asalto", "robo", "hurto", "capturado", "captura",
    "extorsion", "delincuentes", "despojan", "allanamiento",
  ],
  "VIOLENCIA / ARMAS": [
    "ataque armado", "ataque", "arma de fuego", "herido",
    "fallecido", "homicidio", "asesinato", "disparos",
    "persona muerta", "muerto", "muertos",
  ],
  "INUNDACIÓN": [
    "inundacion", "inundado", "desbordamiento",
    "desbordado", "crecida de rio",
  ],
  "DESLIZAMIENTO / DERRUMBE": [
    "derrumbe", "deslizamiento", "deslave",
    "derrumbe de tierra", "desprendimiento de tierra",
  ],
  "ÁRBOLES / POSTES / CABLES": [
    "arbol caido", "poste caido", "cables caidos",
    "cable electrico", "cables sobre", "arbol sobre",
  ],
  "INFRAESTRUCTURA": [
    "colapso", "socavamiento", "hundimiento",
    "puente colapsado", "carretera bloqueada",
    "carretera danada",
  ],
  "MANIFESTACIÓN / BLOQUEO": [
    "bloqueo", "manifestacion", "protesta",
    "carretera cerrada", "paso cerrado",
    "ruta bloqueada", "cierre vial",
  ],
  "EMERGENCIA / RESCATE": [
    "rescate", "persona desaparecida", "desaparecido",
    "emergencia", "busqueda de persona",
  ],
};
const parser = new Parser({
  timeout: 15000,
  headers: {
    "User-Agent": "Mozilla/5.0 (compatible; UbicasureBot/1.0)",
    Accept: "application/rss+xml, application/xml, text/xml, */*",
  },
  customFields: {
    item: [
      ["description", "descripcion"],
      ["content:encoded", "contenidoCompleto"],
    ],
  },
});
const formateadorFecha = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Guatemala",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
function escaparRegex(texto) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function aTexto(valor) {
  if (typeof valor === "string") return valor;
  if (valor && typeof valor._ === "string") return valor._;
  return "";
}
function normalizar(texto) {
  let resultado = decode(String(texto || ""));
  resultado = resultado.replace(/<[^>]+>/g, " ");
  resultado = resultado.normalize("NFD").replace(/\p{Mn}/gu, "");
  resultado = resultado.replace(/\s+/g, " ");
  return resultado.toLowerCase().trim();
}
const reglasCategorias = Object.entries(categoriasIncidentes).map(
  ([categoria, palabras]) => ({
    categoria,
    patron: new RegExp(
      `\\b(?:${palabras.map((palabra) => escaparRegex(normalizar(palabra))).join("|")})\\b`
    ),
  })
);
function obtenerContenido(entrada) {
  const partes = [
    entrada.summary,
    entrada.descripcion,
    entrada.content,
    entrada.contenidoCompleto,
  ]
    .map(aTexto)
    .filter(Boolean);
  const partesUnicas = [...new Set(partes.map(normalizar))].filter(Boolean);
  return partesUnicas.join(" ");
}
function detectarCategorias(titulo, contenido) {
  const tituloNormalizado = normalizar(titulo);
  const contenidoNormalizado = normalizar(contenido);
  const categoriasEncontradas = reglasCategorias
    .filter(
      ({ patron }) =>
        patron.test(tituloNormalizado) || patron.test(contenidoNormalizado)
    )
    .map(({ categoria }) => categoria);
  const categoriasFuertes = categoriasEncontradas.filter(
    (categoria) => categoria !== "EMERGENCIA / RESCATE"
  );
  if (categoriasFuertes.length === 0) return [];
  return categoriasEncontradas;
}
function leerFecha(entrada) {
  const crudo = entrada.isoDate || entrada.pubDate || entrada.updated;
  if (!crudo) return null;
  const fecha = new Date(crudo);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}
function obtenerFecha(entrada) {
  const fecha = leerFecha(entrada);
  if (!fecha) return "Fecha no disponible";
  const partes = Object.fromEntries(
    formateadorFecha.formatToParts(fecha).map(({ type, value }) => [type, value])
  );
  return `${partes.day}/${partes.month}/${partes.year} ${partes.hour}:${partes.minute}`;
}
async function consultarFuente(nombreFuente, urlFuente) {
  try {
    const feed = await parser.parseURL(urlFuente);
    const noticias = [];
    for (const entrada of (feed.items || []).slice(0, maxNoticiasPorFuente)) {
      const titulo = (entrada.title || "Sin título").trim();
      const enlace = (entrada.link || "").trim();
      const contenido = obtenerContenido(entrada);
      const categorias = detectarCategorias(titulo, contenido);
      if (categorias.length === 0) continue;
      noticias.push({
        fuente: nombreFuente,
        titulo,
        url: enlace,
        fecha: obtenerFecha(entrada),
        fechaIso: leerFecha(entrada)?.toISOString() ?? null,
        categorias,
        resumen: aTexto(
          entrada.descripcion ?? entrada.summary ?? entrada.content ?? ""
        ).trim(),
      });
    }
    return { noticias, error: null };
  } catch (error) {
    console.error(`[ERROR] ${nombreFuente}: ${error.message}`);
    return { noticias: [], error: error.message };
  }
}
function eliminarDuplicados(noticias) {
  const noticiasUnicas = [];
  const enlacesVistos = new Set();
  const titulosVistos = new Set();
  for (const noticia of noticias) {
    const enlace = noticia.url.split("#")[0].replace(/\/+$/, "");
    const titulo = normalizar(noticia.titulo);
    if (enlace && enlacesVistos.has(enlace)) continue;
    if (titulo && titulosVistos.has(titulo)) continue;
    if (enlace) enlacesVistos.add(enlace);
    if (titulo) titulosVistos.add(titulo);
    noticiasUnicas.push(noticia);
  }
  return noticiasUnicas;
}
async function buscarNoticias() {
  const respuestas = await Promise.all(
    Object.entries(fuentesRss).map(async ([nombre, url]) => ({
      fuente: nombre,
      ...(await consultarFuente(nombre, url)),
    }))
  );
  const noticias = eliminarDuplicados(
    respuestas.flatMap((respuesta) => respuesta.noticias)
  );
  const errores = respuestas
    .filter((respuesta) => respuesta.error)
    .map(({ fuente, error }) => ({ fuente, error }));
  return { total: noticias.length, noticias, errores };
}

// ----------------------- Noticias de X --------------------

const apify = process.env.APIFY_TOKEN;
const { ApifyClient } = require("apify-client");
const actorId = "lance_api/x-tweet-scraper-api";
const consulta = "accidente OR choque OR asalto OR robo OR incendio Guatemala";
const maxResultadosPorConsulta = 20;
const esperaMaximaSegundos = 130;
const duracionMaximaSegundos = 120;

function obtenerCliente() {
  if (!apify) {
    throw new Error(
      "Falta APIFY_TOKEN. Configúralo como variable de entorno o secreto."
    );
  }
  return new ApifyClient({ token: apify });
}

async function recolectarNoticias() {
  const client = obtenerCliente();
  const run = await client.actor(actorId).call(
    {
      searchQueries: [consulta],
      sort: "latest",
      maxResults: maxResultadosPorConsulta,
    },
    { waitSecs: esperaMaximaSegundos, timeout: duracionMaximaSegundos }
  );
  if (!run) {
    throw new Error("Apify no devolvió una ejecución válida.");
  }
  if (run.status !== "SUCCEEDED") {
    throw new Error(`La ejecución de Apify terminó con estado ${run.status}.`);
  }
  if (!run.defaultDatasetId) {
    throw new Error("La ejecución no contiene un dataset de resultados.");
  }
  const { items } = await client
    .dataset(run.defaultDatasetId)
    .listItems({ limit: maxResultadosPorConsulta * 5 });
  const noticias = new Map();
  let recibidas = 0;
  for (const noticia of items) {
    if (noticia.success === false) continue;
    let identificador = noticia.tweetId || noticia.id || noticia.url;
    identificador = identificador ? String(identificador) : null;
    if (!identificador || !noticia.text) continue;
    recibidas += 1;
    if (!noticias.has(identificador)) {
      noticias.set(identificador, noticia);
    }
  }
  return {
    recibidas,
    total: noticias.size,
    noticias: [...noticias.values()],
  };
}

// ------------------ Noticias nuevas (sin filtrar) ------------------

const coleccionSinFiltrar = "newsRaw";
const tamanoLoteLectura = 100;
const tamanoLoteEscritura = 400;

function normalizarUrl(url) {
  return String(url || "").trim().split("#")[0].replace(/\/+$/, "");
}

function idNoticia(clave) {
  return crypto.createHash("sha1").update(normalizarUrl(clave)).digest("hex");
}

function partir(lista, tamano) {
  const grupos = [];
  for (let i = 0; i < lista.length; i += tamano) {
    grupos.push(lista.slice(i, i + tamano));
  }
  return grupos;
}

function datosRss(noticia) {
  return { ...noticia, origen: "rss" };
}

function normalizarTweet(noticia) {
  const entradaFecha = { isoDate: noticia.createdAt };
  return {
    origen: "x",
    tweetId: String(noticia.tweetId || noticia.id || ""),
    titulo: "",
    resumen: String(noticia.text || "").trim(),
    url: String(noticia.url || ""),
    fecha: obtenerFecha(entradaFecha),
    fechaIso: leerFecha(entradaFecha)?.toISOString() ?? null,
    categorias: [],
  };
}
function datosX(noticia) {
  return { ...normalizarTweet(noticia), raw: JSON.stringify(noticia) };
}

async function guardarNuevas(noticias, obtenerClave, construirDatos) {
  const db = getFirestore();
  const coleccion = db.collection(coleccionSinFiltrar);
  const candidatas = new Map();
  for (const noticia of noticias) {
    const id = idNoticia(obtenerClave(noticia));
    if (!candidatas.has(id)) candidatas.set(id, noticia);
  }
  const ids = [...candidatas.keys()];
  const existentes = new Set();
  for (const grupo of partir(ids, tamanoLoteLectura)) {
    const documentos = await db.getAll(...grupo.map((id) => coleccion.doc(id)));
    for (const documento of documentos) {
      if (documento.exists) existentes.add(documento.id);
    }
  }
  const idsNuevos = ids.filter((id) => !existentes.has(id));
  for (const grupo of partir(idsNuevos, tamanoLoteEscritura)) {
    const batch = db.batch();
    for (const id of grupo) {
      batch.create(coleccion.doc(id), {
        ...construirDatos(candidatas.get(id)),
        capturadaEn: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }
  return idsNuevos.map((id) => candidatas.get(id));
}

async function obtenerNoticiasRssNuevas() {
  const { noticias, errores } = await buscarNoticias();
  const nuevas = await guardarNuevas(
    noticias,
    (noticia) => noticia.url || `rss:${noticia.fuente}:${noticia.titulo}`,
    datosRss
  );
  return {
    total: nuevas.length,
    repetidas: noticias.length - nuevas.length,
    noticias: nuevas.map((noticia) => ({ ...noticia, origen: "rss" })),
    errores,
  };
}

async function obtenerNoticiasXNuevas() {
  const { recibidas, noticias } = await recolectarNoticias();
  const nuevas = await guardarNuevas(
    noticias,
    (noticia) => noticia.url || `x:${noticia.tweetId || noticia.id}`,
    datosX
  );
  return {
    recibidas,
    repetidas: noticias.length - nuevas.length,
    total: nuevas.length,
    noticias:  nuevas.map(normalizarTweet),
  };
}

module.exports = {
  obtenerNoticiasRssNuevas,
  obtenerNoticiasXNuevas,
  idNoticia,
};
