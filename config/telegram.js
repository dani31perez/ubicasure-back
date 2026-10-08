const crypto = require("crypto");
const axios = require("axios");
const { poolPromise } = require("./dbConfig.js");

const telegramConfig = JSON.parse(process.env.TELEGRAM_CONFIG);

const telegramBotUsername = "UbicasureAlertsBot";

async function createTelegramLink(email, station) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  const pool = await poolPromise;

  await pool.execute(
    `
      UPDATE Members
      SET telegramLinkToken = ?,
          telegramLinkExpiresAt = ?
      WHERE email = ?
        AND station = ?
    `,
    [token, expiresAt, email, station]
  );

  return `https://t.me/${telegramBotUsername}?start=${token}`;
}

async function processTelegramUpdate(update) {
    console.log("asdfasdf");
    console.log(JSON.stringify(update, null, 2));
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
    "Ubicasure: tu cuenta de Telegram ha sido vinculada correctamente."
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

module.exports = {
  createTelegramLink,
  processTelegramUpdate,
  sendTelegramNotification,
};