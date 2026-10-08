const crypto = require("crypto");
const axios = require("axios");
const { poolPromise } = require("./dbConfig.js");

const telegramConfig = JSON.parse(process.env.TELEGRAM_CONFIG);

const telegramBotUsername = "UbicasureAlertsBot";

async function createTelegramLink(email, station) {
  const pool = await poolPromise;

  const [members] = await pool.execute(
    `
      SELECT telegramChatId
      FROM Members
      WHERE email = ?
        AND station = ?
      LIMIT 1
    `,
    [email, station]
  );

  if (members.length === 0) {
    throw new Error("No se encontró el miembro.");
  }

  if (members[0].telegramChatId) {
    throw new Error("La cuenta de Telegram ya está vinculada.");
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  const [result] = await pool.execute(
    `
      UPDATE Members
      SET telegramLinkToken = ?,
          telegramLinkExpiresAt = ?
      WHERE email = ?
        AND station = ?
    `,
    [token, expiresAt, email, station]
  );

  if (result.affectedRows === 0) {
    throw new Error("No se pudo generar el enlace de Telegram.");
  }

  return `https://t.me/${telegramBotUsername}?start=${token}`;
}

async function processTelegramUpdate(update) {
  if (!update.message) {
    return;
  }

  const message = update.message;
  const text = message.text || "";

  if (!text.startsWith("/start")) {
    return;
  }

  const token = text.split(" ")[1];

  if (!token) {
    return;
  }

  const chatId = String(message.chat.id);

  const pool = await poolPromise;

  const [members] = await pool.execute(
  `
    SELECT email, station
    FROM Members
    WHERE telegramLinkToken = ?
      AND telegramLinkExpiresAt > NOW()
    LIMIT 1
  `,
  [token]
);

  if (members.length === 0) {
    console.log("Token de vinculación de Telegram inválido o expirado.");

    await sendTelegramMessage(
        chatId,
        "El enlace de vinculación es inválido o ha expirado. Genera un nuevo enlace desde Ubicasure."
    );

    return;
    }

  const { email, station } = members[0];

  await pool.execute(
  `
    UPDATE Members
    SET telegramChatId = ?,
        telegramLinkToken = NULL,
        telegramLinkExpiresAt = NULL
    WHERE email = ?
      AND station = ?
  `,
  [chatId, email, station]
);

  console.log(
    "Telegram vinculado correctamente al miembro."
  );

  await sendTelegramMessage(
    chatId,
    "Ubicasure: tu cuenta de Telegram ha sido vinculada correctamente. Ahora recibirás tus alertas por este medio."
  );
}

async function sendTelegramMessage(chatId, message) {
  await axios.post(
    `https://api.telegram.org/bot${telegramConfig.botToken}/sendMessage`,
    {
      chat_id: chatId,
      text: message,
    }
  );
}

async function sendTelegramNotification(members, alertData) {
  const membersWithTelegram = members.filter(
    member => member.telegramChatId
  );

  if (membersWithTelegram.length === 0) {
    console.log("No hay miembros vinculados a Telegram.");
    return;
  }

  const message =
    "Ubicasure: Se ha detectado un incidente cercano. " +
    "Revisa la aplicación para más información.";

  const results = await Promise.allSettled(
    membersWithTelegram.map(member =>
      sendTelegramMessage(
        member.telegramChatId,
        message
      )
    )
  );

  const successful = results.filter(
    result => result.status === "fulfilled"
  );

  const failed = results.filter(
    result => result.status === "rejected"
  );

  console.log(
    `Telegram: ${successful.length} enviados, ` +
    `${failed.length} fallidos.`
  );

  failed.forEach(result => {
    console.error(
      "Error Telegram:",
      result.reason.response?.data ||
      result.reason.message
    );
  });

  return results;
}

async function sendTelegramNotification(members, alertData) {
  const chatIds = [
    ...new Set(members.map((member) => member.telegramChatId).filter(Boolean)),
  ];

  if (chatIds.length === 0) {
    console.log("No hay miembros vinculados a Telegram.");
    return;
  }

  const message =
    "Ubicasure: Revisa la aplicación, está pasando una alerta cerca.";

  const results = await Promise.allSettled(
    chatIds.map((chatId) => sendTelegramMessage(chatId, message))
  );

  const successful = results.filter((r) => r.status === "fulfilled");
  const failed = results.filter((r) => r.status === "rejected");

  console.log(`Telegram: ${successful.length} enviados, ${failed.length} fallidos.`);

  failed.forEach((r) => {
    console.error("Error Telegram:", r.reason.response?.data || r.reason.message);
  });

  return results;
}

module.exports = {
  createTelegramLink,
  processTelegramUpdate,
  sendTelegramNotification,
};