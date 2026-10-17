const express = require("express");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const {
  obtenerNoticiasRssNuevas,
  obtenerNoticiasXNuevas,
  idNoticia,
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
      ubicacion: limpiarTexto(noticia.ubicacion, 200),
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
