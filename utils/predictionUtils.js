const FRANJAS = ["00-06", "06-12", "12-18", "18-24"];
const OBJETIVOS = ["hubo_transito", "hubo_delito", "hubo_incendio"];
const DIA_MS = 24 * 60 * 60 * 1000;
const ZONA_HORARIA = "America/Guatemala";

function errorServicio(status, message) {
  return Object.assign(new Error(message), { status });
}

function fechaGuatemala(fecha) {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: ZONA_HORARIA,
      year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(fecha).map(({ type, value }) => [type, value])
  );
  return `${partes.year}-${partes.month}-${partes.day}`;
}

function normalizarConsulta({ zona, fecha, dias } = {}, ahora = new Date()) {
  const coincidencia = /^(?:zona\s*|z\s*)?(\d{1,2})$/i.exec(String(zona ?? "").trim());
  const numeroZona = coincidencia ? Number(coincidencia[1]) : 0;
  if ((!Number.isInteger(zona) && typeof zona !== "string") || numeroZona < 1 || numeroZona > 25) {
    throw errorServicio(400, "zona debe ser un número entre 1 y 25, por ejemplo 10 o Zona 10.");
  }
  const inicio = fecha === undefined ? fechaGuatemala(ahora) : fecha;
  if (typeof inicio !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(inicio)) {
    throw errorServicio(400, "fecha debe tener el formato YYYY-MM-DD.");
  }
  const instante = Date.parse(`${inicio}T00:00:00.000Z`);
  if (!Number.isFinite(instante) || new Date(instante).toISOString().slice(0, 10) !== inicio) {
    throw errorServicio(400, "fecha debe ser una fecha válida.");
  }
  const cantidad = dias === undefined ? 1 : Number(dias);
  if ((typeof dias !== "string" && typeof dias !== "number" && dias !== undefined) ||
      !/^[1-7]$/.test(String(dias ?? 1)) || !Number.isInteger(cantidad)) {
    throw errorServicio(400, "dias debe ser un entero entre 1 y 7.");
  }
  const fechas = Array.from({ length: cantidad }, (_, i) =>
    new Date(instante + i * DIA_MS).toISOString().slice(0, 10)
  );
  if (fechas.some((valor) => !/^\d{4}-\d{2}-\d{2}$/.test(valor))) {
    throw errorServicio(400, "El período solicitado excede el rango de fechas permitido.");
  }
  return { zona: numeroZona, ubicacion: `1 - 101 - Z${numeroZona}`, fechas };
}

function validarRespuesta(datos, ubicacion, fecha) {
  const invalida = () => { throw errorServicio(502, "El predictor devolvió una respuesta incompleta o inválida."); };
  if (!datos || datos.ubicacion !== ubicacion || datos.fecha !== fecha ||
      !Array.isArray(datos.franjas) || datos.franjas.length !== FRANJAS.length) invalida();
  const vistas = new Set();
  const franjas = datos.franjas.map((fila) => {
    if (!fila || fila.ubicacion !== ubicacion || fila.fecha !== fecha ||
        !FRANJAS.includes(fila.franja_horaria) || vistas.has(fila.franja_horaria)) invalida();
    vistas.add(fila.franja_horaria);
    const predicciones = {};
    for (const objetivo of OBJETIVOS) {
      const pred = fila.predicciones?.[objetivo];
      if (!pred || typeof pred.ocurrira !== "boolean" ||
          !Number.isFinite(pred.score) || pred.score < 0 || pred.score > 1 ||
          !Number.isFinite(pred.umbral) || pred.umbral < 0 || pred.umbral > 1) invalida();
      // Usar la decisión original: score y umbral se reciben redondeados por la API.
      predicciones[objetivo] = { ocurrira: pred.ocurrira, score: pred.score, umbral: pred.umbral };
    }
    return { franja_horaria: fila.franja_horaria, predicciones };
  });
  return franjas.sort((a, b) => FRANJAS.indexOf(a.franja_horaria) - FRANJAS.indexOf(b.franja_horaria));
}

