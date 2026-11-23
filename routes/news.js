const express = require("express");
const { getFirestore, FieldValue, FieldPath } = require("firebase-admin/firestore");
const {
  obtenerNoticiasRssNuevas,
  obtenerNoticiasXNuevas,
  idNoticia,
  categoriasPermitidas,
} = require("../utils/newsUtils");
const router = express.Router();
const coleccion = "news";
const maxNoticiasPorEnvio = 25;
const limitePorDefecto = 30;
const limiteMaximo = 100;
const horasPorDefecto = 48;
const horasMaximas = 720;

function limpiarTexto(valor, max) {
  return typeof valor === "string" ? valor.trim().slice(0, max) : "";
}
function normalizarFecha(valor) {
  const fecha = valor ? new Date(valor) : new Date();
  return (Number.isNaN(fecha.getTime()) ? new Date() : fecha).toISOString();
}
function normalizarZona(valor) {
  if (typeof valor !== "string" && typeof valor !== "number") return null;
  const texto = String(valor).trim();
  if (/\b(?:zona|z)\s*#?\s*\d+\s*(?:y|o|a|\/|-)\s*\d+\b/i.test(texto)) return null;
  const numeros = [...texto.matchAll(/\b(?:zona|z)\s*#?\s*(\d+)\b/gi)]
    .map((coincidencia) => Number(coincidencia[1]));
  if (/^\d+$/.test(texto)) numeros.push(Number(texto));
  const zonas = [...new Set(numeros)];
  if (zonas.length !== 1 || !Number.isSafeInteger(zonas[0]) || zonas[0] < 1) {
    return null;
  }
  return `Zona ${zonas[0]}`;
}
function construirDocumento(noticia) {
  if (!noticia || typeof noticia !== "object") return null;
  const url = limpiarTexto(noticia.url, 2048);
  const titulo = limpiarTexto(noticia.titulo, 300);
  const resumen = limpiarTexto(noticia.resumen, 2000);
  if (!url || (!titulo && !resumen)) return null;
  const confianza = noticia.confianza == null ? NaN : Number(noticia.confianza);
  return {
    id: idNoticia(url),
    datos: {
      fuente: limpiarTexto(noticia.fuente, 100),
      titulo,
      resumen,
      url,
      origen: ["rss", "x"].includes(noticia.origen) ? noticia.origen : "",
      fecha: limpiarTexto(noticia.fecha, 50),
      fechaIso: normalizarFecha(noticia.fechaIso),
      categorias: Array.isArray(noticia.categorias)
        ? noticia.categorias
            .map((categoria) => limpiarTexto(categoria, 60))
            .filter(Boolean)
            .slice(0, 10)
        : [],
      tipo: limpiarTexto(noticia.tipo, 100),
      ubicacion: normalizarZona(noticia.ubicacion),
      confianza: Number.isFinite(confianza)
        ? Math.min(Math.max(confianza, 0), 1)
        : null,
    },
  };
}


router.post("/", async (req, res) => {
  const { noticias } = req.body;
  if (!Array.isArray(noticias) || noticias.length === 0) {
    return res
      .status(400)
      .json({ error: "Se requiere un arreglo noticias con al menos un elemento." });
  }
  if (noticias.length > maxNoticiasPorEnvio) {
    return res
      .status(400)
      .json({ error: `Máximo ${maxNoticiasPorEnvio} noticias por envío.` });
  }
  const documentos = noticias.map(construirDocumento).filter(Boolean);
  if (documentos.length === 0) {
    return res.status(400).json({
      error: "Ninguna noticia tiene los campos mínimos (url y titulo o resumen).",
    });
  }
  try {
    const db = getFirestore();
    const batch = db.batch();
    for (const { id, datos } of documentos) {
      batch.set(
        db.collection(coleccion).doc(id),
        { ...datos, verificadaEn: FieldValue.serverTimestamp() },
        { merge: true }
      );
    }
    await batch.commit();
    res.status(201).json({
      guardadas: documentos.length,
      descartadas: noticias.length - documentos.length,
      ids: documentos.map(({ id }) => id),
    });
  } catch (error) {
    console.error("Error al guardar noticias en Firestore:", error);
    res
      .status(500)
      .json({ error: "Error interno del servidor.", details: error.message });
  }
});

router.get("/getNews", async (req, res) => {
  const limite = Math.min(
    Math.max(parseInt(req.query.limite, 10) || limitePorDefecto, 1),
    limiteMaximo
  );
  const horas = Math.min(
    Math.max(parseInt(req.query.horas, 10) || horasPorDefecto, 1),
    horasMaximas
  );
  const desde = new Date(Date.now() - horas * 60 * 60 * 1000).toISOString();
  try {
    const snapshot = await getFirestore()
      .collection(coleccion)
      .where("fechaIso", ">=", desde)
      .orderBy("fechaIso", "desc")
      .limit(limite)
      .get();
    const noticias = snapshot.docs.map((documento) => {
      const { verificadaEn, ...datos } = documento.data();
      return {
        id: documento.id,
        ...datos,
        verificadaEn: verificadaEn?.toDate().toISOString() ?? null,
      };
    });
    res.status(200).json({ total: noticias.length, noticias });
  } catch (error) {
    console.error("Error al leer noticias de Firestore:", error);
    res
      .status(500)
      .json({ error: "Error interno del servidor.", details: error.message });
  }
});

// Las capturas más recientes se leen primero. El ID desempata fechas iguales.
// El cursor avanza también cuando una página solo tiene noticias procesadas.
router.get("/pending", async (req, res) => {
  const limite = Number(req.query.limite ?? 50);
  const cursor = req.query.cursor;
  if (!Number.isInteger(limite) || limite < 1 || limite > 100 ||
      (cursor !== undefined && (typeof cursor !== "string" || !/^[a-f0-9]{40}$/.test(cursor)))) {
    return res.status(400).json({ error: "Límite o cursor inválido." });
  }
  try {
    const coleccionRaw = getFirestore().collection("newsRaw");
    let consulta = coleccionRaw
      .orderBy("capturadaEn", "desc")
      .orderBy(FieldPath.documentId(), "desc")
      .limit(limite);
    if (cursor) {
      const documentoCursor = await coleccionRaw.doc(cursor).get();
      if (!documentoCursor.exists || !documentoCursor.data().capturadaEn) {
        return res.status(400).json({ error: "El cursor no corresponde a una captura válida." });
      }
      consulta = consulta.startAfter(documentoCursor);
    }
    const pagina = await consulta.get();
    const noticias = pagina.docs
      .filter((documento) => !documento.data().clasificacion?.estado)
      .map((documento) => {
        const datos = documento.data();
        return {
          id: documento.id,
          fuente: datos.fuente || "",
          titulo: datos.titulo || "",
          resumen: datos.resumen || "",
          url: datos.url || "",
          origen: datos.origen || "",
          fechaIso: datos.fechaIso || null,
          capturadaEn: datos.capturadaEn?.toDate().toISOString() ?? null,
        };
      });
    res.json({
      version: 1,
      categoriasPermitidas,
      noticias,
      cursor: pagina.size === limite ? pagina.docs.at(-1).id : null,
    });
  } catch (error) {
    console.error("Error al leer noticias pendientes:", error);
    res.status(500).json({ error: "Error al leer noticias pendientes." });
  }
});

// Publicar y marcar la noticia como procesada forman una sola transacción.
// Un reintento conserva el primer resultado confirmado para ese documento.
router.post("/classify", async (req, res) => {
  const { id, modelo, clasificacion } = req.body || {};
  if (typeof id !== "string" || !/^[a-f0-9]{40}$/.test(id) ||
      typeof modelo !== "string" || !modelo.trim() || modelo.length > 200 ||
      !clasificacion || typeof clasificacion !== "object") {
    return res.status(400).json({ error: "Se requieren id, modelo y clasificación." });
  }
  const { relevante, categorias, ubicacion, motivo } = clasificacion;
  if (typeof relevante !== "boolean" || !Array.isArray(categorias) ||
      categorias.length > categoriasPermitidas.length ||
      categorias.some((categoria) => !categoriasPermitidas.includes(categoria)) ||
      new Set(categorias).size !== categorias.length ||
      (relevante && categorias.length === 0) ||
      (!relevante && categorias.length > 0) ||
      (ubicacion !== null && (typeof ubicacion !== "string" || ubicacion.length > 200)) ||
      typeof motivo !== "string" || !motivo.trim() || motivo.length > 500) {
    return res.status(400).json({ error: "Los campos de clasificación son inválidos." });
  }
  const zona = normalizarZona(ubicacion);
  try {
    const db = getFirestore();
    const referencia = db.collection("newsRaw").doc(id);
    const resultado = await db.runTransaction(async (transaccion) => {
      const documento = await transaccion.get(referencia);
      if (!documento.exists) {
        return { codigo: 404, error: "La noticia original no existe." };
      }
      const datos = documento.data();
      if (datos.clasificacion?.estado) {
        return { codigo: 200, id, estado: datos.clasificacion.estado, repetida: true };
      }
      const estado = relevante ? "publicada" : "descartada";
      if (relevante) {
        const noticia = construirDocumento({
          ...datos,
          fechaIso: datos.fechaIso || datos.capturadaEn?.toDate().toISOString(),
          categorias,
          tipo: categorias[0],
          ubicacion: zona,
        });
        if (!noticia) {
          return { codigo: 422, error: "La noticia original carece de URL o texto." };
        }
        transaccion.set(db.collection(coleccion).doc(noticia.id), {
          ...noticia.datos,
          verificadaEn: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      transaccion.update(referencia, {
        clasificacion: {
          estado,
          modelo: modelo.trim(),
          relevante,
          categorias,
          ubicacion: zona,
          motivo: motivo.trim(),
          procesadaEn: FieldValue.serverTimestamp(),
        },
      });
      return { codigo: 200, id, estado, repetida: false };
    });
    const { codigo, ...respuesta } = resultado;
    res.status(codigo).json(respuesta);
  } catch (error) {
    console.error("Error al guardar la clasificación:", error);
    res.status(500).json({ error: "Error al guardar la clasificación." });
  }
});

router.get("/getXNews", async (_req, res) => {
  try {
    res.status(200).json(await obtenerNoticiasXNuevas());
  } catch (error) {
    console.error("Error al recolectar noticias de X:", error);
    res
      .status(500)
      .json({ error: "Error interno del servidor.", details: error.message });
  }
});

router.get("/getRSSNews", async (_req, res) => {
  try {
    res.status(200).json(await obtenerNoticiasRssNuevas());
  } catch (error) {
    console.error("Error al consultar fuentes RSS:", error);
    res
      .status(500)
      .json({ error: "Error interno del servidor.", details: error.message });
  }
});

module.exports = router;