function resumir(franjas) {
  const porTipo = Object.fromEntries(OBJETIVOS.map((objetivo) => [objetivo, 0]));
  let franjasConAlerta = 0;
  for (const franja of franjas) {
    let tieneAlerta = false;
    for (const objetivo of OBJETIVOS) {
      if (franja.predicciones[objetivo].ocurrira) {
        porTipo[objetivo] += 1;
        tieneAlerta = true;
      }
    }
    if (tieneAlerta) franjasConAlerta += 1;
  }
  const alertas = Object.values(porTipo).reduce((total, valor) => total + valor, 0);
  return {
    alertas,
    porTipo,
    franjasConAlerta,
    franjasEvaluadas: franjas.length,
    prediccionesEvaluadas: franjas.length * OBJETIVOS.length,
    proporcionFranjasConAlerta: franjas.length ? franjasConAlerta / franjas.length : 0,
  };
}

function crearServicioPredicciones({
  fetchImpl = globalThis.fetch,
  obtenerUrl = () => process.env.PREDICTION_SERVICE_URL,
  ahora = () => new Date(),
  timeoutMs = 15000,
  cacheTtlMs = 5 * 60 * 1000,
  maxCacheEntries = 128,
} = {}) {
  // Caché limitada por instancia; solicitudes iguales comparten la consulta en curso.
  const cache = new Map();

  async function consultarDia(url, ubicacion, fecha) {
    let respuesta;
    try {
      respuesta = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ubicacion, fecha }),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
      });
      if (!respuesta.ok) {
        if (respuesta.status === 422) {
          throw errorServicio(422, "La zona o fecha no es reconocida por el predictor.");
        }
        throw errorServicio(502, "El servicio de predicciones no pudo completar la consulta.");
      }
      const datos = await respuesta.json();
      return { fecha, franjas: validarRespuesta(datos, ubicacion, fecha) };
    } catch (error) {
      if (error.status) throw error;
      if (error.name === "TimeoutError" || error.name === "AbortError") {
        throw errorServicio(504, "El servicio de predicciones agotó el tiempo de espera.");
      }
      throw errorServicio(502, "No se pudo obtener una respuesta válida del servicio de predicciones.");
    }
  }

  return async function obtenerPrediccionesZona(consulta) {
    const { zona, ubicacion, fechas } = normalizarConsulta(consulta, ahora());
    let url;
    try {
      const base = obtenerUrl();
      if (typeof base !== "string" || !base.trim()) throw new Error();
      url = new URL(base.trim());
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
          url.search || url.hash || !["/", "", "/predict", "/predict/"].includes(url.pathname)) throw new Error();
      url.pathname = "/predict";
    } catch {
      throw errorServicio(503, "Falta configurar una URL válida en PREDICTION_SERVICE_URL.");
    }
    const clave = JSON.stringify([url.href, zona, fechas]);
    const instante = ahora().getTime();
    const existente = cache.get(clave);
    if (existente && existente.expira > instante) return existente.promesa;
    cache.delete(clave);
    for (const [key, entrada] of cache) {
      if (entrada.expira <= instante) cache.delete(key);
    }
    while (cache.size >= maxCacheEntries) cache.delete(cache.keys().next().value);

    const promesa = (async () => {
      const dias = new Array(fechas.length);
      let siguiente = 0;
      // Como máximo tres llamadas simultáneas al predictor por consulta.
      await Promise.all(Array.from({ length: Math.min(3, fechas.length) }, async () => {
        while (siguiente < fechas.length) {
          const indice = siguiente++;
          const dia = await consultarDia(url.href, ubicacion, fechas[indice]);
          dias[indice] = { ...dia, conteo: resumir(dia.franjas) };
        }
      }));
      const conteo = resumir(dias.flatMap((dia) => dia.franjas));
      return {
        zona,
        ubicacion,
        periodo: { desde: fechas[0], hasta: fechas.at(-1), dias: fechas.length, zonaHoraria: ZONA_HORARIA },
        conteo,
        dias,
        nota: "Cada alerta es un tipo de evento que supera el umbral en una franja; no representa una cantidad de accidentes observados.",
      };
    })();
    const entrada = { expira: instante + cacheTtlMs, promesa };
    cache.set(clave, entrada);
    try {
      const resultado = await promesa;
      entrada.expira = ahora().getTime() + cacheTtlMs;
      return resultado;
    } catch (error) {
      if (cache.get(clave) === entrada) cache.delete(clave);
      throw error;
    }
  };
}

module.exports = {
  normalizarConsulta,
  crearServicioPredicciones,
  obtenerPrediccionesZona: crearServicioPredicciones(),
};
